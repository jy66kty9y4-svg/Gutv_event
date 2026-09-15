import { sameOriginRequest } from '@/app/auth';
import { leadershipImage } from '@/app/server/leadership';
import { requiredPrivilege } from '@/app/server/portal';
import { database } from '@/db/server';

import type { Privilege } from '@/app/access-types';

export async function uploadManagementPhoto(request: Request, privilege: Extract<Privilege, 'leadership.manage' | 'projects.manage'>) {
  const session = await requiredPrivilege(request, privilege);
  if (!session) return Response.json({ error: 'Недостаточно прав' }, { status: 403 });
  if (!sameOriginRequest(request)) return Response.json({ error: 'Запрос отклонён' }, { status: 403 });
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Некорректная форма' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size < 1 || file.size > 5 * 1024 * 1024) return Response.json({ error: 'Нужен файл JPEG, PNG или WebP до 5 МБ' }, { status: 400 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = await leadershipImage(bytes);
  if (!image) return Response.json({ error: 'Файл не является допустимым изображением' }, { status: 400 });
  const result = database().prepare('INSERT INTO portal_leadership_photos (mime_type, bytes, size_bytes) VALUES (?, ?, ?)').run(image.mimeType, image.bytes, image.bytes.length);
  return Response.json({ photoUrl: `/api/leadership/photos/${Number(result.lastInsertRowid)}` });
}
