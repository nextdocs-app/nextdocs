import type { FloatingUIOptions } from '@blocknote/react';
import { flip, offset, shift, size } from '@floating-ui/react';
import { createViewportBounds } from '@/lib/viewport-bounds.util';
import { buildInitialsAvatarDataUrl, resolveAvatarUrl } from '@/lib/avatar.util';
import type { CommentThreadStats } from '@/components/comments/CommentsSidebar';

export const EMPTY_COMMENT_STATS: CommentThreadStats = { open: 0, resolved: 0, all: 0 };

/** Gap between the commented text and the thread card, as BlockNote places it. */
const COMMENT_THREAD_OFFSET_PX = 10;

/**
 * Where the thread card may sit while it is open.
 *
 * BlockNote's own middleware keeps the card inside the *viewport* and leaves it
 * at that: a thread with more replies than fit between the commented text and
 * the screen edge — or anchored so close to the top that the room below is a few
 * pixels — overflows the edge, and near the top it also slides under the
 * document toolbar, which floats above the editor rather than pushing it down.
 *
 * So the boundary here is the viewport *minus the toolbar* (shared with the
 * formatting toolbar's popups, see `createViewportBounds`), and the card is
 * capped to the room left on the side it was placed on. A thread that does not
 * fit scrolls inside its own card (`overflow-y` in `styles/comments-threads.css`) instead
 * of spilling past the edges.
 *
 * `toolbarInset` is measured (see `useDocumentToolbarInset`): the toolbar's
 * height changes with the breakpoint and with a wrapped notice row.
 */
export function createCommentThreadFloatingOptions(toolbarInset: number): FloatingUIOptions {
  const bounds = createViewportBounds(toolbarInset);

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

/**
 * The avatar BlockNote's comment UI draws for one person.
 *
 * It needs an image source, not an element, so a photo is resolved against the API
 * origin here; only an account without one gets the generated initials. Anything the
 * resolver refuses falls back the same way, which keeps a malformed value out of the card.
 */
export function commentAvatarUrl(
  userId: string,
  username: string,
  avatarUrl?: string | null
): string {
  return resolveAvatarUrl(avatarUrl) || buildInitialsAvatarDataUrl(userId, username);
}
