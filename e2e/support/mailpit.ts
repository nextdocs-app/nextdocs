const MAILPIT_URL = process.env.E2E_MAILPIT_URL ?? 'http://localhost:8025';

interface MailpitMessageSummary {
  ID: string;
  To: Array<{ Address: string }>;
}

interface MailpitMessage extends MailpitMessageSummary {
  Text?: string;
  HTML?: string;
}

/** The invite link carries the single-use token in its fragment. */
const INVITE_TOKEN = /join#token=([A-Za-z0-9_-]+)/;

export async function clearMailpit(): Promise<void> {
  await fetch(`${MAILPIT_URL}/api/v1/messages`, { method: 'DELETE' });
}

/**
 * Waits for the invite email to `email` and returns its token.
 *
 * This is the real signup path: the API intentionally never returns the token,
 * so the only way to accept an invite is the mailbox. Mailpit is the local SMTP
 * sink the dev stack already runs.
 */
export async function waitForInviteToken(email: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  let lastError = 'no invite email';

  while (Date.now() < deadline) {
    const response = await fetch(`${MAILPIT_URL}/api/v1/messages`);
    if (response.ok) {
      const list = (await response.json()) as { messages: MailpitMessageSummary[] };
      const message = list.messages.find((entry) =>
        entry.To.some((to) => to.Address.toLowerCase() === email.toLowerCase())
      );
      if (message) {
        const detailResponse = await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`);
        const detail = (await detailResponse.json()) as MailpitMessage;
        const match = `${detail.Text ?? ''}\n${detail.HTML ?? ''}`.match(INVITE_TOKEN);
        if (match) {
          return match[1];
        }
        lastError = 'invite email has no token link';
      }
    } else {
      lastError = `Mailpit answered ${response.status}`;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`Could not read an invite for ${email} from ${MAILPIT_URL}: ${lastError}`);
}
