type ErrorRecord = Record<string, unknown>;

function record(value: unknown): ErrorRecord | null {
  return value !== null && typeof value === 'object' ? (value as ErrorRecord) : null;
}

function textValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sanitize(value: string): string {
  return value
    .replace(/oauth_[a-z_]+="[^"]+"/gi, 'oauth_***="***"')
    .replace(/(api[_ -]?key|access[_ -]?token|client[_ -]?secret)\s*[:=]\s*\S+/gi, '$1=***')
    .replace(/\s+/g, ' ')
    .trim();
}

function responseDetails(data: ErrorRecord | null): string[] {
  if (!data) return [];

  const values: string[] = [];
  for (const key of ['title', 'detail', 'error', 'reason']) {
    const value = textValue(data[key]);
    if (value) values.push(value);
  }

  if (Array.isArray(data.errors)) {
    for (const item of data.errors) {
      const error = record(item);
      if (!error) continue;
      const code = typeof error.code === 'number' ? String(error.code) : null;
      const detail = textValue(error.message) || textValue(error.detail) || textValue(error.title);
      if (detail) values.push(code ? `${code}: ${detail}` : detail);
    }
  }

  return [...new Set(values.map(sanitize))];
}

/**
 * Preserve the actionable X API response while deliberately excluding request
 * headers, OAuth signatures, and credentials from logs and Slack alerts.
 */
export function formatTwitterError(error: unknown): string {
  const obj = record(error);
  const code = typeof obj?.code === 'number' ? obj.code : null;
  const details = responseDetails(record(obj?.data));
  const message = error instanceof Error ? sanitize(error.message) : textValue(error) ? sanitize(String(error)) : '';

  if (details.length > 0) {
    return `${code ? `HTTP ${code}: ` : ''}${details.join(' / ')}`.slice(0, 700);
  }

  if (code === 402) {
    return 'HTTP 402: X APIクレジットが不足しています。対象のX Developerアカウントへ入金してください。';
  }
  if (code === 403) {
    return 'HTTP 403: Xが投稿を拒否しました。アプリの書き込み権限、権限変更後のアクセストークン、アカウント制限を確認してください。';
  }
  if (code) {
    return `HTTP ${code}${message ? `: ${message}` : ''}`.slice(0, 700);
  }

  return (message || 'Unknown X API error').slice(0, 700);
}
