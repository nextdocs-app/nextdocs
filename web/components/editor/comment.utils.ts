import { ThreadStoreAuth } from '@blocknote/core/comments';
import { getPresenceColor } from '@/lib/realtime.util';
import type { DocumentAccessLevel } from '@/services/document.service';
import type { CommentThreadStats } from '@/components/comments/CommentsSidebar';

export const EMPTY_COMMENT_STATS: CommentThreadStats = { open: 0, resolved: 0, all: 0 };
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
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'><rect width='96' height='96' rx='48' fill='${fill}'/><text x='50%' y='56%' dominant-baseline='middle' text-anchor='middle' fill='white' font-family='ui-sans-serif, system-ui, -apple-system' font-size='38' font-weight='600'>${initial}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
