import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { EditorErrorBoundary } from '@/components/editor/EditorErrorBoundary';
import { mergePendingIconCoverPatch, writePendingSyncEdits } from '@/lib/offline-sync.util';
import { queuePendingCloudCreate } from '@/lib/pending-cloud-create.util';
import { documentService } from '@/services/document.service';

jest.mock('../../../../services/document.service', () => ({
  documentService: {
    deleteDocument: jest.fn(),
  },
}));

const deleteDocument = documentService.deleteDocument as jest.Mock;

function BrokenEditor({
  message = '[y/prosemirror]: failed to create node: doc',
}): React.ReactNode {
  throw new Error(message);
}

function renderBroken(documentId = 'doc-1') {
  return render(
    <EditorErrorBoundary documentId={documentId}>
      <BrokenEditor />
    </EditorErrorBoundary>
  );
}

describe('EditorErrorBoundary', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    deleteDocument.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('shows a recovery message instead of crashing the route', () => {
    renderBroken();

    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be opened');
    expect(screen.getByRole('button', { name: 'Reset local copy and reload' })).toBeInTheDocument();
    expect(window.sessionStorage.getItem('nextdocs:editor-recovered:doc-1')).toBe('1');
  });

  it('drops the local copy and reloads when no local work is queued', async () => {
    renderBroken();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
  });

  it('does not auto-reset a document with unsynced edits', async () => {
    writePendingSyncEdits('doc-1', 2);

    renderBroken();

    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be opened');
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('nextdocs:editor-recovered:doc-1')).toBeNull();
  });

  it('does not auto-reset a document with a queued icon or cover edit', async () => {
    mergePendingIconCoverPatch('doc-1', {
      icon: { type: 'BUILTIN', value: 'book', color: 'blue' },
    });

    renderBroken();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('nextdocs:editor-recovered:doc-1')).toBeNull();
  });

  it('does not auto-reset a page that has not reached the cloud yet', async () => {
    // Created offline: there is no server copy to reload from, so deleting the local
    // one would lose the page outright.
    queuePendingCloudCreate({ id: 'doc-1', userId: 'user-1', parentId: null });

    renderBroken();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('nextdocs:editor-recovered:doc-1')).toBeNull();
  });

  it('does not auto-reset on an error the Yjs heuristic does not recognise', async () => {
    render(
      <EditorErrorBoundary documentId="doc-1">
        <BrokenEditor message="Failed to fetch dynamically imported module" />
      </EditorErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('nextdocs:editor-recovered:doc-1')).toBeNull();
  });

  it('does not auto-reset a page when the pending markers cannot be read', async () => {
    // Safari with storage blocked throws from `getItem`; that must stop recovery rather
    // than escape the error handler, because the answer is unknown.
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is disabled');
    });

    renderBroken();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('does not schedule recovery when the tried-marker cannot be saved', async () => {
    // Without the marker a second crash would schedule another reset after the reload,
    // so an unsaveable marker must leave the fallback (and its button) in charge.
    const originalSetItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      key: string,
      value: string
    ) {
      if (String(key).startsWith('nextdocs:editor-recovered:')) {
        throw new Error('Storage is disabled');
      }
      return originalSetItem.call(this, key, value);
    });

    renderBroken();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be opened');
    expect(screen.getByRole('button', { name: 'Reset local copy and reload' })).toBeInTheDocument();
  });

  it('rechecks for queued work when the recovery timer fires', async () => {
    renderBroken();
    // The queue can gain work between the catch and the timer.
    writePendingSyncEdits('doc-1', 1);

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be opened');
  });

  it('keeps work queued while the local copy is being deleted', async () => {
    deleteDocument.mockImplementation(async () => {
      // A write that lands after the reset decided nothing was queued. Clearing the
      // markers after the delete would drop it; the reset clears them before.
      writePendingSyncEdits('doc-1', 2);
    });

    renderBroken();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(window.localStorage.getItem('nextdocs:pending-sync:doc-1')).toBe('2');
  });

  it('does not try to recover the same document twice in one session', async () => {
    window.sessionStorage.setItem('nextdocs:editor-recovered:doc-1', '1');

    renderBroken();

    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    expect(deleteDocument).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('This page could not be opened');
  });

  it('resets the local copy from the fallback button even when work is queued', async () => {
    writePendingSyncEdits('doc-1', 1);

    renderBroken();

    // The reload that follows is jsdom's unobservable navigation; the assertions cover
    // the state the retry clears before it.
    await act(async () => {
      screen.getByRole('button', { name: 'Reset local copy and reload' }).click();
    });

    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
    expect(window.localStorage.getItem('nextdocs:pending-sync:doc-1')).toBeNull();
  });
});
