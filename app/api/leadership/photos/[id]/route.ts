import { database } from '@/db/server';

export const runtime = 'nodejs';

export function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return context.params.then(({ id }) => {
    if (!/^[1-9]\d*$/.test(id)) return Response.json({ error: 'Не найдено' }, { status: 404 });
    const photoId = Number(id);
    if (!Number.isSafeInteger(photoId)) return Response.json({ error: 'Не найдено' }, { status: 404 });
    const row = database().prepare('SELECT mime_type, bytes FROM portal_leadership_photos WHERE id = ?').get(photoId) as { mime_type: string; bytes: Uint8Array } | undefined;
    if (!row || !['image/jpeg', 'image/png', 'image/webp'].includes(row.mime_type)) return Response.json({ error: 'Не найдено' }, { status: 404 });
    const body = new Uint8Array(row.bytes).slice().buffer;
    return new Response(body, {
      headers: {
        'Content-Type': row.mime_type,
        'Content-Length': String(row.bytes.byteLength),
        'Cache-Control': row.mime_type === 'image/webp' ? 'public, max-age=86400, immutable' : 'public, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
