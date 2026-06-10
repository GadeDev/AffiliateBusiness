/**
 * Slack Incoming Webhook notifier. No-op (logs only) when SLACK_WEBHOOK_URL is unset,
 * so local runs never fail on a missing webhook.
 */
export async function postSlack(text: string): Promise<void> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) {
    console.log('[slack:disabled]', text);
    return;
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      console.error(`[slack] non-2xx: ${res.status} ${await res.text()}`);
    }
  } catch (err) {
    console.error('[slack] failed:', err);
  }
}
