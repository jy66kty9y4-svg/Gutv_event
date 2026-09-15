import type { DatabaseSync } from 'node:sqlite';

/** Additive migration: old images can continue to read every existing record. */
export function migrateApplicationRevision(database: DatabaseSync) {
  database.exec('BEGIN IMMEDIATE');
  try {
    const columns = database.prepare('PRAGMA table_info(portal_applications)').all() as Array<{ name: string }>;
    if (!columns.some(column => column.name === 'revision')) {
      database.exec('ALTER TABLE portal_applications ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
    }
    // Rollback images update named business columns without knowing about revision.
    // Keep their writes visible to a newer form after rolling forward again.
    // Explicit CAS increments skip this trigger, including with recursive triggers enabled.
    database.exec(`CREATE TRIGGER IF NOT EXISTS portal_applications_legacy_revision
      AFTER UPDATE ON portal_applications
      FOR EACH ROW WHEN NEW.revision = OLD.revision
      BEGIN
        UPDATE portal_applications SET revision = OLD.revision + 1 WHERE id = NEW.id;
      END;`);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
