import { loadFilmingBrief } from '@/app/server/filming-brief';
import type { FilmingBrief } from '@/app/filming-brief';
import { sessionFromRequest, type AuthSession } from '@/app/auth';
import { validateStatefulSession } from '@/app/server/session-control';
import { hasPrivilege } from '@/app/server/access';
import type { Privilege } from '@/app/access-types';
import { database } from '@/db/server';

export const portalStatuses = ['review', 'clarification', 'approved', 'in_progress', 'completed', 'rejected', 'cancelled'] as const;
export type PortalStatus = typeof portalStatuses[number];

export const statusLabels: Record<PortalStatus, string> = {
  review: 'На рассмотрении',
  clarification: 'Требует уточнения',
  approved: 'Согласована',
  in_progress: 'В работе',
  completed: 'Выполнена',
  rejected: 'Отклонена',
  cancelled: 'Отменена',
};

export type PortalApplication = {
  brief: FilmingBrief | null;
  id: number;
  number: string;
  organizationId: number;
  organizationName: string;
  eventTitle: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  eventDescription: string;
  requestedEquipment: string;
  assignedEquipment: string;
  contactName: string;
  contactChannel: string;
  customerComment: string;
  internalComment: string;
  status: PortalStatus;
  closingReason: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  hiddenAt: string | null;
  specialists: Array<{ id: number; name: string; requestedCount: number; assignedCount: number; assignedNames: string }>;
  attachments: Array<{ id: number; name: string; mimeType: string; size: number }>;
  review: { rating: number; comment: string; createdAt: string; updatedAt: string } | null;
  history: Array<{ fromStatus: PortalStatus | null; toStatus: PortalStatus; note: string; createdAt: string }>;
};

type ApplicationRow = {
  id: number;
  organization_id: number;
  organization_name: string;
  event_title: string;
  event_date: string;
  start_time: string;
  end_time: string;
  location: string;
  event_description: string;
  requested_equipment: string;
  assigned_equipment: string;
  contact_name: string;
  contact_channel: string;
  customer_comment: string;
  internal_comment: string;
  status: PortalStatus;
  closing_reason: string;
  created_at: string;
  updated_at: string;
  revision: number;
  hidden_at: string | null;
};

function applicationNumber(id: number, createdAt: string) {
  const year = /^\d{4}/.test(createdAt) ? createdAt.slice(0, 4) : new Date().getFullYear().toString();
  return `GTV-${year}-${String(id).padStart(4, '0')}`;
}

export async function requiredSession(request: Request, role?: AuthSession['role']) {
  const session = await sessionFromRequest(request);
  if (!session) return null;
  const current = await validateStatefulSession(session, request);
  if (!current || (role === 'management' && !hasPrivilege(current, 'panel.access')) || (role === 'requester' && !current.organizationId)) return null;
  return current;
}

export async function requiredPrivilege(request: Request, privilege: Privilege) {
  const session = await requiredSession(request);
  return session && hasPrivilege(session, privilege) ? session : null;
}

export function isPortalStatus(value: unknown): value is PortalStatus {
  return typeof value === 'string' && portalStatuses.includes(value as PortalStatus);
}

export function cleanText(value: unknown, max: number) {
  return typeof value === 'string' ? value.trim().replace(/\r\n/g, '\n').slice(0, max) : '';
}

export function serializeApplications(rows: ApplicationRow[], includeInternal: boolean) {
  const db = database();
  const specialistQuery = db.prepare(`
    SELECT s.id, s.name, aps.requested_count, aps.assigned_count, aps.assigned_names
    FROM portal_application_specialists aps
    JOIN portal_specialties s ON s.id = aps.specialty_id
    WHERE aps.application_id = ? ORDER BY s.sort_order, s.name
  `);
  const attachmentQuery = db.prepare(`
    SELECT id, original_name, mime_type, size_bytes FROM portal_attachments
    WHERE application_id = ? ORDER BY id
  `);
  const reviewQuery = db.prepare(`
    SELECT rating, comment, created_at, updated_at FROM portal_reviews WHERE application_id = ?
  `);
  const historyQuery = db.prepare(`
    SELECT from_status, to_status, note, created_at FROM portal_status_history
    WHERE application_id = ? ORDER BY id DESC
  `);

  return rows.map((row): PortalApplication => {
    const review = reviewQuery.get(row.id) as { rating: number; comment: string; created_at: string; updated_at: string } | undefined;
    return {
      brief: loadFilmingBrief(row.id),
      id: row.id,
      number: applicationNumber(row.id, row.created_at),
      organizationId: row.organization_id,
      organizationName: row.organization_name,
      eventTitle: row.event_title,
      eventDate: row.event_date,
      startTime: row.start_time,
      endTime: row.end_time,
      location: row.location,
      eventDescription: row.event_description,
      requestedEquipment: row.requested_equipment,
      assignedEquipment: row.assigned_equipment,
      contactName: row.contact_name,
      contactChannel: row.contact_channel,
      customerComment: row.customer_comment,
      internalComment: includeInternal ? row.internal_comment : '',
      status: row.status,
      closingReason: row.closing_reason,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision,
      hiddenAt: row.hidden_at,
      specialists: (specialistQuery.all(row.id) as Array<{ id: number; name: string; requested_count: number; assigned_count: number; assigned_names: string }>).map((item) => ({
        id: item.id,
        name: item.name,
        requestedCount: item.requested_count,
        assignedCount: item.assigned_count,
        assignedNames: item.assigned_names,
      })),
      attachments: (attachmentQuery.all(row.id) as Array<{ id: number; original_name: string; mime_type: string; size_bytes: number }>).map((item) => ({
        id: item.id,
        name: item.original_name,
        mimeType: item.mime_type,
        size: item.size_bytes,
      })),
      review: review ? { rating: review.rating, comment: review.comment, createdAt: review.created_at, updatedAt: review.updated_at } : null,
      history: (historyQuery.all(row.id) as Array<{ from_status: PortalStatus | null; to_status: PortalStatus; note: string; created_at: string }>).map((item) => ({
        fromStatus: item.from_status,
        toStatus: item.to_status,
        note: item.note,
        createdAt: item.created_at,
      })),
    };
  });
}

export function applicationRows(where = '', values: Array<string | number> = []) {
  const db = database();
  return db.prepare(`
    SELECT a.*, o.name AS organization_name
    FROM portal_applications a
    JOIN portal_organizations o ON o.id = a.organization_id
    ${where}
    ORDER BY a.event_date DESC, a.id DESC
  `).all(...values) as ApplicationRow[];
}

export function createNotification(organizationId: number, applicationId: number | null, title: string, body: string) {
  database().prepare(`
    INSERT INTO portal_notifications (organization_id, application_id, title, body)
    VALUES (?, ?, ?, ?)
  `).run(organizationId, applicationId, title.slice(0, 160), body.slice(0, 1000));
}
