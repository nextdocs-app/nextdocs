'use client';

import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DocToolbar } from '@/components/DocToolbar';
import { DocumentErrorPanel } from '@/components/DocumentErrorPanel';
import { useAuth } from '@/hooks/useAuth.hook';
import { useDocument } from '@/hooks/useDocument.hook';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';
import { useOfflineDocumentSelect } from '@/hooks/useOfflineDocumentSelect.hook';
import { useYjsPersistence } from '@/hooks/useYjsPersistence.hook';
import type { CommentsFilter, CommentsSort } from '@/components/comments/CommentProvider';
import type { CommentThreadStats } from '@/components/comments/CommentsSidebar';
import { EMPTY_COMMENT_STATS } from './comment.utils';
import { EditorContent } from './EditorContent';
import { EditorErrorBoundary } from './EditorErrorBoundary';
import { useAppDispatch } from '@/stores/hooks';
import { addToast } from '@/stores/toasts/toasts.slice';

export default function Editor({ documentId: fixedDocumentId }: { documentId?: string } = {}) {
  const params = useParams();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const idParam = params?.id;
  const routeDocumentId = Array.isArray(idParam) ? idParam[0] : idParam;

  const [offlineSelectedDocumentId, setOfflineSelectedDocumentId] = useState<string | null>(null);
  const effectiveOfflineSelectedDocumentId =
    offlineSelectedDocumentId === routeDocumentId ? null : offlineSelectedDocumentId;
  const effectiveDocumentId =
    effectiveOfflineSelectedDocumentId ?? fixedDocumentId ?? routeDocumentId ?? '';
  const searchParamsString = searchParams.toString();
  const isSharedDocument = searchParams.get('share') === '1';
  const { isAuthenticated, accessToken, user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const {
    documentId,
    ydoc,
    awareness,
    meta,
    accessLevel,
    canManageSharing,
    documentSpace,
    isReadOnly,
    isGuestShareLink,
    isRealtimeSynced,
    realtimeProvider,
    errorState,
    isLoading,
    error,
    updateMeta,
    updateIcon,
    updateCover,
    restore,
  } = useDocument(effectiveDocumentId, { isSharedDocument });
  const [showLoading, setShowLoading] = useState(false);
  const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
  const [versionHistoryDocumentId, setVersionHistoryDocumentId] = useState<string | null>(null);
  const [versionHistoryActionsTarget, setVersionHistoryActionsTarget] =
    useState<HTMLDivElement | null>(null);
  const [commentsFilter, setCommentsFilter] = useState<CommentsFilter>('open');
  const [commentsSort, setCommentsSort] = useState<CommentsSort>('position');
  const [commentStatsByDocument, setCommentStatsByDocument] = useState<
    Record<string, CommentThreadStats>
  >({});
  // The notice is about who is looking, not about what they may do, so a guest holding
  // an edit or comment link sees it too. Editability stays with the access level alone.
  const showGuestNotice = !isAuthenticated && isGuestShareLink;
  const isOffline = !isOnline;
  const isTrashedDocument = !!meta?.deletedAt;
  // Only EDIT holders and owners may restore/purge; viewers and commenters get the
  // read-only trash notice instead.
  const canManageTrash = isTrashedDocument && (accessLevel === 'EDIT' || accessLevel === 'OWNER');
  const { pendingEdits } = useYjsPersistence(
    documentId,
    ydoc,
    meta,
    isReadOnly,
    !isReadOnly,
    accessLevel,
    isRealtimeSynced
  );

  const dispatch = useAppDispatch();

  const goToSignIn = useCallback(() => {
    // Return the guest to this share link (not the workspace root) after sign-in.
    const next = `${pathname ?? '/'}${searchParamsString ? `?${searchParamsString}` : ''}`;
    router.push(`/login?next=${encodeURIComponent(next)}`);
  }, [pathname, router, searchParamsString]);

  const [isRestoring, setIsRestoring] = useState(false);

  const handleRestore = useCallback(async () => {
    if (isRestoring) {
      return;
    }
    setIsRestoring(true);
    try {
      await restore();
    } catch (error) {
      console.error('Failed to restore document:', error);
      dispatch(
        addToast({ message: 'Failed to restore document. Please try again.', type: 'error' })
      );
    } finally {
      setIsRestoring(false);
    }
  }, [restore, isRestoring, dispatch]);

  // Look at the comment in useOfflineDocumentSelect file to know why we need this workaround.
  useOfflineDocumentSelect(setOfflineSelectedDocumentId);

  useEffect(() => {
    if (!isOnline || !routeDocumentId) {
      return;
    }

    if (!isLoading && documentId && routeDocumentId !== documentId) {
      const preservedQuery = isSharedDocument && searchParamsString ? `?${searchParamsString}` : '';
      router.replace(`/doc/${documentId}${preservedQuery}`);
    }
  }, [
    isLoading,
    routeDocumentId,
    documentId,
    router,
    isOnline,
    isSharedDocument,
    searchParamsString,
  ]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isLoading) {
      timer = setTimeout(() => setShowLoading(true), 300);
    } else {
      timer = setTimeout(() => setShowLoading(false), 0);
    }
    return () => clearTimeout(timer);
  }, [effectiveDocumentId, isLoading]);

  // Guests holding a COMMENT (or EDIT) share link can discuss too; the API
  // authorizes them against the link, so the button must not require an account.
  const showCommentsButton =
    accessLevel === 'COMMENT' || accessLevel === 'EDIT' || accessLevel === 'OWNER';
  const activeCommentStats = commentStatsByDocument[documentId] ?? EMPTY_COMMENT_STATS;

  // History needs the live room to fork its preview, Yhub to answer its activity
  // requests, and the browser's JWT to authorize them. Trashed documents are
  // REST-only, the version endpoint refuses a soft-deleted room, and a share-link
  // guest has no JWT for those requests: hide the entry point instead of opening
  // a panel that can only fail.
  const canViewVersionHistory =
    isAuthenticated && isOnline && !isTrashedDocument && !!realtimeProvider;
  // Deriving from the document id means navigating to another page closes the
  // panel without showing the old document's history over the new one. Clearing
  // the state on that navigation also keeps it closed if the user comes back.
  if (versionHistoryDocumentId !== null && versionHistoryDocumentId !== documentId) {
    setVersionHistoryDocumentId(null);
  }
  const isVersionHistoryOpen = versionHistoryDocumentId === documentId;
  const isCommentsSidebarOpen =
    showCommentsButton && !isVersionHistoryOpen ? showCommentsSidebar : false;

  const handleVersionHistoryToggle = useCallback(() => {
    const opening = versionHistoryDocumentId !== documentId;
    if (opening) {
      // The two panels are mutually exclusive: the history preview freezes the
      // editor, so a comments rail beside live comment controls is misleading.
      setShowCommentsSidebar(false);
    }
    setVersionHistoryDocumentId(opening ? documentId : null);
  }, [documentId, versionHistoryDocumentId]);

  const handleVersionHistoryClose = useCallback(() => {
    setVersionHistoryDocumentId(null);
  }, []);

  useEffect(() => {
    if (!showCommentsButton || isVersionHistoryOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const shouldToggle =
        (event.metaKey || event.ctrlKey) &&
        event.altKey &&
        event.shiftKey &&
        event.key.toLowerCase() === 'a';

      if (!shouldToggle) {
        return;
      }

      event.preventDefault();
      setShowCommentsSidebar((prev) => !prev);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [showCommentsButton, isVersionHistoryOpen]);

  const handleCommentsClose = useCallback(() => {
    setShowCommentsSidebar(false);
  }, []);

  const handleThreadStatsChange = useCallback(
    (stats: CommentThreadStats) => {
      setCommentStatsByDocument((prev) => {
        const current = prev[documentId];
        if (
          current &&
          current.open === stats.open &&
          current.resolved === stats.resolved &&
          current.all === stats.all
        ) {
          return prev;
        }

        return {
          ...prev,
          [documentId]: stats,
        };
      });
    },
    [documentId]
  );

  if (errorState) {
    // A visitor whose session lapsed lands here, not a stranger only: without a
    // way back to sign-in the panel is a dead end on a document URL. Someone
    // who is signed in already needs access granted, not another sign-in.
    const canSignIn = errorState.kind === 'restricted' && !isAuthenticated;

    return (
      <DocumentErrorPanel
        tone={errorState.kind === 'restricted' ? 'restricted' : 'error'}
        title={errorState.title}
        description={errorState.description}
        detail={errorState.responseMessage}
        statusCode={errorState.statusCode}
        actionLabel={canSignIn ? 'Sign in' : undefined}
        onAction={canSignIn ? goToSignIn : undefined}
      />
    );
  }

  if (error) {
    return (
      <DocumentErrorPanel
        title="Unable to open this document"
        description="An unexpected error occurred while loading this document."
        detail={error.message}
      />
    );
  }

  if (isLoading || !ydoc || !meta) {
    return (
      <div className="flex items-center justify-center h-full">
        {showLoading && (
          <div className="text-sm text-muted-foreground animate-in fade-in duration-300">
            Loading document...
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <DocToolbar
        documentId={documentId}
        documentTitle={meta.title}
        documentIcon={meta.icon}
        isShareEnabled={isAuthenticated}
        updatedAt={meta.updatedAt}
        isOffline={isOffline}
        pendingEdits={pendingEdits}
        showGuestNotice={showGuestNotice}
        onGuestNoticeCtaClick={goToSignIn}
        showTrashNotice={isTrashedDocument}
        canManageTrash={canManageTrash}
        canManageSharing={canManageSharing}
        documentSpace={documentSpace}
        onRestore={handleRestore}
        showCommentsButton={showCommentsButton && !isVersionHistoryOpen}
        isCommentsSidebarOpen={isCommentsSidebarOpen}
        openCommentsCount={activeCommentStats.open}
        onCommentsToggle={() => setShowCommentsSidebar((prev) => !prev)}
        canViewVersionHistory={canViewVersionHistory}
        isVersionHistoryOpen={isVersionHistoryOpen}
        onVersionHistoryToggle={handleVersionHistoryToggle}
        versionHistoryActionsRef={setVersionHistoryActionsTarget}
      />
      <EditorErrorBoundary key={documentId} documentId={documentId}>
        <EditorContent
          key={documentId}
          documentId={documentId}
          ydoc={ydoc}
          awareness={awareness}
          meta={meta}
          updateMeta={updateMeta}
          updateIcon={updateIcon}
          updateCover={updateCover}
          isReadOnly={isReadOnly}
          isVersionHistoryOpen={isVersionHistoryOpen}
          onVersionHistoryClose={handleVersionHistoryClose}
          versionHistoryActionsTarget={versionHistoryActionsTarget}
          canManageVersionHistory={accessLevel === 'EDIT' || accessLevel === 'OWNER'}
          accessLevel={accessLevel}
          realtimeProvider={realtimeProvider}
          user={user}
          isAuthenticated={isAuthenticated}
          accessToken={accessToken}
          commentsUiEnabled={showCommentsButton && !isVersionHistoryOpen}
          commentsSidebarOpen={isCommentsSidebarOpen}
          commentsFilter={commentsFilter}
          commentsSort={commentsSort}
          onCommentsFilterChange={setCommentsFilter}
          onCommentsSortChange={setCommentsSort}
          onCommentsClose={handleCommentsClose}
          onCommentsThreadStatsChange={handleThreadStatsChange}
        />
      </EditorErrorBoundary>
    </>
  );
}
