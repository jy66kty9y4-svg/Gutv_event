import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateApplicationRevision } from '../db/application-revision.ts';

const db = new DatabaseSync(':memory:');
try {
  // Simulate existing production records before the additive migration.
  db.exec(`CREATE TABLE portal_applications (id INTEGER PRIMARY KEY, event_title TEXT, updated_at TEXT);
    INSERT INTO portal_applications VALUES (41, 'Существующая заявка', '2026-09-08 11:12:13');`);
  const before = db.prepare('SELECT id, event_title, updated_at FROM portal_applications').all();
  migrateApplicationRevision(db);
  assert.deepEqual(db.prepare('SELECT id, event_title, updated_at FROM portal_applications').all(), before);
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=41').get().revision, 1);
  const cas = db.prepare('UPDATE portal_applications SET event_title=?, revision=revision+1 WHERE id=? AND revision=?');
  assert.equal(cas.run('Сохранено новой версией', 41, 1).changes, 1);
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=41').get().revision, 2, 'CAS increments exactly once');
  migrateApplicationRevision(db);
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=41').get().revision, 2, 'Restart cannot reset versions');
  db.prepare('INSERT INTO portal_applications (id,event_title) VALUES (?,?)').run(42, 'Совместимая запись');
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=42').get().revision, 1, 'Legacy inserts remain compatible');
  // Simulate an old image writing during rollback, then a previously opened newer form.
  db.prepare('UPDATE portal_applications SET event_title=?, updated_at=? WHERE id=?').run('Изменено во время отката', '2026-09-13 14:00:00', 41);
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=41').get().revision, 3, 'Legacy update increments the revision');
  assert.equal(cas.run('Устаревшая открытая форма', 41, 2).changes, 0, 'Old form cannot overwrite a rollback-era change');
  assert.equal(db.prepare('SELECT event_title FROM portal_applications WHERE id=41').get().event_title, 'Изменено во время отката');
  assert.equal(cas.run('Новая актуальная форма', 41, 3).changes, 1);
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=41').get().revision, 4, 'CAS skips the legacy trigger');
  db.exec('PRAGMA recursive_triggers=ON');
  db.prepare('UPDATE portal_applications SET event_title=? WHERE id=41').run('Совместимое рекурсивное обновление');
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=41').get().revision, 5, 'Trigger terminates with recursive_triggers enabled');
  assert.equal(cas.run('Следующий CAS', 41, 5).changes, 1);
  assert.equal(db.prepare('SELECT revision FROM portal_applications WHERE id=41').get().revision, 6, 'Recursive triggers still do not double-increment CAS');
  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE portal_applications SET event_title=? WHERE id=41').run('Неуспешная транзакция');
  db.exec('ROLLBACK');
  assert.deepEqual({ ...db.prepare('SELECT event_title, revision FROM portal_applications WHERE id=41').get() }, { event_title: 'Следующий CAS', revision: 6 }, 'Rollback undoes the trigger and business changes together');
  migrateApplicationRevision(db);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='trigger' AND name='portal_applications_legacy_revision'").get().count, 1, 'Migration installs exactly one trigger');
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  console.log('PASS additive revision migration: preserves records, idempotent, legacy insert/update, CAS once, recursive triggers, rollback, integrity');
} finally { db.close(); }
