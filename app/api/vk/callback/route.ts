import {
  saveVkWallPost,
  validVkCallbackSecret,
  vkConfirmationCode,
  vkGroupId,
} from '@/app/server/vk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type CallbackPayload = {
  type?: unknown;
  group_id?: unknown;
  secret?: unknown;
  object?: unknown;
};

function plainText(value: string, status = 200) {
  return new Response(value, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 1_000_000) return plainText('payload too large', 413);

  let payload: CallbackPayload;
  try {
    payload = await request.json() as CallbackPayload;
  } catch {
    return plainText('invalid json', 400);
  }

  if (Number(payload.group_id) !== vkGroupId()) return plainText('wrong group', 403);
  if (!validVkCallbackSecret(payload.secret)) return plainText('wrong secret', 403);

  if (payload.type === 'confirmation') {
    try {
      return plainText(await vkConfirmationCode());
    } catch {
      return plainText('confirmation unavailable', 502);
    }
  }

  if (payload.type === 'wall_post_new') {
    try {
      saveVkWallPost(payload);
    } catch {
      return plainText('post rejected', 400);
    }
  }

  return plainText('ok');
}
