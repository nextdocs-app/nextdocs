'use client';

import {
  BlockNoteSchema,
  combineByGroup,
  createCodeBlockSpec,
  type User as CommentUser,
} from '@blocknote/core';
import { CommentsExtension, DefaultThreadStoreAuth } from '@blocknote/core/comments';
import { filterSuggestionItems } from '@blocknote/core/extensions';
import { YjsThreadStore, withCollaboration } from '@blocknote/core/yjs';
import { en } from '@blocknote/core/locales';
import {
  blockTypeSelectItems,
  FloatingComposerController,
  FloatingThreadController,
  FormattingToolbar,
  FormattingToolbarController,
  getDefaultReactSlashMenuItems,
  SideMenuController,
  SuggestionMenuController,
  useCreateBlockNote,
} from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import {
  getMultiColumnSlashMenuItems,
  locales as multiColumnLocales,
  multiColumnDropCursor as baseMultiColumnDropCursor,
  withMultiColumn,
} from '@blocknote/xl-multi-column';
import {
  createReactInlineMathSpec,
  createReactMathBlockSpec,
  getMathBlockTypeSelectItems,
  getMathSlashMenuItems,
  locales as mathLocales,
} from '@blocknote/math-block';
import {
  createReactDiagramBlockSpec,
  getDiagramBlockTypeSelectItems,
  getDiagramSlashMenuItems,
  locales as diagramLocales,
} from '@blocknote/diagram-block';
import 'katex/dist/katex.min.css';
import { codeBlockOptions } from '@blocknote/code-block';
import { syntaxHighlighter } from './codeBlockHighlighter';
import { CustomSideMenu, SIDE_MENU_FLOATING_OPTIONS } from './SideMenu';
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
import type { Awareness } from 'y-protocols/awareness';
import {
  COMMENT_USER_CACHE_TTL_MS,
  COMMENT_USERS_MAP_KEY,
  mapAccessLevelToCommentRole,
  ReadOnlyThreadStoreAuth,
  DynamicThreadStoreAuth,
  parseSharedCommentUserProfile,
  buildFallbackAvatar,
} from './comment.utils';
import type { SharedCommentUserProfile } from './comment.utils';
import { useCommentComposerPatch } from './useCommentComposerPatch';

type CodeLanguageInfo = {
  name: string;
  aliases?: string[];
};

// Languages missing from `@blocknote/code-block`'s bundled list that users
// already have in documents (e.g. via ```http) or commonly type. Without an
// entry here, BlockNote 0.54's language dropdown throws
// `Language <x> is not supported` and crashes the whole editor (upstream
// TypeCellOS/BlockNote#3005; 0.51.x rendered these as plain text instead).
// Kept in sync with the grammars in codeBlockHighlighter.ts so these
// languages highlight instead of falling back to plain text.
const EXTRA_CODE_LANGUAGES: Record<string, CodeLanguageInfo> = {
  http: { name: 'HTTP', aliases: ['http'] },
  go: { name: 'Go', aliases: ['go', 'golang'] },
  dockerfile: { name: 'Dockerfile', aliases: ['dockerfile'] },
  docker: { name: 'Docker', aliases: ['docker', 'docker-compose', 'compose'] },
  diff: { name: 'Diff', aliases: ['diff', 'patch'] },
  toml: { name: 'TOML', aliases: ['toml'] },
  ini: {
    name: 'INI',
    aliases: ['ini', 'properties', 'prop', 'cfg', 'conf', 'config', 'env', 'dotenv'],
  },
  nginx: { name: 'Nginx', aliases: ['nginx', 'nginx-conf'] },
  apache: { name: 'Apache', aliases: ['apache', 'apacheconf', 'htaccess'] },
  powershell: { name: 'PowerShell', aliases: ['powershell', 'ps1', 'psm1', 'psd1'] },
  dart: { name: 'Dart', aliases: ['dart'] },
  proto: { name: 'Protocol Buffers', aliases: ['proto', 'protobuf'] },
  bat: { name: 'Batch', aliases: ['bat', 'batch', 'cmd'] },
  elixir: { name: 'Elixir', aliases: ['elixir', 'ex', 'exs'] },
  clojure: { name: 'Clojure', aliases: ['clojure', 'clj', 'cljs', 'cljc'] },
  groovy: { name: 'Groovy', aliases: ['groovy', 'gvy', 'gradle'] },
  perl: { name: 'Perl', aliases: ['perl', 'pl', 'pm'] },
  solidity: { name: 'Solidity', aliases: ['solidity', 'sol'] },
  vim: { name: 'Vim', aliases: ['vim', 'viml', 'vimscript'] },
  matlab: { name: 'MATLAB', aliases: ['matlab', 'octave'] },
};

