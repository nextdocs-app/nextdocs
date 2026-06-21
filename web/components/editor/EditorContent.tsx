'use client';

import '@blocknote/core/fonts/inter.css';
import {
  CommentsExtension,
  DefaultThreadStoreAuth,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CommentsSidebar, type CommentThreadStats } from '@/components/comments/CommentsSidebar';
import { useTheme } from '@/hooks/useTheme.hook';
import { Send } from '@/icons/Send';
import { getPresenceColor } from '@/lib/realtime.util';
import { documentService } from '@/services/document.service';
import type { DocumentAccessLevel } from '@/services/document.service';
import type { AuthUser } from '@/stores/auth/auth.types';
import type { CommentsFilter, CommentsSort } from '@/components/comments/CommentProvider';
import type { DocumentMeta } from '@/types/document.types';
import type * as Y from 'yjs';
import type { WebsocketProvider } from 'y-websocket';
import {
  COMMENT_USER_CACHE_TTL_MS,
  COMMENT_USERS_MAP_KEY,
  mapAccessLevelToCommentRole,
  ReadOnlyThreadStoreAuth,
  parseSharedCommentUserProfile,
  buildFallbackAvatar,
} from './comment.utils';
import type { SharedCommentUserProfile } from './comment.utils';
import { useCommentComposerPatch } from './useCommentComposerPatch';

export function EditorContent({
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
  const { resolvedTheme } = useTheme();
  const sendIconTemplateRef = useRef<HTMLSpanElement>(null);

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

  useCommentComposerPatch(commentsUiEnabled, sendIconTemplateRef);

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
    const blocks = editor.document;
    const hasContent =
      blocks.length > 1 ||
      (blocks.length === 1 && Array.isArray(blocks[0].content) && blocks[0].content.length > 0);

    if (hasContent) {
      setIsEditorVisible(true);
    }
  }, [editor.document]);

  useEffect(() => {
    if (isEditorVisible && focusRequested.current) {
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
    if (!isReadOnly && textareaRef.current && meta.title === 'Untitled') {
      textareaRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      event.preventDefault();
      editor.focus();
    },
    [accessLevel, editor]
  );

  return (
    <div className="flex flex-col w-full mt-12 md:mt-24 pb-[40vh] relative bg-background">
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
            <span ref={sendIconTemplateRef} className="sr-only" aria-hidden="true">
              <Send size={14} strokeWidth={1.75} />
            </span>
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
