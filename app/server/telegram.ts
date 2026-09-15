export async function notifyTelegram(chatId: string | undefined | null, text: string) {
  const token = process.env.GUTV_TELEGRAM_BOT_TOKEN;
  if (!token || !chatId) return { sent: false, reason: 'not_configured' as const };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: controller.signal,
    });
    if (!response.ok) {
      console.error('Telegram notification failed', { status: response.status });
      return { sent: false, reason: 'request_failed' as const };
    }
    return { sent: true as const };
  } catch (error) {
    console.error('Telegram notification failed', { message: error instanceof Error ? error.message : 'Unknown error' });
    return { sent: false, reason: 'request_failed' as const };
  } finally {
    clearTimeout(timeout);
  }
}
