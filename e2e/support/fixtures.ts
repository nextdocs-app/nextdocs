import { test as base } from '@playwright/test';
import {
  ApiAuth,
  createDocument,
  deleteDocument,
  ensureMemberSession,
  ensureOwnerSession,
} from './api';
import { closeRecordedSessions, startSessionArtifacts } from './session';

interface SeededFixtures {
  /** Bearer session for seeding documents and any API assertions. */
  auth: ApiAuth;
  /** The second workspace member, invited through the real invite flow. */
  memberAuth: ApiAuth;
  /** Fresh empty document per test, removed afterwards. */
  docId: string;
  /** Releases the contexts `openSignedIn` created and their failure-only video. */
  sessionArtifacts: void;
}

/**
 * Common data fill for every browser test: one account (created once on the
 * fresh E2E database) and one isolated document per test.
 */
export const test = base.extend<SeededFixtures>({
  sessionArtifacts: [
    async ({ video }, use, testInfo) => {
      startSessionArtifacts(video);
      await use();
      await closeRecordedSessions(testInfo);
    },
    { auto: true },
  ],
  auth: async ({}, use) => {
    await use(await ensureOwnerSession());
  },
  memberAuth: async ({}, use) => {
    await use(await ensureMemberSession());
  },
  docId: async ({ auth }, use) => {
    const docId = await createDocument(
      auth.accessToken,
      `E2E ${new Date().toISOString()} ${Math.random().toString(36).slice(2, 8)}`
    );
    await use(docId);
    // Let a failure surface: swallowed teardown errors are how the E2E database
    // silently accumulated documents from every run.
    await deleteDocument(auth.accessToken, docId);
  },
});

export { expect } from '@playwright/test';
