'use client';

import { Component, type ErrorInfo, type ReactNode } from 'react';
import {
  clearPendingIconCoverPatch,
  clearPendingSyncEdits,
  readPendingIconCoverPatch,
  readPendingSyncEdits,
} from '@/lib/offline-sync.util';
import { getPendingCloudCreate } from '@/lib/pending-cloud-create.util';
import { documentService } from '@/services/document.service';

const RECOVERY_KEY_PREFIX = 'nextdocs:editor-recovered:';

interface EditorErrorBoundaryProps {
  documentId: string;
  children: ReactNode;
}

interface EditorErrorBoundaryState {
  failed: boolean;
}

function recoveryKey(documentId: string): string {
  return `${RECOVERY_KEY_PREFIX}${documentId}`;
}

function hasAlreadyRecovered(documentId: string): boolean {
  try {
    return window.sessionStorage.getItem(recoveryKey(documentId)) !== null;
  } catch {
    return false;
  }
}

function markRecovered(documentId: string): void {
  try {
    window.sessionStorage.setItem(recoveryKey(documentId), '1');
  } catch {
    // Storage can be unavailable in private or sandboxed contexts; the reload
    // still runs, it just cannot remember that it already tried.
  }
}

/**
 * Whether this device holds work that only exists locally.
 *
 * The two marker reads go through `localStorage`, which throws in some private and
 * sandboxed contexts. An exception raised from `componentDidCatch` unmounts the route,
 * which is the crash this boundary exists to prevent, so the reads are guarded here.
 *
 * An unreadable marker is not evidence that nothing is queued: the local copy is
 * deleted irreversibly by auto-recovery, so an unknown answer refuses it and leaves the
 * reader the explicit reset button. A page created offline but not yet flushed to the
 * cloud has no server copy at all, so its queue entry is part of the same guard.
 */
function hasQueuedLocalWork(documentId: string): boolean {
  try {
    if (readPendingSyncEdits(documentId) > 0) {
      return true;
    }
    if (readPendingIconCoverPatch(documentId)) {
      return true;
    }
  } catch {
    return true;
  }
  return getPendingCloudCreate(documentId) !== null;
}

/**
 * A stale Yjs snapshot can make BlockNote throw while it builds the `doc` node.
 * That used to take down the whole route, leaving no way to clear the bad local
 * copy. This boundary turns it into a one-time recovery: drop the local snapshot
 * (and its queued edits) and reload from the cloud. If the cloud copy is also
 * bad, the fallback stays on screen instead of reloading forever.
 *
 * It wraps the whole editor content, so both mount phases are covered: the
 * `BlockNoteEditor.create()` call in `useCreateBlockNote` (render) and the
 * `editor.mount(element)` in `BlockNoteView`'s ref callback (commit). The Yjs
 * `createNodeFromYElement` failure surfaces from the second one today, but a schema
 * or content-parsing throw would come from the first.
 *
 * Unsynced work is never dropped automatically. If the pending-edit marker, a queued
 * icon/cover patch, or a local-only created page is present, the fallback asks the
 * reader to reset instead. The message match is a heuristic (the bridge's own prefix,
 * not a stack type), so it can also fire on a bad remote document; that is why
 * auto-recovery refuses to run while any local work is queued.
 */
function isYjsRenderFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /y\/prosemirror|failed to create node|reading 'destroy'/i.test(message);
}

export class EditorErrorBoundary extends Component<
  EditorErrorBoundaryProps,
  EditorErrorBoundaryState
> {
  state: EditorErrorBoundaryState = { failed: false };

  private recoveryTimer: number | null = null;

  static getDerivedStateFromError(): EditorErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('Editor failed to render:', error, info.componentStack);

    if (!isYjsRenderFailure(error) || hasAlreadyRecovered(this.props.documentId)) {
      return;
    }
    if (hasQueuedLocalWork(this.props.documentId)) {
      return;
    }

    markRecovered(this.props.documentId);
    this.recoveryTimer = window.setTimeout(() => {
      void this.resetLocalCopyAndReload();
    }, 300);
  }

  componentWillUnmount(): void {
    if (this.recoveryTimer !== null) {
      window.clearTimeout(this.recoveryTimer);
    }
  }

  private resetLocalCopyAndReload = async (): Promise<void> => {
    try {
      await documentService.deleteDocument(this.props.documentId);
      clearPendingSyncEdits(this.props.documentId);
      clearPendingIconCoverPatch(this.props.documentId);
    } catch (error) {
      console.warn('Failed to clear the local document copy:', error);
    }

    window.location.reload();
  };

  private retry = (): void => {
    try {
      window.sessionStorage.removeItem(recoveryKey(this.props.documentId));
    } catch {
      // See markRecovered.
    }
    void this.resetLocalCopyAndReload();
  };

  render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <div
        role="alert"
        className="mx-auto my-12 max-w-xl rounded-lg border border-border bg-card p-6 text-card-foreground"
      >
        <h2 className="text-base font-semibold">This page could not be opened</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The local copy of this page is out of date or damaged. Reloading without it usually fixes
          the page.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={this.retry}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
          >
            Reset local copy and reload
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md border border-border px-3 py-1.5 text-sm font-medium"
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
