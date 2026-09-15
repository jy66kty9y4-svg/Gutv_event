#!/bin/sh
set -eu

install_root=/opt/gutv-requests
releases_root="$install_root/releases"
backups_root="$install_root/backups"
private_env="$install_root/private.env"
archive="${1:-}"
expected_sha="${2:-}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
staging=""
release=""
probe_name=""
switched=0
completed=0
old_release=""
old_image=""

fail() { printf 'gutv-requests deploy: %s\n' "$1" >&2; exit 1; }

rollback() {
  if [ "$switched" -eq 1 ]; then
    GUTV_REQUESTS_IMAGE="$old_image" docker compose -p gutv-requests --env-file "$private_env" -f "$old_release/deploy/requests/docker-compose.yml" up -d --no-deps --no-build gutv-requests >/dev/null 2>&1 || true
    switched=0
  fi
}
cleanup() {
  status=$?
  trap - EXIT HUP INT TERM
  [ -z "$probe_name" ] || docker rm -f "$probe_name" >/dev/null 2>&1 || true
  [ -z "$staging" ] || rm -rf -- "$staging"
  if [ "$completed" -ne 1 ]; then rollback; fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

[ "$(id -u)" -eq 0 ] || fail 'must run as root'
[ -f "$archive" ] || fail 'release archive is missing'
case "$expected_sha" in *[!0-9a-fA-F]*|'') fail 'expected SHA-256 is invalid' ;; esac
[ "${#expected_sha}" -eq 64 ] || fail 'expected SHA-256 is invalid'
actual_sha="$(sha256sum "$archive" | awk '{print $1}')"
[ "$actual_sha" = "$expected_sha" ] || fail 'release archive checksum mismatch'
[ -f "$private_env" ] || fail 'private portal environment is missing'

unsafe_member="$(tar -tzf "$archive" | awk 'BEGIN{bad=0} /^\//{bad=1} /(^|\/)\.\.($|\/)/{bad=1} {if(bad){print; exit}}')"
[ -z "$unsafe_member" ] || fail 'release archive contains an unsafe path'
if tar -tvzf "$archive" | grep -Eq '^l|^h|^b|^c|^p|^s'; then fail 'release archive contains links or special files'; fi
if tar -tzf "$archive" | grep -Eq '(^|/)(\.git|node_modules|\.next|\.env|\.ssh)(/|$)|(^|/)(id_rsa|[^/]+\.pem)$'; then fail 'release archive contains generated files or secrets'; fi

install -d -m 0750 "$releases_root" "$backups_root"
release="$releases_root/${stamp}-$(printf '%s' "$actual_sha" | cut -c1-12)"
staging="$release.staging"
[ ! -e "$release" ] && [ ! -e "$staging" ] || fail 'release directory already exists'
install -d -m 0750 "$staging"
tar -xzf "$archive" -C "$staging" --no-same-owner --no-same-permissions
for required in package.json pnpm-lock.yaml Dockerfile deploy/requests/docker-compose.yml; do
  [ -f "$staging/$required" ] || fail "release is missing $required"
done

read_key() {
  key="$1" file="$2"
  sed -n "s/^${key}=//p" "$file" | tail -n 1
}

password_record="$(read_key GUTV_PASSWORD_RECORD "$private_env")"
session_secret="$(read_key GUTV_SESSION_SECRET "$private_env")"
[ -n "$password_record" ] || fail 'GUTV_PASSWORD_RECORD is missing'
[ -n "$session_secret" ] || fail 'GUTV_SESSION_SECRET is missing'

db_path=/var/lib/docker/volumes/gutv-requests_gutv-requests-data/_data/requests.sqlite
[ -f "$db_path" ] || fail 'production portal database is missing'
backup="$backups_root/requests.${stamp}.sqlite"
python3 - "$db_path" "$backup" <<'PY'
import sqlite3, sys
source = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
target = sqlite3.connect(sys.argv[2])
with target:
    source.backup(target)
result = target.execute("PRAGMA quick_check").fetchone()[0]
source.close(); target.close()
if result != "ok": raise SystemExit("backup quick_check failed")
PY
chmod 0600 "$backup"
sha256sum "$backup" > "$backup.sha256"

portal_fingerprint() {
  python3 - "$1" "${2:-actual}" <<'PY'
import sqlite3, sys
db = sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
tables = [
    "portal_organizations", "portal_accounts", "portal_specialties",
    "portal_applications", "portal_application_specialists",
    "portal_status_history", "portal_reviews", "portal_notifications",
    "portal_attachments", "portal_vk_posts",
]
def expected_count(table):
    count = db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0]
    if table == 'portal_specialties' and sys.argv[2] == 'expected':
        count += not db.execute("SELECT 1 FROM portal_specialties WHERE name = 'Рилсмейкер' COLLATE NOCASE").fetchone()
    return count
