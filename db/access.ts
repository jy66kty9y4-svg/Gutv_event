import type { DatabaseSync } from 'node:sqlite';
import { allPrivileges } from '../app/access-types';

// Additive, one-time migration. Existing account types and sessions stay intact.
export function initializeAccess(db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portal_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
      name_key TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      administrator INTEGER NOT NULL DEFAULT 0 CHECK(administrator IN (0,1)),
      privileges_json TEXT NOT NULL DEFAULT '[]',
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_portal_one_administrator_role ON portal_roles(administrator) WHERE administrator = 1;
    CREATE TABLE IF NOT EXISTS portal_user_roles (
      account_id INTEGER NOT NULL REFERENCES portal_accounts(id) ON DELETE CASCADE,
      role_id INTEGER NOT NULL REFERENCES portal_roles(id) ON DELETE RESTRICT,
      PRIMARY KEY(account_id, role_id)
    );
    CREATE TABLE IF NOT EXISTS portal_user_role_versions (
      account_id INTEGER PRIMARY KEY REFERENCES portal_accounts(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE IF NOT EXISTS portal_access_migrations (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS portal_access_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER NOT NULL,
      action TEXT NOT NULL, target_id INTEGER NOT NULL, before_json TEXT NOT NULL,
      after_json TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    BEGIN IMMEDIATE;
  `);
  try {
    if (!db.prepare('SELECT version FROM portal_access_migrations WHERE version = 1').get()) {
      const insert = db.prepare('INSERT INTO portal_roles (name,name_key,description,administrator,privileges_json) VALUES (?,?,?,?,?)');
      const admin = insert.run('Администратор', 'администратор', 'Максимальная роль. Все текущие и будущие привилегии.', 1, '[]');
      insert.run('Директор', 'директор', 'Управление работой студии и материалами сайта.', 0, JSON.stringify(allPrivileges.filter(p => p !== 'access.manage')));
      insert.run('Молодость', 'молодость', 'Работа с проектами студии.', 0, JSON.stringify(['panel.access', 'projects.manage']));
      insert.run('Бухгалтер', 'бухгалтер', 'Доступ в панель. Дополнительные права назначает администратор.', 0, JSON.stringify(['panel.access']));
      db.prepare("INSERT INTO portal_user_roles (account_id,role_id) SELECT id,? FROM portal_accounts WHERE role = 'management'").run(admin.lastInsertRowid);
      db.prepare('INSERT INTO portal_access_migrations (version) VALUES (1)').run();
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
