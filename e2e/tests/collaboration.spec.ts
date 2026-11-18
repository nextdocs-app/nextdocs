import { expect, test } from '../support/fixtures';
import { tapRealtime } from '../support/network';
import { editor, openDocument, openSignedIn } from '../support/session';

test.describe('editor collaboration', () => {
  test('two clients see each other’s edits', async ({ browser, docId }) => {
    const clientA = await openSignedIn(browser);
    const clientB = await openSignedIn(browser);
    try {
      const editorA = await openDocument(clientA.page, docId);
      const editorB = await openDocument(clientB.page, docId);

      await editorA.click();
      await clientA.page.keyboard.type('Written by client A');
      await expect(editorB).toContainText('Written by client A');

      await editorB.click();
      await clientB.page.keyboard.press('End');
      await clientB.page.keyboard.type(' and client B');
      await expect(editorA).toContainText('and client B');
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('edits made while the network is down sync on reconnect', async ({ browser, docId }) => {
    const clientA = await openSignedIn(browser);
    const clientB = await openSignedIn(browser);
    try {
      const editorA = await openDocument(clientA.page, docId);
      const editorB = await openDocument(clientB.page, docId);

      await editorA.click();
      await clientA.page.keyboard.type('Seed');
      await expect(editorB).toContainText('Seed');

      await clientA.context.setOffline(true);
      await editorA.click();
      await clientA.page.keyboard.type(' added offline');
      await expect(editorA).toContainText('added offline');

      // While A is offline its update stays local: B must not have it yet.
      await clientB.page.waitForTimeout(1500);
      await expect(editorB).not.toContainText('added offline');

      await clientA.context.setOffline(false);
      await expect(editorB).toContainText('added offline', { timeout: 20_000 });
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('a killed socket reconnects mid-edit and resyncs without duplicates', async ({
    browser,
    docId,
  }) => {
    const writer = await openSignedIn(browser);
    const reader = await openSignedIn(browser);
    try {
      // Proxy the writer's socket so the test can terminate the live
      // connection from the server side, with the editor still mounted.
      const tap = await tapRealtime(writer.page);
      const writerEditor = await openDocument(writer.page, docId);
      const readerEditor = await openDocument(reader.page, docId);
      await expect.poll(() => tap.connections()).toBeGreaterThan(0);
      const established = tap.connections();

      await writerEditor.click();
      await writer.page.keyboard.type('Typed before the socket kill');
      await expect(readerEditor).toContainText('Typed before the socket kill');

      await tap.kill();
      // Key the caret back to the end: clicking the editor body would place it
      // on the clicked line and swallow the leading space. Insert the run in one
      // input event: a socket close can re-render the editor between the first
      // keydown and keyup, which occasionally dropped the leading space.
      await writerEditor.press('Control+End');
      await writer.page.keyboard.insertText(' and typed mid-edit');
      await expect(writerEditor).toContainText('and typed mid-edit');

      // A new handshake and the post-kill edit prove a real reconnect/resync,
      // not a local-only render.
      await expect.poll(() => tap.connections(), { timeout: 20_000 }).toBeGreaterThan(established);
      await expect(readerEditor).toContainText('Typed before the socket kill and typed mid-edit', {
        timeout: 20_000,
      });

      // A client that never saw the outage reads the same document exactly
      // once, so the resync did not replay the pre-kill content.
      const fresh = await openSignedIn(browser);
      try {
        await expect(await openDocument(fresh.page, docId)).toContainText(
          'Typed before the socket kill and typed mid-edit'
        );
        for (const page of [writer.page, reader.page, fresh.page]) {
          const text = await editor(page).innerText();
          expect(text.match(/Typed before the socket kill/g) ?? []).toHaveLength(1);
          expect(text.match(/typed mid-edit/g) ?? []).toHaveLength(1);
        }
      } finally {
        await fresh.context.close();
      }
    } finally {
      await writer.context.close();
      await reader.context.close();
    }
  });

  test('undo only reverts the local client’s edit', async ({ browser, docId }) => {
    const clientA = await openSignedIn(browser);
    const clientB = await openSignedIn(browser);
    try {
      const editorA = await openDocument(clientA.page, docId);
      const editorB = await openDocument(clientB.page, docId);

      await editorA.click();
      await clientA.page.keyboard.type('Alpha from A');
      await expect(editorB).toContainText('Alpha from A');

      await editorB.click();
      await clientB.page.keyboard.press('Control+End');
      await clientB.page.keyboard.type(' and Beta from B');
      await expect(editorA).toContainText('and Beta from B');

      // A's undo history contains only A's insert; B's text must survive both
      // locally and on B's screen.
      await editorA.click();
      await clientA.page.keyboard.press('Control+z');

      await expect(editorA).not.toContainText('Alpha from A');
      await expect(editorA).toContainText('and Beta from B');
      await expect(editorB).not.toContainText('Alpha from A');
      await expect(editorB).toContainText('and Beta from B');
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('deletions propagate to the other client', async ({ browser, docId }) => {
    const clientA = await openSignedIn(browser);
    const clientB = await openSignedIn(browser);
    try {
      const editorA = await openDocument(clientA.page, docId);
      const editorB = await openDocument(clientB.page, docId);

      await editorA.click();
      await clientA.page.keyboard.type('Delete me');
      await expect(editorB).toContainText('Delete me');

      await clientA.page.keyboard.press('Control+a');
      await clientA.page.keyboard.press('Backspace');
      await expect(editorB).not.toContainText('Delete me');
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('a late joiner receives content typed before it connected', async ({ browser, docId }) => {
    const writer = await openSignedIn(browser);
    try {
      const editorWriter = await openDocument(writer.page, docId);
      await editorWriter.click();
      await writer.page.keyboard.type('Existing content');
      await expect(editorWriter).toContainText('Existing content');

      const late = await openSignedIn(browser);
      try {
        const editorLate = await openDocument(late.page, docId);
        await expect(editorLate).toContainText('Existing content');
      } finally {
        await late.context.close();
      }
    } finally {
      await writer.context.close();
    }
  });

  test('edits survive a reload of the collaborating client', async ({ browser, docId }) => {
    const clientA = await openSignedIn(browser);
    const clientB = await openSignedIn(browser);
    try {
      const editorA = await openDocument(clientA.page, docId);
      await openDocument(clientB.page, docId);

      await editorA.click();
      await clientA.page.keyboard.type('Survives reload');
      await expect(clientB.page.locator('.bn-editor')).toContainText('Survives reload');

      await clientB.page.reload();
      const reloaded = await openDocument(clientB.page, docId);
      await expect(reloaded).toContainText('Survives reload');
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('shows the other client’s cursor and name', async ({ browser, docId }) => {
    const clientA = await openSignedIn(browser);
    const clientB = await openSignedIn(browser);
    try {
      const editorA = await openDocument(clientA.page, docId);
      const editorB = await openDocument(clientB.page, docId);

      await editorA.click();
      await clientA.page.keyboard.type('Presence check');
      await editorB.click();
      await clientB.page.keyboard.press('End');

      await clientA.page.keyboard.press('Shift+ArrowLeft');
      await expect(clientB.page.locator('.bn-collaboration-cursor__caret').first()).toBeVisible();
      await expect(clientB.page.locator('.bn-collaboration-cursor__label').first()).toHaveText(
        'E2E Owner'
      );
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });

  test('simultaneous edits at different positions both survive', async ({ browser, docId }) => {
    const clientA = await openSignedIn(browser);
    const clientB = await openSignedIn(browser);
    try {
      const editorA = await openDocument(clientA.page, docId);
      const editorB = await openDocument(clientB.page, docId);

      await editorA.click();
      await clientA.page.keyboard.type('Seed content');
      await expect(editorB).toContainText('Seed content');

      await Promise.all([
        (async () => {
          await editorA.click();
          await clientA.page.keyboard.press('Control+End');
          await clientA.page.keyboard.type(' Concurrent A');
        })(),
        (async () => {
          await editorB.click();
          await clientB.page.keyboard.press('Control+Home');
          await clientB.page.keyboard.type('Concurrent B ');
        })(),
      ]);

      // The remote-caret widget renders its label inside the paragraph, so each
      // insert is asserted individually rather than as one contiguous string.
      for (const editor of [editorA, editorB]) {
        await expect(editor).toContainText('Concurrent B');
        await expect(editor).toContainText('Seed content');
        await expect(editor).toContainText('Concurrent A');
      }
    } finally {
      await clientA.context.close();
      await clientB.context.close();
    }
  });
});
