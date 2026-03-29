'use client';

import '@blocknote/core/fonts/inter.css';
import {
  CommentsExtension,
  DefaultThreadStoreAuth,
  ThreadStoreAuth,
  YjsThreadStore,
  type User as CommentUser,
} from '@blocknote/core/comments';
import { en } from '@blocknote/core/locales';
import {
  FloatingComposerController,
  FloatingThreadController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DocToolbar } from '@/components/DocToolbar';
import { DocumentErrorPanel } from '@/components/DocumentErrorPanel';
import { CommentsSidebar, type CommentThreadStats } from '@/components/comments/CommentsSidebar';
import { useAuth } from '@/hooks/useAuth.hook';
import { useDocument } from '@/hooks/useDocument.hook';
import { useTheme } from '@/hooks/useTheme.hook';
import { useYjsPersistence } from '@/hooks/useYjsPersistence.hook';
import { getPresenceColor } from '@/lib/realtime.util';
import { documentService, type DocumentAccessLevel } from '@/services/document.service';
import type { AuthUser } from '@/stores/auth/auth.types';
import type { CommentsFilter, CommentsSort } from '@/components/comments/CommentProvider';
import type { DocumentMeta } from '@/types/document.types';
import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';

const EMPTY_COMMENT_STATS: CommentThreadStats = { open: 0, resolved: 0, all: 0 };
const COMMENT_USER_CACHE_TTL_MS = 20_000;
const COMMENT_USERS_MAP_KEY = 'comment-users';

function mapAccessLevelToCommentRole(
  accessLevel: DocumentAccessLevel | null
): 'comment' | 'editor' {
  return accessLevel === 'COMMENT' ? 'comment' : 'editor';
}

class ReadOnlyThreadStoreAuth extends ThreadStoreAuth {
  canCreateThread(): boolean {
    return false;
  }

  canAddComment(): boolean {
    return false;
  }

  canUpdateComment(): boolean {
    return false;
  }

  canDeleteComment(): boolean {
    return false;
  }

  canDeleteThread(): boolean {
    return false;
  }

  canResolveThread(): boolean {
    return false;
  }

  canUnresolveThread(): boolean {
    return false;
  }

  canAddReaction(): boolean {
    return false;
  }

  canDeleteReaction(): boolean {
    return false;
  }
}

interface SharedCommentUserProfile {
  username: string;
  avatarUrl: string | null;
}

function parseSharedCommentUserProfile(raw: unknown): SharedCommentUserProfile | null {
  if (typeof raw !== 'string') {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SharedCommentUserProfile>;
    if (!parsed || typeof parsed.username !== 'string' || parsed.username.trim().length === 0) {
      return null;
    }

    return {
      username: parsed.username,
      avatarUrl:
        typeof parsed.avatarUrl === 'string' && parsed.avatarUrl.trim().length > 0
          ? parsed.avatarUrl
          : null,
    };
  } catch {
    return null;
  }
}

function buildFallbackAvatar(seed: string, username: string): string {
  const initial = (username.trim()[0] ?? 'U').toUpperCase();
  const fill = getPresenceColor(seed || initial);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='48' fill='${fill}'/><text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='ui-sans-serif, system-ui, -apple-system' font-size='38' font-weight='600'>${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export default function Editor() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const routeDocumentId = (params?.id as string) || 'default-doc';
  const searchParamsString = searchParams.toString();
  const isSharedDocument = searchParams.get('share') === '1';
  const { isAuthenticated, accessToken, user } = useAuth();
  const {
    documentId,
    ydoc,
    meta,
    accessLevel,
    isReadOnly,
    isRealtimeConnected,
    realtimeProvider,
    errorState,
    isLoading,
    error,
    updateMeta,
  } = useDocument(routeDocumentId, { isSharedDocument });
  const [showLoading, setShowLoading] = useState(false);
  const [showCommentsSidebar, setShowCommentsSidebar] = useState(false);
  const [commentsFilter, setCommentsFilter] = useState<CommentsFilter>('open');
  const [commentsSort, setCommentsSort] = useState<CommentsSort>('position');
  const [commentStatsByDocument, setCommentStatsByDocument] = useState<
    Record<string, CommentThreadStats>
  >({});
  const isGuestSharedView =
    !isAuthenticated && routeDocumentId !== 'default-doc' && accessLevel === 'VIEW';

  const openAuthModal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('open-auth-modal'));
  }, []);

  useEffect(() => {
    if (!isLoading && documentId && routeDocumentId !== documentId) {
      const preservedQuery = isSharedDocument && searchParamsString ? `?${searchParamsString}` : '';
      router.replace(`/doc/${documentId}${preservedQuery}`);
    }
  }, [isLoading, routeDocumentId, documentId, router, isSharedDocument, searchParamsString]);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isLoading) {
      timer = setTimeout(() => setShowLoading(true), 300);
    } else {
      timer = setTimeout(() => setShowLoading(false), 0);
    }
    return () => clearTimeout(timer);
  }, [routeDocumentId, isLoading]);

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
          // TODO: Add a spinner/loading animation here instead of just text.
          // Maybe we can also change the placement of the loading indicator.
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
        isOffline={!isRealtimeConnected && isAuthenticated}
        showGuestNotice={isGuestSharedView}
        onGuestNoticeCtaClick={openAuthModal}
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

