import { expect, test } from '../support/fixtures';
import { readDocumentText } from '../support/api';
import { blockRealtime, failContentRead } from '../support/network';
import { editor, openDocument, openSignedIn } from '../support/session';

test.describe('editor', () => {
  test('keeps typed content across a reload', async ({ browser, docId }) => {
    const { context, page } = await openSignedIn(browser);
    try {
      const editable = await openDocument(page, docId);
      await editable.click();
      await page.keyboard.type('Persisted from the editor');

      await expect(editable).toContainText('Persisted from the editor');

      await page.reload();
      const reloaded = await openDocument(page, docId);
      await expect(reloaded).toContainText('Persisted from the editor');
    } finally {
      await context.close();
    }
  });

  test('renders server content while the realtime server is unreachable', async ({
    auth,
    browser,
    docId,
  }) => {
    const writer = await openSignedIn(browser);
    const reader = await openSignedIn(browser);
    try {
      const writerEditor = await openDocument(writer.page, docId);
      await writerEditor.click();
      await writer.page.keyboard.type('Content written before the outage');
      await expect(writerEditor).toContainText('Content written before the outage');

      // The reader's first paint reads Yhub through the API, so wait until the
      // writer's update reached the server before taking the socket away.
      await expect
        .poll(() => readDocumentText(auth.accessToken, docId))
        .toContain('Content written before the outage');

      // The reader's first paint cannot use the socket; it must come from the
      // API's document content read instead of an empty editor.
      const block = await blockRealtime(reader.page);
      const readerEditor = await openDocument(reader.page, docId);
      await expect(readerEditor).toContainText('Content written before the outage');
      await expect.poll(() => block.connections()).toBeGreaterThan(0);
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test('falls back to the cached document when the content read fails', async ({
    browser,
    docId,
  }) => {
    const first = await openSignedIn(browser);
    try {
      const editable = await openDocument(first.page, docId);
      await editable.click();
      await first.page.keyboard.type('Cached while the API is failing');
      await expect(editable).toContainText('Cached while the API is failing');

      // Warm the IndexedDB copy so the fallback has something to paint.
      await first.page.reload();
      await expect(editor(first.page)).toContainText('Cached while the API is failing');

      const block = await blockRealtime(first.page);
      await failContentRead(first.page);

      await first.page.reload();
      const cached = editor(first.page);
      await expect(cached).toBeVisible();
      await expect(cached).toContainText('Cached while the API is failing');
      // This failure path paints before the provider is usable, so there is no
      // socket to count here; `blockRealtime` still closes any that do open.
      expect(block.connections()).toBe(0);
    } finally {
      await first.context.close();
    }

    // With a normal network the document still has the same content: the
    // fallback painted a copy, it did not invent or drop anything.
    const recovered = await openSignedIn(browser);
    try {
      await expect(await openDocument(recovered.page, docId)).toContainText(
        'Cached while the API is failing'
      );
    } finally {
      await recovered.context.close();
    }
  });
});
