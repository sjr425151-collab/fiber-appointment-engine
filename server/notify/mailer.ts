/**
 * Email transport. ResendMailer talks to the Resend REST API directly (no SDK);
 * LogMailer is used when no API key is configured (development, or before the
 * sending domain is set up) and just prints a summary.
 */

export interface OutgoingEmail {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string[];
  attachments?: { filename: string; content: string /* base64 */ }[];
  tags?: { name: string; value: string }[];
  /** Same key → Resend won't send twice (24h window). We use the outbox row id. */
  idempotencyKey: string;
}

export interface SendResult {
  /** 'sent' via a real provider, or 'logged' when no provider is configured. */
  status: 'sent' | 'logged';
  providerId: string;
}

export class MailError extends Error {
  constructor(
    message: string,
    /** Whether trying again later could succeed (network errors, 429, 5xx). */
    public retryable: boolean,
  ) {
    super(message);
  }
}

export interface Mailer {
  readonly enabled: boolean;
  send(email: OutgoingEmail): Promise<SendResult>;
}

export class ResendMailer implements Mailer {
  readonly enabled = true;
  constructor(
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async send(e: OutgoingEmail): Promise<SendResult> {
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': e.idempotencyKey,
        },
        body: JSON.stringify({
          from: e.from,
          to: e.to,
          subject: e.subject,
          html: e.html,
          text: e.text,
          ...(e.replyTo?.length ? { reply_to: e.replyTo } : {}),
          ...(e.attachments?.length ? { attachments: e.attachments } : {}),
          ...(e.tags?.length ? { tags: e.tags } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new MailError(`Network error: ${err instanceof Error ? err.message : String(err)}`, true);
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new MailError(`Resend ${res.status}: ${body.message ?? body.name ?? 'request failed'}`.slice(0, 500), retryable);
    }
    return { status: 'sent', providerId: body.id ?? '' };
  }
}

export class LogMailer implements Mailer {
  readonly enabled = false;
  constructor(private quiet = false) {}
  async send(e: OutgoingEmail): Promise<SendResult> {
    // No recipient or subject in logs — both can contain personal data.
    if (!this.quiet) console.log(`[email:not-configured] would send ${e.tags?.[0]?.value ?? 'email'} (${e.to.length} recipient(s))`);
    return { status: 'logged', providerId: '' };
  }
}
