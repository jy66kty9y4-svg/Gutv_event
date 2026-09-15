import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { createPortalSchemaSql, defaultSpecialties } from '../db/schema.ts';

const exports = {};
const source = ts.transpileModule(readFileSync(new URL('../db/specialties.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
runInNewContext(source, { exports, require: () => ({ defaultSpecialties }) });
const db = new DatabaseSync(':memory:');
try {
  db.exec(createPortalSchemaSql);
  db.exec(`PRAGMA foreign_keys=ON;
    INSERT INTO portal_specialties (id,name,sort_order,active) VALUES (42,'Режиссёр трансляции',50,0), (43,'Собственная позиция',60,1);
    CREATE TABLE test_assignments (specialty_id INTEGER REFERENCES portal_specialties(id), assigned_names TEXT);
    INSERT INTO test_assignments VALUES (42,'Назначенный специалист');`);
  exports.initializeSpecialties(db);
  assert.deepEqual({ ...db.prepare('SELECT id,name,sort_order,active FROM portal_specialties WHERE id=42').get() }, { id: 42, name: 'Специалист по видеопоказу', sort_order: 50, active: 0 });
  assert.equal(db.prepare('SELECT assigned_names FROM test_assignments JOIN portal_specialties ON id=specialty_id').get().assigned_names, 'Назначенный специалист');
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM portal_specialties WHERE name='Рилсмейкер' AND active=1").get().n, 1);
  const before = db.prepare('SELECT * FROM portal_specialties ORDER BY id').all();
  exports.initializeSpecialties(db);
  assert.deepEqual(db.prepare('SELECT * FROM portal_specialties ORDER BY id').all(), before, 'Restart preserves IDs, custom entries and archive state without duplicates');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  console.log('PASS specialties upgrade: existing IDs, assignments, custom entries and archive state preserved; restart idempotent');
} finally { db.close(); }
