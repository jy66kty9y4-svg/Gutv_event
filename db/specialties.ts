import type { DatabaseSync } from 'node:sqlite';
import { defaultSpecialties } from './schema';

export function initializeSpecialties(database: DatabaseSync) {
  database.exec('BEGIN IMMEDIATE');
  try {
    // Preserve IDs, existing assignments, ordering and archive settings when renaming.
    database.prepare(`UPDATE portal_specialties SET name = 'Специалист по видеопоказу'
      WHERE name = 'Режиссёр трансляции' AND NOT EXISTS (
        SELECT 1 FROM portal_specialties WHERE name = 'Специалист по видеопоказу'
      )`).run();
    const insert = database.prepare('INSERT OR IGNORE INTO portal_specialties (name, sort_order) VALUES (?, ?)');
    defaultSpecialties.forEach((name, index) => insert.run(name, index + 1));
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
}