// Wraps the supported-languages map so BlockNote never throws on an unknown
// language (including "" from a bare ``` + Enter). Any string reports as
// supported, so such blocks fall back to plain text instead of crashing —
// restoring the tolerant 0.51.x behavior. Enumeration (dropdown options,
// alias resolution) only sees the real entries, so the picker is unchanged
// apart from EXTRA_CODE_LANGUAGES above.
export function createTolerantSupportedLanguages(
  base: Record<string, CodeLanguageInfo>
): Record<string, CodeLanguageInfo> {
  const target: Record<string, CodeLanguageInfo> = { ...base, ...EXTRA_CODE_LANGUAGES };
  const fallbackFor = (p: string): CodeLanguageInfo => ({
    name: p || 'Plain Text',
    aliases: [],
  });
  return new Proxy(target, {
    has: (t, p) => (typeof p === 'string' ? true : p in t),
    get: (t, p, receiver) => {
      if (typeof p === 'string' && !(p in t)) {
        return fallbackFor(p);
      }
      return Reflect.get(t, p, receiver);
    },
    getOwnPropertyDescriptor: (t, p) => {
      if (typeof p === 'string' && !(p in t)) {
        // configurable:true satisfies Proxy invariants; enumerable:false keeps
        // Object.keys/entries limited to real entries (dropdown unchanged).
        return {
          configurable: true,
          enumerable: false,
          value: fallbackFor(p),
          writable: false,
        };
      }
      return Reflect.getOwnPropertyDescriptor(t, p);
    },
  });
}

const extendedCodeBlockOptions = {
  ...codeBlockOptions,
  supportedLanguages: createTolerantSupportedLanguages(codeBlockOptions.supportedLanguages),
};

const editorSchema = withMultiColumn(
  BlockNoteSchema.create().extend({
    blockSpecs: {
      codeBlock: createCodeBlockSpec(extendedCodeBlockOptions),
      mathBlock: createReactMathBlockSpec(),
      diagram: createReactDiagramBlockSpec(),
    },
    inlineContentSpecs: {
      math: createReactInlineMathSpec(),
    },
  })
);

const EMPTY_SHADCN_COMPONENTS = {};

type MultiColumnDropContext = Parameters<
  NonNullable<typeof baseMultiColumnDropCursor.hooks.computeDropPosition>
>[0];

const multiColumnDropCursor = {
  hooks: {
    computeDropPosition: (context: MultiColumnDropContext) => {
      try {
        return (
          baseMultiColumnDropCursor.hooks.computeDropPosition?.(context) ?? context.defaultPosition
        );
      } catch {
        // Stale drag position during concurrent collaborative edits: fall back to default position
        return context.defaultPosition;
      }
    },
  },
};

function hasMeaningfulContent(blocks: unknown, title: unknown): boolean {
  if (typeof title === 'string' && title !== 'Untitled') {
    return true;
  }
  if (!Array.isArray(blocks)) {
    return false;
  }
  if (blocks.length > 1) {
    return true;
  }
  if (blocks.length === 1) {
    const first = blocks[0] as { content?: unknown[]; children?: unknown[] } | null | undefined;
    if (first && typeof first === 'object') {
      const hasContent = Array.isArray(first.content) && first.content.length > 0;
      const hasChildren = Array.isArray(first.children) && first.children.length > 0;
      return hasContent || hasChildren;
    }
  }
  return false;
}

