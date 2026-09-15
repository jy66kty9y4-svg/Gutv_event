import { database } from '@/db/server';
import type { FilmingBrief, FilmingSlot } from '@/app/filming-brief';

export function loadFilmingBrief(applicationId: number): FilmingBrief | null {
  const db = database();
  const brief = db.prepare('SELECT request_kind AS requestKind, scenario, participants, rules_accepted_at AS rulesAcceptedAt FROM portal_application_briefs WHERE application_id = ?').get(applicationId) as Omit<FilmingBrief, 'slots'> | undefined;
  if (!brief) return null;
  const slots = db.prepare('SELECT starts_at AS startsAt, ends_at AS endsAt, location FROM portal_filming_slots WHERE application_id = ? ORDER BY sort_order').all(applicationId) as FilmingSlot[];
  const delivery = db.prepare('SELECT delivery_date FROM portal_application_delivery_dates WHERE application_id = ?').get(applicationId) as { delivery_date: string } | undefined;
  return { ...brief, slots, deliveryDate: delivery?.delivery_date || '' };
}
// The caller owns the surrounding transaction, including the base application row.
export function saveFilmingBrief(applicationId: number, brief: FilmingBrief) {
  const db = database();
  db.prepare('INSERT INTO portal_application_delivery_dates (application_id, delivery_date) VALUES (?, ?) ON CONFLICT(application_id) DO UPDATE SET delivery_date = excluded.delivery_date').run(applicationId, brief.deliveryDate || '');
  db.prepare(`INSERT INTO portal_application_briefs (application_id, request_kind, scenario, participants, rules_accepted_at)
    VALUES (?, ?, ?, ?, ?) ON CONFLICT(application_id) DO UPDATE SET request_kind = excluded.request_kind, scenario = excluded.scenario, participants = excluded.participants`).run(applicationId, brief.requestKind, brief.scenario, brief.participants, brief.rulesAcceptedAt);
  db.prepare('DELETE FROM portal_filming_slots WHERE application_id = ?').run(applicationId);
  const insert = db.prepare('INSERT INTO portal_filming_slots (application_id, sort_order, starts_at, ends_at, location) VALUES (?, ?, ?, ?, ?)');
  brief.slots.forEach((slot, index) => insert.run(applicationId, index, slot.startsAt, slot.endsAt, slot.location));
}
