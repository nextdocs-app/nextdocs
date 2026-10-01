import { ThreadStoreAuth } from '@blocknote/core/comments';
import type { FloatingUIOptions } from '@blocknote/react';
import { flip, offset, shift, size } from '@floating-ui/react';
import { getPresenceColor } from '@/lib/realtime.util';
import type { DocumentAccessLevel } from '@/services/document.service';
import type { CommentThreadStats } from '@/components/comments/CommentsSidebar';

export const EMPTY_COMMENT_STATS: CommentThreadStats = { open: 0, resolved: 0, all: 0 };

/** Gap between the commented text and the thread card, as BlockNote places it. */
const COMMENT_THREAD_OFFSET_PX = 10;

/** Distance kept from the viewport's side and bottom edges. */
const COMMENT_THREAD_VIEWPORT_MARGIN_PX = 12;

/**
 * Where the thread card may sit while it is open.
 *
 * BlockNote's own middleware keeps the card inside the *viewport* and leaves it
 * at that: a thread with more replies than fit between the commented text and
 * the screen edge — or anchored so close to the top that the room below is a few
 * pixels — overflows the edge, and near the top it also slides under the
 * document toolbar, which floats above the editor rather than pushing it down.
 *
 * So the boundary here is the viewport *minus the toolbar*, and the card is
 * capped to the room left on the side it was placed on. A thread that does not
 * fit scrolls inside its own card (`overflow-y` in `styles/globals.css`) instead
 * of spilling past the edges.
 *
 * `toolbarInset` is measured (see `useDocumentToolbarInset`): the toolbar's
 * height changes with the breakpoint and with a wrapped notice row.
 */
export function createCommentThreadFloatingOptions(toolbarInset: number): FloatingUIOptions {
  const bounds = {
    top: toolbarInset,
    right: COMMENT_THREAD_VIEWPORT_MARGIN_PX,
    bottom: COMMENT_THREAD_VIEWPORT_MARGIN_PX,
    left: COMMENT_THREAD_VIEWPORT_MARGIN_PX,
  };

  return {
    useFloatingOptions: {
      middleware: [
        offset(COMMENT_THREAD_OFFSET_PX),
        // The side of the commented text that has room for the card...
        flip({ padding: bounds }),
        // ...kept inside the bounds on both axes when it still pokes out...
        shift({ padding: bounds }),
        // ...and capped to the room that side has left, so a thread with more
        // replies than fit scrolls inside its own card instead of spilling over
        // the toolbar or the bottom edge.
        size({
          padding: bounds,
          apply({ availableHeight, elements }) {
            elements.floating.style.maxHeight = `${availableHeight}px`;
          },
        }),
      ],
    },
    elementProps: {
      // `nd-comment-thread` is the hook the card's scroll rules hang off.
      className: 'nd-comment-thread',
      style: {
        zIndex: 30,
        // Column, so the card is the flex item that gives way to the cap above.
        flexDirection: 'column',
      },
    },
  };
}

export const COMMENT_USER_CACHE_TTL_MS = 20_000;
export const COMMENT_USERS_MAP_KEY = 'comment-users';

export function mapAccessLevelToCommentRole(
  accessLevel: DocumentAccessLevel | null
): 'comment' | 'editor' {
  return accessLevel === 'COMMENT' ? 'comment' : 'editor';
}

export class ReadOnlyThreadStoreAuth extends ThreadStoreAuth {
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

export class DynamicThreadStoreAuth extends ThreadStoreAuth {
  constructor(private readonly getAuth: () => ThreadStoreAuth) {
    super();
  }

  canCreateThread(): boolean {
    return this.getAuth().canCreateThread();
  }

  canAddComment(thread: Parameters<ThreadStoreAuth['canAddComment']>[0]): boolean {
    return this.getAuth().canAddComment(thread);
  }

  canUpdateComment(comment: Parameters<ThreadStoreAuth['canUpdateComment']>[0]): boolean {
    return this.getAuth().canUpdateComment(comment);
  }

  canDeleteComment(comment: Parameters<ThreadStoreAuth['canDeleteComment']>[0]): boolean {
    return this.getAuth().canDeleteComment(comment);
  }

  canDeleteThread(thread: Parameters<ThreadStoreAuth['canDeleteThread']>[0]): boolean {
    return this.getAuth().canDeleteThread(thread);
  }

  canResolveThread(thread: Parameters<ThreadStoreAuth['canResolveThread']>[0]): boolean {
    return this.getAuth().canResolveThread(thread);
  }

  canUnresolveThread(thread: Parameters<ThreadStoreAuth['canUnresolveThread']>[0]): boolean {
    return this.getAuth().canUnresolveThread(thread);
  }

  canAddReaction(
    comment: Parameters<ThreadStoreAuth['canAddReaction']>[0],
    emoji?: string
  ): boolean {
    return this.getAuth().canAddReaction(comment, emoji);
  }

  canDeleteReaction(
    comment: Parameters<ThreadStoreAuth['canDeleteReaction']>[0],
    emoji?: string
  ): boolean {
    return this.getAuth().canDeleteReaction(comment, emoji);
  }
}

export interface SharedCommentUserProfile {
  username: string;
  avatarUrl: string | null;
}

export function parseSharedCommentUserProfile(raw: unknown): SharedCommentUserProfile | null {
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

export function buildFallbackAvatar(seed: string, username: string): string {
  const initial = (username.trim()[0] ?? 'U').toUpperCase();
  const fill = getPresenceColor(seed || initial);
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='48' fill='${fill}'/><text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='ui-sans-serif, system-ui, -apple-system' font-size='39' font-weight='600'>${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