export function EditorContent({
  documentId,
  ydoc,
  awareness,
  meta,
  updateMeta,
  isReadOnly,
  accessLevel,
  realtimeProvider,
  user,
  isAuthenticated,
  accessToken,
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
  awareness?: Awareness | null;
  meta: DocumentMeta;
  updateMeta: (updates: Partial<DocumentMeta>) => void;
  isReadOnly: boolean;
  accessLevel: DocumentAccessLevel | null;
  realtimeProvider: WebsocketProvider | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  accessToken: string | null;
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
      // Adds column / column list strings (Two Columns, Three Columns) to the
      // slash menu dictionary.
      multi_column: multiColumnLocales.en,
      math: mathLocales.en,
      diagram: diagramLocales.en,
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

  // Keep references to volatile auth and permission props so callbacks and
  // dynamic adapters remain completely stable across renders without tearing down the editor.
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;

  const activeCommentUserRef = useRef(activeCommentUser);
  activeCommentUserRef.current = activeCommentUser;

  const canCommentRef = useRef(canComment);
  canCommentRef.current = canComment;

  const commentRoleRef = useRef(commentRole);
  commentRoleRef.current = commentRole;

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
      const isAuth = isAuthenticatedRef.current;
      const token = accessTokenRef.current;
      const activeUser = activeCommentUserRef.current;

      const shouldRefreshCollaborators =
        isAuth && !!token && now - collaboratorCacheUpdatedAt.current > COMMENT_USER_CACHE_TTL_MS;

      if (shouldRefreshCollaborators) {
        try {
          const collaborators = await documentService.listCollaborators(documentId, token);
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
      usersById.set(activeUser.id, activeUser);

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

        const fallbackName = id === activeUser.id ? activeUser.username : `User ${id.slice(0, 6)}`;
        return {
          id,
          username: fallbackName,
          avatarUrl: buildFallbackAvatar(id, fallbackName),
        };
      });
    },
    [documentId, sharedCommentUsers]
  );

  const threadStore = useMemo(() => {
    // Use DynamicThreadStoreAuth so permissions and user changes update dynamically
    // without re-instantiating the threadStore or CommentsExtension.
    const dynamicAuth = new DynamicThreadStoreAuth(() => {
      const canCommentNow = canCommentRef.current;
      const roleNow = commentRoleRef.current;
      const userNow = activeCommentUserRef.current;
      return canCommentNow
        ? new DefaultThreadStoreAuth(userNow.id, roleNow)
        : new ReadOnlyThreadStoreAuth();
    });

    return new YjsThreadStore(activeCommentUserRef.current.id, ydoc.getMap('threads'), dynamicAuth);
  }, [ydoc]);

  // YjsThreadStore captures userId at construction for authorship (createThread,
  // addComment, resolveBy, reactions) while DynamicThreadStoreAuth only covers
  // permission checks. Sync authorship when identity resolves (e.g. anonymous
  // -> logged-in) without recreating the store/editor.
  useEffect(() => {
    if (threadStore) {
      (threadStore as unknown as { userId: string }).userId = activeCommentUser.id;
    }
  }, [threadStore, activeCommentUser.id]);

  const editorExtensions = useMemo(() => {
    // Custom Shiki highlighter (github-dark/light, extended language set from
    // codeBlockHighlighter.ts) alongside the comments extension.
    return [CommentsExtension({ threadStore, resolveUsers }), syntaxHighlighter];
  }, [resolveUsers, threadStore]);

  // Use the continuous awareness instance tied to ydoc (or fallback to realtimeProvider)
  // so the collaboration provider object remains stable across WebSocket connects/reconnects.
  const collaborationProvider = useMemo(() => {
    if (awareness) {
      return { awareness };
    }
    return realtimeProvider || undefined;
  }, [awareness, realtimeProvider]);

  // Single writer for presence user info (useDocument must not also write to
  // the same awareness field to avoid last-render-wins nondeterminism).
  // Keeps awareness updated without recreating the editor.
  useEffect(() => {
    const awarenessInstance = awareness ?? realtimeProvider?.awareness;
    if (awarenessInstance && activeCommentUser.username) {
      // activeCommentUser.id falls back to 'anonymous', so derive a per-client
      // seed for guests to avoid all guests sharing the same color.
      const colorSeed =
        activeCommentUser.id !== 'anonymous'
          ? activeCommentUser.id
          : `${documentId}:${ydoc.clientID}:${activeCommentUser.username}`;
      awarenessInstance.setLocalStateField('user', {
        name: activeCommentUser.username,
        color: getPresenceColor(colorSeed),
      });
    }
  }, [
    awareness,
    realtimeProvider,
    activeCommentUser.username,
    activeCommentUser.id,
    documentId,
    ydoc,
  ]);

  const editor = useCreateBlockNote(
    withCollaboration({
      schema: editorSchema,
      // The default drop cursor only shows above/below blocks - the
      // multi-column one also shows on the sides for column drops. Wrapped
      // to fall back to the default cursor on stale positions instead of
      // throwing "Position out of range" during concurrent remote edits.
      dropCursor: multiColumnDropCursor,
      tables: {
        splitCells: true,
        cellBackgroundColor: true,
        cellTextColor: true,
        headers: true,
      },
      collaboration: {
        provider: collaborationProvider,
        fragment: ydoc.getXmlFragment('blocknote'),
        user: {
          name: activeCommentUser.username,
          color: getPresenceColor(
            activeCommentUser.id !== 'anonymous'
              ? activeCommentUser.id
              : `${documentId}:${ydoc.clientID}:${activeCommentUser.username}`
          ),
        },
      },
      dictionary: commentsDictionary,
      extensions: editorExtensions,
    }),
    // The editor is created strictly once per document mount. Keyed by documentId at parent.
    [documentId, ydoc]
  );

  const getSlashMenuItems = useCallback(
    async (query: string) => {
      const defaultItems = getDefaultReactSlashMenuItems(editor);
      const columnItems = getMultiColumnSlashMenuItems(editor);
      const mathItems = getMathSlashMenuItems(editor);
      const diagramItems = getDiagramSlashMenuItems(editor);
      return filterSuggestionItems(
        combineByGroup(defaultItems, columnItems, mathItems, diagramItems),
        query
      );
    },
    [editor]
  );

  // Stable component identity for the formatting toolbar. Passing an inline
  // `() => (...)` closure would create a new component type on every
  // EditorContent render (e.g. realtime reconnect, meta update), unmounting
  // and remounting the toolbar and dropping transient state (open link
  // editor, block-type menu).
  const renderFormattingToolbar = useCallback(
    () => (
      <FormattingToolbar
        blockTypeSelectItems={[
          ...blockTypeSelectItems(editor.dictionary),
          ...getMathBlockTypeSelectItems(editor),
          ...getDiagramBlockTypeSelectItems(editor),
        ]}
      />
    ),
    [editor]
  );

  useCommentComposerPatch(commentsUiEnabled, sendIconTemplateRef);

  useEffect(() => {
    editor.isEditable = !isReadOnly;
  }, [editor, isReadOnly]);

  // Freeze `editable` at first mount. BlockNoteViewEditor recreates its `mount`
  // callback ref whenever `editable` changes, causing React to call
  // `mount(null)` + `mount(element)` synchronously and tearing down the
  // ProseMirror view / Yjs UndoManager (breaks undo/redo). Driving read-only
  // solely via `editor.isEditable` above avoids the bounce without patching
  // `editor.mount`/`editor.unmount`.
  // Parent keys EditorContent by documentId, so the initial value is per-document.
  const initialEditableRef = useRef(!isReadOnly);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusRequested = useRef(false);

  const [isEditorVisible, setIsEditorVisible] = useState(() => {
    return hasMeaningfulContent(editor?.document, meta.title);
  });

  useEffect(() => {
    const revealIfHasContent = () => {
      // Title is covered by the initializer above (fresh mount per document);
      // this subscription only reacts to content arriving later (e.g. Yjs
      // sync), so typing a title alone doesn't prematurely reveal the editor.
      if (hasMeaningfulContent(editor?.document, undefined)) {
        setIsEditorVisible(true);
      }
    };

    revealIfHasContent();
    if (typeof editor?.onChange === 'function') {
      return editor.onChange(revealIfHasContent);
    }
  }, [editor]);

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
            editable={initialEditableRef.current}
            onPointerDownCapture={handleEditorPointerDownCapture}
            shadCNComponents={EMPTY_SHADCN_COMPONENTS}
            formattingToolbar={false}
            linkToolbar={!isViewer}
            slashMenu={false}
            sideMenu={false}
            filePanel={!isViewer}
            tableHandles={!isViewer}
            emojiPicker={!isViewer}
            comments={false}
          >
            {!isViewer && (
              <FormattingToolbarController formattingToolbar={renderFormattingToolbar} />
            )}
            {!isViewer && (
              <SuggestionMenuController triggerCharacter={'/'} getItems={getSlashMenuItems} />
            )}
            <span ref={sendIconTemplateRef} className="sr-only" aria-hidden="true">
              <Send size={14} strokeWidth={1.75} />
            </span>
            {!isViewer && (
              <SideMenuController
                floatingUIOptions={SIDE_MENU_FLOATING_OPTIONS}
                sideMenu={CustomSideMenu}
              />
            )}
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
