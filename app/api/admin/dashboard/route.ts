import { applicationRows, requiredPrivilege, serializeApplications } from '@/app/server/portal';
import { hasPrivilege } from '@/app/server/access';
import { database } from '@/db/server';
import { filmingDateBounds } from '@/app/filming-validation';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const session = await requiredPrivilege(request, 'panel.access');
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  const db = database();
  const applications = hasPrivilege(session, 'applications.manage') ? serializeApplications(applicationRows(), true) : [];
  const visibleApplications = applications.filter((item) => !item.hiddenAt);
  const organizations = hasPrivilege(session, 'organizations.manage') ? db.prepare(`
    SELECT o.id, o.type, o.name, o.representative_name, o.contact, o.telegram_chat_id,
      o.status, o.decision_note, o.created_at, o.updated_at,
      a.id AS account_id, a.username, a.last_login_at
    FROM portal_organizations o
    LEFT JOIN portal_accounts a ON a.organization_id = o.id AND a.role = 'requester'
    WHERE o.hidden_at IS NULL
    ORDER BY CASE o.status WHEN 'pending' THEN 0 ELSE 1 END, o.created_at DESC
  `).all() : [];
  const specialties = (hasPrivilege(session, 'specialties.manage') || hasPrivilege(session, 'applications.manage')) ? db.prepare(`
    SELECT id, name, active, sort_order, created_at FROM portal_specialties ORDER BY active DESC, sort_order, name
  `).all() : [];
  const stats = {
    reviewApplications: visibleApplications.filter((item) => item.status === 'review').length,
    pendingOrganizations: organizations.filter((item) => (item as { status: string }).status === 'pending').length,
    openApplications: visibleApplications.filter((item) => !['completed', 'rejected', 'cancelled'].includes(item.status)).length,
    upcomingApplications: visibleApplications.filter((item) => item.eventDate >= filmingDateBounds().min && ['approved', 'in_progress'].includes(item.status)).length,
    completedApplications: visibleApplications.filter((item) => item.status === 'completed').length,
    averageRating: (() => {
      const ratings = applications.flatMap((item) => item.review ? [item.review.rating] : []);
      return ratings.length ? Math.round(ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length * 10) / 10 : null;
    })(),
  };
  return Response.json({ applications, organizations, specialties, stats, privileges: session.privileges, displayName: session.displayName, organizationId: session.organizationId }, { headers: { 'Cache-Control': 'private, no-store' } });
}