print("|".join(f"{table}:{expected_count(table)}" for table in tables))
db.close()
PY
}
before_fingerprint="$(portal_fingerprint "$db_path" expected)"

mv "$staging" "$release"
staging=""
image="gutv-requests:${stamp}-$(printf '%s' "$actual_sha" | cut -c1-12)"
docker build --platform linux/amd64 -t "$image" "$release"

probe_name="gutv-requests-probe-${stamp}"
docker run -d --name "$probe_name" --network none \
  -e GUTV_DATABASE_PATH=/tmp/probe.sqlite \
  -e GUTV_UPLOAD_PATH=/tmp/uploads \
  -e GUTV_PASSWORD_RECORD="$password_record" \
  -e GUTV_SESSION_SECRET=probe-session-secret \
  -e GUTV_VK_GROUP_ID=30973272 \
  -e GUTV_VK_CONFIRMATION_CODE=probe-confirmation \
  "$image" >/dev/null
probe_attempt=0
until docker exec "$probe_name" node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; do
  probe_attempt=$((probe_attempt + 1))
  if [ "$probe_attempt" -ge 30 ]; then fail 'new portal image did not become ready'; fi
  sleep 1
done
docker exec -i "$probe_name" node <<'JS'
const { createHash, createHmac } = require('node:crypto');
async function page(path, expected) {
  const response = await fetch(`http://127.0.0.1:3000${path}`);
  const body = await response.text();
  if (response.status !== 200 || !body.includes(expected)) throw new Error(`page smoke failed: ${path}`);
  return body;
}
(async () => {
  await page('/', 'ГУТВ');
  await page('/studio', 'О студии');
  const payload = Buffer.from(JSON.stringify({ accountId: 0, role: 'management', organizationId: null, username: 'studio', displayName: 'Probe', expiresAt: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const signed = `v2.${payload}`;
  const signature = createHmac('sha256', Buffer.from('probe-session-secret', 'base64url')).update(signed).digest('base64url');
  const accessResponse = await fetch('http://127.0.0.1:3000/api/admin/access', { headers: { cookie: `gutv_session=${signed}.${signature}` } });
  const access = await accessResponse.json();
  if (accessResponse.status !== 200 || access.roles.map(role => role.name).join('|') !== 'Администратор|Директор|Молодость|Бухгалтер' || !access.users.find(user => user.id === 0)?.protected) throw new Error('Roles and protected administrator smoke failed');
  // Exercise the new brief against synthetic data in the isolated probe database.
  const base = 'http://127.0.0.1:3000';
  async function json(path, method, body, cookie, expected = 200) {
    const response = await fetch(base + path, { method, headers: { origin: base, ...(cookie ? { cookie } : {}), ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: body instanceof FormData ? body : JSON.stringify(body) }) });
    const value = await response.json();
    if (response.status !== expected) throw new Error(`brief smoke ${path}: ${response.status}`);
    return { value, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  const adminCookie = `gutv_session=${signed}.${signature}`;
  const testPassword = 'ПроверкаФормы2026!';
  await json('/api/auth/register', 'POST', { organizationType: 'organization', organizationName: 'Проверка формы', representativeName: 'Тестовый представитель', contact: '@probe', username: 'проверка-формы', password: testPassword }, null, 201);
  const dashboard = (await json('/api/admin/dashboard', 'GET', undefined, adminCookie)).value;
  const organization = dashboard.organizations.find(item => item.username === 'проверка-формы');
  await json(`/api/admin/organizations/${organization.id}`, 'PATCH', { status: 'active' }, adminCookie);
  const memberCookie = (await json('/api/auth/login', 'POST', { username: 'ПРОВЕРКА-ФОРМЫ', password: testPassword })).cookie;
  const nextDay = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  const following = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
  const fields = { eventTitle: 'Проверка новой заявки', requestKind: 'event_video', eventDescription: 'Проверка изолированного образа', scenario: 'Выступления, интервью и открытие мероприятия', participants: '5–10 человек', contactName: 'Тестовый представитель', contactChannel: '@probe', slots: JSON.stringify([{ startsAt: nextDay + 'T23:00', endsAt: following + 'T02:00', location: 'Проверочная площадка' }]) };
  const form = new FormData(); Object.entries(fields).forEach(([key, value]) => form.set(key, value));
  await json('/api/applications', 'POST', form, memberCookie, 400);
  form.set('rulesAccepted', 'true');
  form.set('attachments', new Blob(['probe file'], { type: 'application/pdf' }), 'probe.pdf');
  const fileRejection = (await json('/api/applications', 'POST', form, memberCookie, 400)).value;
  if (fileRejection.error !== 'Загрузка файлов в заявки отключена') throw new Error('file upload rejection smoke failed');
  form.delete('attachments');
  form.set('participants', '-5');
  await json('/api/applications', 'POST', form, memberCookie, 400);
  form.set('participants', '5–10 человек');
  const created = (await json('/api/applications', 'POST', form, memberCookie, 201)).value.application;
  if (!created.brief?.rulesAcceptedAt || created.brief.slots[0].endsAt !== following + 'T02:00' || created.specialists.length !== 0) throw new Error('brief persistence smoke failed');
  await json(`/api/admin/applications/${created.id}`, 'PATCH', { revision: created.revision, status: 'approved' }, adminCookie, 400);
  await json(`/api/admin/applications/${created.id}`, 'PATCH', { revision: created.revision, status: 'approved', acceptRuleException: true }, adminCookie);
  form.set('requestKind', 'trip');
  await json('/api/applications', 'POST', form, memberCookie, 400);
  const specialty = (await json('/api/applications', 'GET', undefined, memberCookie)).value.specialties[0];
  form.set('specialists', JSON.stringify([{ id: specialty.id, requestedCount: 2 }]));
  const trip = (await json('/api/applications', 'POST', form, memberCookie, 201)).value.application;
  if (trip.specialists[0]?.requestedCount !== 2) throw new Error('trip specialists smoke failed');
  for (const path of ['/cabinet/rules', '/cabinet/contacts']) {
    const response = await fetch(base + path, { headers: { cookie: memberCookie }, redirect: 'manual' });
    if (response.status !== 200) throw new Error(`cabinet information smoke failed: ${path}`);
  }
  const anonymous = await fetch('http://127.0.0.1:3000/api/admin/access');
  if (anonymous.status !== 401) throw new Error('Anonymous access must be rejected');
  await page('/directions', 'Направления');
  const materials = await page('/studio', 'Последние работы');
  const legacyMaterials = await fetch('http://127.0.0.1:3000/materials');
  const legacyBody = await legacyMaterials.text();
  if (!legacyMaterials.ok || (!legacyMaterials.url.includes('/studio') && !legacyBody.includes('/studio#latest-projects'))) throw new Error('Materials handoff failed');
  if ((materials.match(/data-latest-work=/g) || []).length !== 5) throw new Error('studio materials card count is not five');
  const secret = createHash('sha256').update('vk-callback-v1:probe-session-secret').digest('hex').slice(0, 48);
  const callback = await fetch('http://127.0.0.1:3000/api/vk/callback', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'confirmation', group_id: 30973272, secret }),
  });
  if (callback.status !== 200 || await callback.text() !== 'probe-confirmation') throw new Error('VK callback confirmation failed');
})().catch((error) => { console.error(error); process.exit(1); });
JS
docker rm -f "$probe_name" >/dev/null
probe_name=""

old_release="$(readlink "$install_root/current" 2>/dev/null || true)"
case "$old_release" in /opt/gutv-requests/releases/*) ;; *) fail 'current portal release cannot be resolved safely' ;; esac
if [ -n "${GUTV_EXPECTED_RELEASE:-}" ] && [ "$old_release" != "$GUTV_EXPECTED_RELEASE" ]; then
  fail 'current portal release changed while building; rebase before publishing'
fi
old_image="$(docker inspect -f '{{.Config.Image}}' gutv-requests-gutv-requests-1)"
[ -n "$old_image" ] || fail 'current portal image cannot be resolved'

switched=1
GUTV_REQUESTS_IMAGE="$image" \
  docker compose -p gutv-requests --env-file "$private_env" -f "$release/deploy/requests/docker-compose.yml" up -d --no-deps --no-build gutv-requests

ready_attempt=0
until docker exec gutv-requests-gutv-requests-1 node -e "fetch('http://127.0.0.1:3000/').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"; do
  ready_attempt=$((ready_attempt + 1))
  if [ "$ready_attempt" -ge 30 ]; then fail 'production portal did not become ready'; fi
  sleep 1
done
[ "$(docker inspect -f '{{.Config.Image}}' gutv-requests-gutv-requests-1)" = "$image" ] || fail 'production portal uses an unexpected image'
after_fingerprint="$(portal_fingerprint "$db_path")"
[ "$before_fingerprint" = "$after_fingerprint" ] || fail 'portal data invariant changed during deployment'
[ "$(python3 - "$db_path" <<'PY'
import sqlite3, sys
db=sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True)
print(db.execute('PRAGMA quick_check').fetchone()[0])
db.close()
PY
)" = ok ] || fail 'production portal database quick_check failed'

ln -s "$release" "$install_root/.current-$stamp"
mv -Tf "$install_root/.current-$stamp" "$install_root/current"
printf '%s\n' "$backup" > "$install_root/last-database-backup"
completed=1
switched=0
printf 'gutv-requests deployed: %s\n' "$release"
