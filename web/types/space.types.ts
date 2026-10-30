import type { IconRequestPayload } from '@/lib/document-icon.util';
import type { DocumentIcon } from '@/types/document.types';

/** Who may read a space's documents. Mirrors the server's `SpaceAccessMode`. */
export type SpaceAccessMode = 'PUBLIC' | 'CUSTOM';

/** Levels a space member row can carry; `NO_ACCESS` is never a membership. */
export type SpaceAccessLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER';

/** The everyone-else grant of a PUBLIC space: ownership stays with members. */
export type SpaceEveryoneAccessLevel = Exclude<SpaceAccessLevel, 'OWNER'>;

/**
 * Wire shape of a space summary from `GET /api/v1/spaces`. The API omits nulls,
 * so optional-looking fields are read through `?? null`.
 */
export interface Space {
  id: string;
  name: string;
  /**
   * The caller's fractional sidebar key. Spaces the caller has positioned come
   * first in key order; the rest keep creation order after them. Absent when
   * the caller has not moved the space yet.
   */
  orderKey?: string | null;
  icon: DocumentIcon | null;
  accessMode: SpaceAccessMode;
  everyoneAccessLevel: SpaceEveryoneAccessLevel;
  /** Null for a workspace admin who is not a member of the space. */
  myAccessLevel: SpaceAccessLevel | null;
  canAdminister: boolean;
  memberCount: number;
  /** Root pages filed in the space, including pages in trash: those block deletion. */
  pageCount: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Wire shape of `GET /api/v1/spaces/{id}/members`. */
export interface SpaceMember {
  userId: string;
  email: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  accessLevel: SpaceAccessLevel;
  addedAt: string;
}

export interface SpaceCreateInput {
  name: string;
  icon?: IconRequestPayload;
  accessMode: SpaceAccessMode;
  everyoneAccessLevel: SpaceEveryoneAccessLevel;
}

/** PATCH body. Absent fields stay unchanged, so callers send only what changed. */
export interface SpaceUpdateInput {
  name?: string;
  icon?: IconRequestPayload;
  accessMode?: SpaceAccessMode;
  everyoneAccessLevel?: SpaceEveryoneAccessLevel;
}
