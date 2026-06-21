'use client';

import { useParams, useRouter, useSearchParams } from 'next/navigation';
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

export default function Editor() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const idParam = params?.id;
  const routeDocumentId = Array.isArray(idParam) ? idParam[0] : idParam;

  const [offlineSelectedDocumentId, setOfflineSelectedDocumentId] = useState<string | null>(null);
  const effectiveOfflineSelectedDocumentId =
    offlineSelectedDocumentId === routeDocumentId ? null : offlineSelectedDocumentId;
  const effectiveDocumentId = effectiveOfflineSelectedDocumentId ?? routeDocumentId ?? '';
  const searchParamsString = searchParams.toString();
  const isSharedDocument = searchParams.get('share') === '1';
  const { isAuthenticated, accessToken, user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const {
    documentId,
    ydoc,
    meta,
    accessLevel,
    isReadOnly,
    realtimeProvider,
    errorState,
    isLoading,
    error,
    updateMeta,
    restore,
  } = useDocument(effectiveDocumentId, { isSharedDocument });
  const [showLoading, setShowLoading] = useState(false);
  const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState<CommentsFilter>('open');
  const [commentsSort, setCommentsSort] = useState<CommentsSort>('position');
  const [commentStatsByDocument, setCommentStatsByDocument] = useState<
    Record<string, CommentThreadStats>
  >({});
  const isGuestSharedView = !isAuthenticated && accessLevel === 'VIEW';
  const isOffline = !isOnline;
  const { pendingEdits } = useYjsPersistence(
    documentId,
    ydoc,
    meta,
    isReadOnly || isGuestSharedView,
    !(isReadOnly || isGuestSharedView)
  );

  const openAuthModal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-auth-modal'));
  }, []);

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
      alert('Failed to restore document. Please try again.');
    } finally {
      setIsRestoring(false);
    }
  }, [restore, isRestoring]);

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

  const commentsFeatureEnabled = accessLevel !== null;
  const showCommentsButton = !!user?.id && accessLevel !== 'VIEW';
  const isCommentsSidebarOpen = showCommentsButton ? showCommentsSidebar : false;
  const activeCommentStats = commentStatsByDocument[documentId] ?? EMPTY_COMMENT_STATS;

  useEffect(() => {
    if (!showCommentsButton) {
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
  }, [showCommentsButton]);

  if (errorState) {
    return (
      <DocumentErrorPanel
        tone={errorState.kind === 'restricted' ? 'restricted' : 'error'}
        title={errorState.title}
        description={errorState.description}
        detail={errorState.responseMessage}
        statusCode={errorState.statusCode}
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
        isShareEnabled={isAuthenticated}
        updatedAt={meta.updatedAt}
        isOffline={isOffline}
        pendingEdits={pendingEdits}
        showGuestNotice={isGuestSharedView}
        onGuestNoticeCtaClick={openAuthModal}
        showTrashNotice={!!meta?.deletedAt}
        onRestore={handleRestore}
        showCommentsButton={showCommentsButton}
        isCommentsSidebarOpen={isCommentsSidebarOpen}
        openCommentsCount={activeCommentStats.open}
        onCommentsToggle={() => setShowCommentsSidebar((prev) => !prev)}
      />
      <EditorContent
        key={documentId}
        documentId={documentId}
        ydoc={ydoc}
        meta={meta}
        updateMeta={updateMeta}
        isReadOnly={isReadOnly || isGuestSharedView}
        accessLevel={accessLevel}
        realtimeProvider={realtimeProvider}
        user={user}
        isAuthenticated={isAuthenticated}
        accessToken={accessToken}
        commentsFeatureEnabled={commentsFeatureEnabled}
        commentsUiEnabled={showCommentsButton}
        commentsSidebarOpen={isCommentsSidebarOpen}
        commentsFilter={commentsFilter}
        commentsSort={commentsSort}
        onCommentsFilterChange={setCommentsFilter}
        onCommentsSortChange={setCommentsSort}
        onCommentsClose={() => setShowCommentsSidebar(false)}
        onCommentsThreadStatsChange={(stats) => {
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
        }}
      />
    </>
  );
}
