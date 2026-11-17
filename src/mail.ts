import { resendMailer, type Mailer } from "./app-kit/index.ts";
import type { Config } from "./config.js";

/**
 * The real mailer when RESEND_API_KEY is set, otherwise undefined: the kit then sends nothing, sign-up still
 * works and lost-code answers the same. The key is only ever handed to the kit, never logged or echoed.
 */
export function createMailer(config: Pick<Config, "resendApiKey" | "mailFrom">, options: { fetch?: typeof fetch } = {}): Mailer | undefined {
  if (!config.resendApiKey) return undefined;
  return resendMailer({ apiKey: config.resendApiKey, from: config.mailFrom, fetch: options.fetch });
}
