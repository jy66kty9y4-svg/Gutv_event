import { DatabaseSync } from 'node:sqlite';
import { createLeadershipPeopleTableSql, createPortalSchemaSql } from '@/db/schema';
import { initializeAccess } from '@/db/access';
import { leadershipSeed } from '@/db/leadership-seed';
import { migrateApplicationRevision } from '@/db/application-revision';
import { initializeSpecialties } from '@/db/specialties';

let connection: DatabaseSync | undefined;
let connectionPath: string | undefined;

function databasePath() {
  const path = process.env.GUTV_DATABASE_PATH;
  if (!path) throw new Error('GUTV_DATABASE_PATH is not configured');
  return path;
}

function migrateLeadershipPeople(database: DatabaseSync) {
  const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'portal_leadership_people'").get() as { sql: string } | undefined;
  if (!table || table.sql.includes('photo_scale >= 0.25') && !table.sql.includes("photo_position IN")) return;
  database.exec('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON; BEGIN IMMEDIATE;');
  try {
    database.exec('ALTER TABLE portal_leadership_people RENAME TO portal_leadership_people_legacy;');
    database.exec(createLeadershipPeopleTableSql);
    const hasPhotoScale = table.sql.includes('photo_scale');
    database.exec(`INSERT INTO portal_leadership_people (id, name, description, photo_url, photo_position, photo_scale, created_at, updated_at)
      SELECT id, name, description, photo_url, photo_position, ${hasPhotoScale ? 'photo_scale' : '1'}, created_at, updated_at
      FROM portal_leadership_people_legacy;`);
    database.exec('DROP TABLE portal_leadership_people_legacy; COMMIT;');
  } catch (error) {
    database.exec('ROLLBACK;');
    throw error;
  } finally {
    database.exec('PRAGMA legacy_alter_table = OFF; PRAGMA foreign_keys = ON;');
  }
}

function ensureColumn(database: DatabaseSync, table: string, column: string, sql: string) {
  const columns = database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) database.exec(`ALTER TABLE ${table} ADD COLUMN ${sql}`);
}

function migrateAdminControls(database: DatabaseSync) {
  ensureColumn(database, 'portal_accounts', 'hidden_at', 'hidden_at TEXT');
  ensureColumn(database, 'portal_organizations', 'hidden_at', 'hidden_at TEXT');
  ensureColumn(database, 'portal_applications', 'hidden_at', 'hidden_at TEXT');
}

function initialize(database: DatabaseSync) {
  database.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  database.exec(createPortalSchemaSql);
  migrateAdminControls(database);
  migrateApplicationRevision(database);
  const configuredCutoff = Number(process.env.GUTV_SESSION_V2_CUTOFF_AT);
  const legacyCutoff = Number.isSafeInteger(configuredCutoff) && configuredCutoff > Math.floor(Date.now() / 1000)
    ? configuredCutoff
    : Math.floor(Date.now() / 1000) + 12 * 60 * 60;
  database.prepare('INSERT OR IGNORE INTO portal_session_control_state (id, legacy_v2_cutoff_at) VALUES (1, ?)').run(legacyCutoff);
  migrateLeadershipPeople(database);
  initializeAccess(database);
  initializeSpecialties(database);
  database.exec('BEGIN IMMEDIATE');
  try {
    const seeded = database.prepare('SELECT version FROM portal_leadership_seed_state WHERE version = ?').get(leadershipSeed.version);
    if (!seeded) {
      const person = database.prepare('INSERT INTO portal_leadership_people (id, name, description, photo_url, photo_position, photo_scale) VALUES (?, ?, ?, ?, ?, 1)');
      leadershipSeed.people.forEach((item) => person.run(item.id, item.name, item.description, item.photoUrl, item.photoPosition));
      const position = database.prepare('INSERT INTO portal_leadership_positions (title, person_id, sort_order) VALUES (?, ?, ?)');
      leadershipSeed.positions.forEach((item, index) => position.run(item.title, item.personId, index + 1));
      database.prepare('INSERT INTO portal_leadership_seed_state (version) VALUES (?)').run(leadershipSeed.version);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}

export function database() {
  const path = databasePath();
  if (connection && connectionPath === path) return connection;

  connection?.close();
  connection = new DatabaseSync(path);
  connectionPath = path;
  initialize(connection);
  return connection;
}
