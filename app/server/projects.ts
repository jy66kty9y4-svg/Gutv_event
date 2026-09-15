import { webpPhotoUrl } from '@/app/photo-source';
import { database } from '@/db/server';
import type { ProjectDraft, StudioProject } from '@/app/project-types';
import { isLeadershipPhotoUrl, leadershipPhotoPosition, leadershipPhotoScale } from './leadership';

const seeds: ProjectDraft[] = [
  { title: 'По другую сторону камеры', eyebrow: 'BACKSTAGE', description: 'Подготовка площадки, свет, звук и команда, из которых складывается каждый материал.', url: 'https://vk.ru/gutv_official', linkLabel: 'Смотреть в VK', photoUrl: '/media/on-set.webp', photoPosition: 'center center', photoScale: 1, tone: 'dark' },
  { title: 'Последняя перебивка', eyebrow: 'PEOPLE · ARCHIVE', description: 'История о выпускниках студии и о том, что остаётся после последнего университетского эфира.', url: 'https://l.vk.ru/wall-30973272_6869', linkLabel: 'Открыть материал', photoUrl: '', photoPosition: 'center center', photoScale: 1, tone: 'blue' },
  { title: 'Авторские работы', eyebrow: 'ORIGINALS · GUTV', description: 'Клипы, короткие фильмы и документальные истории, которые команда придумывает и выпускает сама.', url: 'https://vk.ru/gutv_official', linkLabel: 'Смотреть проекты', photoUrl: '', photoPosition: 'center center', photoScale: 1, tone: 'light' },
];
export function projectsDatabase() {
  const db = database();
  db.exec(`CREATE TABLE IF NOT EXISTS portal_studio_projects (id INTEGER PRIMARY KEY AUTOINCREMENT, content TEXT NOT NULL, sort_order INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS portal_projects_seed (id INTEGER PRIMARY KEY CHECK(id=1));`);
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT id FROM portal_projects_seed WHERE id=1').get()) {
      const insert = db.prepare('INSERT INTO portal_studio_projects (content, sort_order) VALUES (?, ?)');
      seeds.forEach((project, index) => insert.run(JSON.stringify(project), index + 1));
      db.prepare('INSERT INTO portal_projects_seed (id) VALUES (1)').run();
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return db;
}
export function studioProjects(): StudioProject[] {
  return (projectsDatabase().prepare('SELECT id, content, sort_order FROM portal_studio_projects ORDER BY sort_order, id').all() as { id: number; content: string; sort_order: number }[])
    .map(row => ({ ...JSON.parse(row.content) as ProjectDraft, id: row.id, sortOrder: row.sort_order }));
}
export function projectDraft(value: unknown): ProjectDraft | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  const fields = ['title','eyebrow','description','url','linkLabel','photoUrl','photoPosition','photoScale','tone'];
  if (Object.keys(v).length !== fields.length || Object.keys(v).some(k => !fields.includes(k))) return null;
  for (const [key, min, max] of [['title',2,120],['eyebrow',0,80],['description',0,600],['url',0,2048],['linkLabel',0,60]] as const) {
    if (typeof v[key] !== 'string' || v[key].trim().length < min || v[key].length > max) return null;
  }
  const url = (v.url as string).trim();
  if (url) {
    try { const parsed = new URL(url); if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return null; } catch { return null; }
  }
  if (typeof v.photoUrl !== 'string' || (v.photoUrl !== '' && !['/media/on-set.webp', '/media/on-set.jpg'].includes(v.photoUrl) && !isLeadershipPhotoUrl(v.photoUrl))) return null;
  const photoPosition = leadershipPhotoPosition(v.photoPosition), photoScale = leadershipPhotoScale(v.photoScale);
  if (!photoPosition || photoScale === null || !['dark','blue','light'].includes(v.tone as string)) return null;
  return { title: (v.title as string).trim(), eyebrow: (v.eyebrow as string).trim(), description: (v.description as string).trim(), url, linkLabel: (v.linkLabel as string).trim(), photoUrl: webpPhotoUrl(v.photoUrl), photoPosition, photoScale, tone: v.tone as ProjectDraft['tone'] };
}