// We separate this component to ensure BlockNote editor is only created
// after the Yjs document is fully loaded from IndexedDB
function EditorContent({
  documentId,
  ydoc,
  meta,
  updateMeta,
  isReadOnly,
  accessLevel,
  realtimeProvider,
  user,
  isAuthenticated,
  accessToken,
  commentsFeatureEnabled,
  commentsUiEnabled,
  commentsSidebarOpen,
  commentsFilter,
  commentsSort,
  onCommentsFilterChange,
  onCommentsSortChange,
  onCommentsClose,
  onCommentsThreadStatsChange,
}: {
  documentId: string;
  ydoc: Y.Doc;
  meta: DocumentMeta;
  updateMeta: (updates: Partial<DocumentMeta>) => void;
  isReadOnly: boolean;
  accessLevel: DocumentAccessLevel | null;
  realtimeProvider: WebsocketProvider | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  accessToken: string | null;
  commentsFeatureEnabled: boolean;
  commentsUiEnabled: boolean;
  commentsSidebarOpen: boolean;
  commentsFilter: CommentsFilter;
  commentsSort: CommentsSort;
  onCommentsFilterChange: (filter: CommentsFilter) => void;
  onCommentsSortChange: (sort: CommentsSort) => void;
  onCommentsClose: () => void;
  onCommentsThreadStatsChange: (stats: CommentThreadStats) => void;
}) {
  useYjsPersistence(documentId, ydoc, meta, isReadOnly, !isReadOnly);
  const { resolvedTheme } = useTheme();

  const collaboratorCache = useRef<Map<string, CommentUser>>(new Map());
  const collaboratorCacheUpdatedAt = useRef(0);

  const commentsDictionary = useMemo(
    () => ({
      ...en,
      placeholders: {
        ...en.placeholders,
        new_comment: 'Add comment...',
        comment_reply: 'Add comment...',
      },
      comments: {
        ...en.comments,
        save_button_text: 'Send',
      },
    }),
    []
  );

  const activeCommentUser = useMemo<CommentUser>(() => {
    const id = user?.id || 'anonymous';
    const username = user?.displayName || user?.email || 'Anonymous';
    return {
      id,
      username,
      avatarUrl: user?.avatarUrl || buildFallbackAvatar(id, username),
    };
  }, [user?.id, user?.displayName, user?.email, user?.avatarUrl]);

  const commentRole = useMemo(() => mapAccessLevelToCommentRole(accessLevel), [accessLevel]);
  const canComment = accessLevel === 'COMMENT' || accessLevel === 'EDIT' || accessLevel === 'OWNER';
  const isViewer = accessLevel === 'VIEW';
  const sharedCommentUsers = useMemo(() => ydoc.getMap<string>(COMMENT_USERS_MAP_KEY), [ydoc]);

  useEffect(() => {
    if (!isAuthenticated || !activeCommentUser.id || activeCommentUser.id === 'anonymous') {
      return;
    }

    const serializedProfile = JSON.stringify({
      username: activeCommentUser.username,
      avatarUrl: activeCommentUser.avatarUrl ?? null,
    } satisfies SharedCommentUserProfile);

    if (sharedCommentUsers.get(activeCommentUser.id) !== serializedProfile) {
      sharedCommentUsers.set(activeCommentUser.id, serializedProfile);
    }
  }, [
    activeCommentUser.id,
    activeCommentUser.username,
    activeCommentUser.avatarUrl,
    isAuthenticated,
    sharedCommentUsers,
  ]);

  const resolveUsers = useCallback(
    async (userIds: string[]): Promise<CommentUser[]> => {
      if (userIds.length === 0) {
        return [];
      }

      const now = Date.now();
      const shouldRefreshCollaborators =
        isAuthenticated &&
        !!accessToken &&
        now - collaboratorCacheUpdatedAt.current > COMMENT_USER_CACHE_TTL_MS;

      if (shouldRefreshCollaborators) {
        try {
          const collaborators = await documentService.listCollaborators(documentId, accessToken);
          const nextCollaborators = new Map<string, CommentUser>();

          for (const collaborator of collaborators) {
            const username = collaborator.displayName || collaborator.email;
            nextCollaborators.set(collaborator.userId, {
              id: collaborator.userId,
              username,
              avatarUrl: buildFallbackAvatar(collaborator.userId, username),
            });
          }

          collaboratorCache.current = nextCollaborators;
        } catch (error) {
          console.warn('Failed to resolve collaborators for comment users:', error);
        } finally {
          collaboratorCacheUpdatedAt.current = Date.now();
        }
      }

      const usersById = new Map<string, CommentUser>(collaboratorCache.current);
      usersById.set(activeCommentUser.id, activeCommentUser);

      return userIds.map((rawId) => {
        const id = rawId || 'anonymous';
        const cached = usersById.get(id);

        if (cached) {
          return cached;
        }

        const sharedProfile = parseSharedCommentUserProfile(sharedCommentUsers.get(id));
        if (sharedProfile) {
          return {
            id,
            username: sharedProfile.username,
            avatarUrl: sharedProfile.avatarUrl || buildFallbackAvatar(id, sharedProfile.username),
          };
        }

        const fallbackName =
          id === activeCommentUser.id ? activeCommentUser.username : `User ${id.slice(0, 6)}`;
        return {
          id,
          username: fallbackName,
          avatarUrl: buildFallbackAvatar(id, fallbackName),
        };
      });
    },
    [accessToken, activeCommentUser, documentId, isAuthenticated, sharedCommentUsers]
  );

  const threadStore = useMemo(() => {
    if (!commentsFeatureEnabled) {
      return undefined;
    }

    const auth = canComment
      ? new DefaultThreadStoreAuth(activeCommentUser.id, commentRole)
      : new ReadOnlyThreadStoreAuth();

    return new YjsThreadStore(activeCommentUser.id, ydoc.getMap('threads'), auth);
  }, [activeCommentUser.id, canComment, commentRole, commentsFeatureEnabled, ydoc]);

  const editor = useCreateBlockNote(
    {
      collaboration: {
        provider: realtimeProvider || undefined,
        fragment: ydoc.getXmlFragment('blocknote'),
        user: {
          name: activeCommentUser.username,
          color: getPresenceColor(activeCommentUser.id || documentId),
        },
      },
      dictionary: commentsDictionary,
      // Keep comments extension enabled in view-only mode so existing commented text stays visible.
      extensions:
        commentsFeatureEnabled && threadStore
          ? [CommentsExtension({ threadStore, resolveUsers })]
          : [],
    },
    [
      activeCommentUser.id,
      activeCommentUser.username,
      commentsDictionary,
      commentsFeatureEnabled,
      documentId,
      realtimeProvider,
      resolveUsers,
      threadStore,
      ydoc,
    ]
  );

  useEffect(() => {
    if (!commentsUiEnabled) {
      return;
    }

    const selector = '.nd-floating-composer .bn-comment-actions button';

    const syncFloatingComposerSendLabels = () => {
      document.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
        button.setAttribute('aria-label', 'Send comment');

        if (button.textContent?.trim() !== 'Send') {
          button.textContent = 'Send';
        }
      });
    };

    // WORKAROUND: BlockNote's floating composer can still render a hardcoded
    // "Save" label even when dictionary.save_button_text is set. We patch
    // the live button text until upstream exposes a reliable API override.
    syncFloatingComposerSendLabels();

    const observer = new MutationObserver(() => {
      syncFloatingComposerSendLabels();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [commentsUiEnabled]);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusRequested = useRef(false);

  const [isEditorVisible, setIsEditorVisible] = useState(() => {
    const blocks = editor.document;
    const hasTitle = meta.title !== 'Untitled';
    const hasContent =
      blocks.length > 1 ||
      (blocks.length === 1 && Array.isArray(blocks[0].content) && blocks[0].content.length > 0);
    return hasTitle || hasContent;
  });

  useEffect(() => {
    // Check if the document has actual content after Yjs sync
    const blocks = editor.document;
    const hasContent =
      blocks.length > 1 ||
      (blocks.length === 1 && Array.isArray(blocks[0].content) && blocks[0].content.length > 0);

    // If it has content (e.g. from collab sync), ensure editor is visible
    if (hasContent) {
      setIsEditorVisible(true);
    }
  }, [editor.document]);

  useEffect(() => {
    if (isEditorVisible && focusRequested.current) {
      // Small delay to ensure the DOM is ready and BlockNote is initialized
      const timer = setTimeout(() => {
        editor.focus();
        focusRequested.current = false;
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isEditorVisible, editor]);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [meta.title]);

  useEffect(() => {
    // Auto-focus the title input when the editor mounts
    // only if this is a new document (untitled)
    if (!isReadOnly && textareaRef.current && meta.title === 'Untitled') {
      textareaRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally only run on mount to avoid stealing focus later

  const handleTitleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (isReadOnly) {
      return;
    }

    updateMeta({ title: e.target.value });
    adjustTextareaHeight();
  };

  const handleTitleBlur = () => {
    if (isReadOnly) {
      return;
    }

    // Normalize empty titles to 'Untitled' to maintain consistency
    if (!meta.title || meta.title.trim() === '') {
      updateMeta({ title: 'Untitled' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isReadOnly) {
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isEditorVisible) {
        setIsEditorVisible(true);
        focusRequested.current = true;
      } else {
        editor.focus();
      }
    }
  };

  const handleEditorPointerDownCapture = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (accessLevel !== 'COMMENT') {
        return;
      }

      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }

      if (!target.closest('.bn-formatting-toolbar')) {
        return;
      }

      // Keep editor selection stable so Add Comment works on first click.
      event.preventDefault();
      editor.focus();
    },
    [accessLevel, editor]
  );

  return (
    <div className="flex flex-col w-full mt-12 md:mt-24">
      <div className="document-title-container group">
        <textarea
          ref={textareaRef}
          value={meta.title === 'Untitled' ? '' : meta.title}
          readOnly={isReadOnly}
          onChange={handleTitleChange}
          onBlur={handleTitleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Untitled"
          className="document-title-input overflow-hidden"
          rows={1}
        />
      </div>
      {isEditorVisible && (
        <div className="animate-in fade-in duration-300">
          <BlockNoteView
            editor={editor}
            theme={resolvedTheme}
            editable={!isReadOnly}
            onPointerDownCapture={handleEditorPointerDownCapture}
            shadCNComponents={{}}
            formattingToolbar={!isViewer}
            linkToolbar={!isViewer}
            slashMenu={!isViewer}
            sideMenu={!isViewer}
            filePanel={!isViewer}
            tableHandles={!isViewer}
            emojiPicker={!isViewer}
            comments={false}
          >
            {commentsUiEnabled && (
              <FloatingComposerController
                floatingUIOptions={{
                  elementProps: {
                    className: 'nd-floating-composer',
                  },
                }}
              />
            )}
            {commentsUiEnabled && !commentsSidebarOpen && (
              <FloatingThreadController
                floatingUIOptions={{
                  elementProps: {
                    className: 'nd-floating-thread',
                  },
                }}
              />
            )}
            {commentsUiEnabled && (
              <CommentsSidebar
                isOpen={commentsSidebarOpen}
                filter={commentsFilter}
                sort={commentsSort}
                onFilterChange={onCommentsFilterChange}
                onSortChange={onCommentsSortChange}
                onClose={onCommentsClose}
                onThreadStatsChange={onCommentsThreadStatsChange}
                canComment={canComment}
              />
            )}
          </BlockNoteView>
        </div>
      )}
    </div>
  );
}
