import assert from 'node:assert/strict';

const base = process.argv[2] || 'http://127.0.0.1:3000';
const origin = 'https://gutv.tech';
const paths = ['/', '/studio', '/directions'];
const agents = ['Mozilla/5.0', 'Googlebot', 'YandexBot'];

async function request(path, agent = agents[0]) {
  return fetch(new URL(path, base), {
    redirect: 'manual',
    headers: { 'user-agent': agent },
    signal: AbortSignal.timeout(20000),
  });
}

for (const agent of agents) {
  const robots = await request('/robots.txt', agent);
  assert.equal(robots.status, 200, `robots.txt: ${agent}`);
  assert.match(robots.headers.get('content-type'), /text\/plain/);
  const rules = await robots.text();
  assert.match(rules, /User-Agent:\s*\*/i);
  assert.match(rules, /^Allow:\s*\/$/im);
  assert.doesNotMatch(rules, /^Disallow:\s*\/$/im);
  assert.ok(rules.includes(`Sitemap: ${origin}/sitemap.xml`));

  const sitemap = await request('/sitemap.xml', agent);
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('content-type'), /xml/);
  const xml = await sitemap.text();
  assert.ok(xml.includes('http://www.sitemaps.org/schemas/sitemap/0.9'));
  assert.deepEqual([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]), paths.map((path) => origin + path));

  for (const path of paths) {
    const response = await request(path, agent);
    assert.equal(response.status, 200, `${agent} ${path}`);
    assert.doesNotMatch(response.headers.get('x-robots-tag') || '', /noindex|none/i);
    const html = await response.text();
    const tags = [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]);
    assert.ok(tags.some((tag) => /name="robots"/.test(tag) && /content="index, follow"/.test(tag)));
    assert.ok(!tags.some((tag) => /name="(?:robots|googlebot|yandex)"/.test(tag) && /noindex|none/i.test(tag)));
    const canonical = [...html.matchAll(/<link\b[^>]*rel="canonical"[^>]*>/g)].map((m) => m[0]);
    assert.equal(canonical.length, 1, `canonical count: ${path}`);
    assert.equal(new URL(canonical[0].match(/href="([^"]+)"/)[1]).href, `${origin}${path}`);
    assert.match(html, /<h1[\s>]/);
    assert.match(html, /<title>[^<]*ГУТВ[^<]*<\/title>/);
  }
  console.log(`PASS public pages, robots.txt, sitemap.xml: ${agent}`);
}

for (const path of ['/?auth=login', '/?auth=register', '/?utm_source=search-check']) {
  const response = await request(path);
  assert.equal(response.status, 200);
  const html = await response.text();
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*>/)?.[0];
  assert.ok(canonical);
  assert.equal(new URL(canonical.match(/href="([^"]+)"/)[1]).href, `${origin}/`);
}

for (const path of ['/management', '/cabinet']) {
  const response = await request(path);
  assert.ok([302, 303, 307, 308].includes(response.status), `${path} must require login`);
  assert.ok(response.headers.get('location')?.includes('auth=login'));
}
assert.equal((await request('/api/admin/dashboard')).status, 401);
const materials = await request('/materials');
assert.ok([307, 308].includes(materials.status));
assert.equal(materials.headers.get('location'), '/studio#latest-projects');
console.log('PASS canonical query variants, private routes, materials redirect');
