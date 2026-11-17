export type MailMessage = { to: string; subject: string; text: string; html: string };

export type Mailer = { send(message: MailMessage): Promise<void> };

/** A failed send. The message names the status only, never the response body or the request. */
export class MailerError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`mail provider answered ${status}`);
    this.name = "MailerError";
    this.status = status;
  }
}

export type ResendMailerOptions = {
  apiKey: string;
  from: string;
  /** For tests. Default: the global fetch. */
  fetch?: typeof fetch;
};

/** Sends through Resend: POST https://api.resend.com/emails with a Bearer key. A non-2xx answer throws MailerError. */
export function resendMailer(options: ResendMailerOptions): Mailer {
  const { apiKey, from } = options;
  const doFetch = options.fetch ?? fetch;
  return {
    async send(message) {
      const response = await doFetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to: message.to, subject: message.subject, text: message.text, html: message.html }),
      });
      if (!response.ok) throw new MailerError(response.status);
    },
  };
}

/** Records messages instead of sending them. */
export function stubMailer(): Mailer & { sent: MailMessage[] } {
  const sent: MailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}
