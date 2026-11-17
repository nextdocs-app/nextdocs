import type { Browser, BrowserContext, Page, TestInfo } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { API_URL, E2eAccount, OWNER, WEB_URL } from './config';
import { ApiAuth, ensureOwnerSession } from './api';

export interface SignedInSession {
  context: BrowserContext;
  page: Page;
}

interface RecordedSession {
  context: BrowserContext;
  pages: Page[];
}

/**
 * Explicit contexts opened during the current test. Playwright Test traces and
 * screenshots every context it sees, but a manually created one has to ask for
 * video itself and decide what to keep, which is what the auto fixture in
 * `fixtures.ts` does with this list.
 */
let recordedSessions: RecordedSession[] = [];
/** The resolved `video` option, set by the artifact fixture before each test. */
let sessionVideoMode = 'off';

/** Starts a test's session list and captures the resolved `video` option. */
export function startSessionArtifacts(video: unknown): void {
  recordedSessions = [];
  sessionVideoMode =
    typeof video === 'string' ? video : ((video as { mode?: string } | undefined)?.mode ?? 'off');
}

/** Closes the explicit contexts and keeps their video only for a failed test. */
export async function closeRecordedSessions(testInfo: TestInfo): Promise<void> {
  const sessions = recordedSessions;
  recordedSessions = [];

  const preserve = sessionVideoMode === 'on' || testInfo.status !== testInfo.expectedStatus;
  let index = 0;

  for (const session of sessions) {
    await session.context.close();
    if (sessionVideoMode === 'off') {
      continue;
    }
    for (const page of session.pages) {
      const video = page.video();
      if (!video) {
        continue;
      }
      if (preserve) {
        const path = testInfo.outputPath(`video${index ? `-${index}` : ''}.webm`);
        index += 1;
        await video.saveAs(path);
        await testInfo.attach('video', { path, contentType: 'video/webm' });
      } else {
        await video.delete();
      }
    }
  }
}

/**
 * Opens a browser context signed in as the seeded account.
 *
 * The login runs through the context's own request client, so the HttpOnly
 * refresh cookie lands in that context's jar and the app hydrates a session on
 * first navigation. Every browser test gets its own context (and therefore its
 * own client/awareness identity) from this one helper.
 */
export async function openSignedIn(
  browser: Browser,
  account: E2eAccount = OWNER
): Promise<SignedInSession> {
  const testInfo = test.info();
  const context = await browser.newContext(
    sessionVideoMode === 'off' ? {} : { recordVideo: { dir: testInfo.outputPath('videos') } }
  );

  const recorded: RecordedSession = { context, pages: [] };
  recordedSessions.push(recorded);
  context.on('page', (page) => {
    if (!recorded.pages.includes(page)) {
      recorded.pages.push(page);
    }
  });

  const response = await context.request.post(`${API_URL}/api/v1/auth/login`, {
    data: { email: account.email, password: account.password },
  });
  if (!response.ok()) {
    throw new Error(`Login failed with ${response.status()}: ${await response.text()}`);
  }
  const page = await context.newPage();
  return { context, page };
}

/** BlockNote's editable root inside the document page (comment editors excluded). */
export function editor(page: Page) {
  return page.locator('main .bn-editor[contenteditable="true"]').first();
}

/**
 * Navigates to a document and waits until the editor is mounted. Read-only
 * collaborators (VIEW/COMMENT) get the editor without an editable surface.
 */
export async function openDocument(
  page: Page,
  documentId: string,
  options: { editable?: boolean } = {}
) {
  await page.goto(`/doc/${documentId}`);
  const root = page.locator('main .bn-editor').first();
  await expect(root).toBeVisible();

  if (options.editable === false) {
    await expect(root).toHaveAttribute('contenteditable', 'false');
    return root;
  }

  const editable = editor(page);
  await expect(editable).toBeVisible();
  await expect(editable).toHaveAttribute('contenteditable', 'true');
  return editable;
}

/** Logs in through the API and returns a bearer token for seeding. */
export async function seedSession(): Promise<ApiAuth> {
  return ensureOwnerSession();
}

export { WEB_URL };
