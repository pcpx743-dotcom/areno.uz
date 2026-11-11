/** Minimal Telegram Bot API client (no dependency). Swappable for a fake in tests. */

export class TelegramError extends Error {
  constructor(
    public code: number,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

export interface TelegramApi {
  call<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export class HttpTelegramApi implements TelegramApi {
  constructor(
    private token: string,
    private base = 'https://api.telegram.org',
  ) {}

  async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const res = await fetch(`${this.base}/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout(method === 'getUpdates' ? 40_000 : 15_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      result?: T;
      error_code?: number;
      description?: string;
      parameters?: { retry_after?: number };
    };
    if (!data.ok) throw new TelegramError(data.error_code ?? res.status, data.description ?? 'Telegram error', data.parameters?.retry_after);
    return data.result as T;
  }
}

// ---- the subset of Telegram types we use ----
export interface TgUser {
  id: number;
  first_name?: string;
}
export interface TgMessage {
  message_id: number;
  from?: TgUser;
  chat: { id: number; type: string };
  text?: string;
  contact?: { phone_number: string; user_id?: number; first_name?: string };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}
