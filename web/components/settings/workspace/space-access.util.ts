import type { DropdownOption } from '@/components/share/AccessDropdown';
import type {
  SpaceAccessLevel,
  SpaceAccessMode,
  SpaceEveryoneAccessLevel,
} from '@/types/space.types';

/** Inline feedback for the spaces surfaces, matching the People page. */
export interface SpaceNotice {
  kind: 'status' | 'error';
  message: string;
}

/** Mirrors the server's `SpaceAccessMode`, for chips and radio cards. */
export const SPACE_ACCESS_MODE_LABELS: Record<SpaceAccessMode, string> = {
  PUBLIC: 'Public',
  CUSTOM: 'Custom',
};

export const SPACE_ACCESS_MODE_DESCRIPTIONS: Record<SpaceAccessMode, string> = {
  PUBLIC: 'Every workspace member can open this space.',
  CUSTOM: 'Only the people you add can open this space.',
};

export const SPACE_LEVEL_LABELS: Record<SpaceAccessLevel, string> = {
  OWNER: 'Owner',
  EDIT: 'Can edit',
  COMMENT: 'Can comment',
  VIEW: 'Can view',
};

export const SPACE_LEVEL_DESCRIPTIONS: Record<SpaceAccessLevel, string> = {
  OWNER: 'Can edit documents and manage the space',
  EDIT: 'Can add and edit documents',
  COMMENT: 'Can comment on documents',
  VIEW: 'Can read documents',
};

/** Member levels, most privileged first, matching the workspace role dropdown. */
export const SPACE_MEMBER_LEVEL_OPTIONS: DropdownOption<SpaceAccessLevel>[] = (
  ['OWNER', 'EDIT', 'COMMENT', 'VIEW'] as const
).map((level) => ({
  value: level,
  label: SPACE_LEVEL_LABELS[level],
  description: SPACE_LEVEL_DESCRIPTIONS[level],
}));

/** The everyone-else grant. Ownership belongs to members, so OWNER is absent. */
export const SPACE_EVERYONE_LEVEL_OPTIONS: DropdownOption<SpaceEveryoneAccessLevel>[] = (
  ['EDIT', 'COMMENT', 'VIEW'] as const
).map((level) => ({
  value: level,
  label: SPACE_LEVEL_LABELS[level],
}));

export type SpaceMemberAction = SpaceAccessLevel | 'REMOVE' | 'LEAVE';

/**
 * Options for one member row. Mirrors the server: an administrator may change
 * any level except the last owner's, a member may leave, and nobody may remove
 * the last owner. Returning a single option means "no action to offer" — the
 * caller renders a plain label instead of a dead dropdown.
 */
export function spaceMemberOptions({
  canAdminister,
  memberLevel,
  isSelf,
  ownerCount,
}: {
  canAdminister: boolean;
  memberLevel: SpaceAccessLevel;
  isSelf: boolean;
  ownerCount: number;
}): DropdownOption<SpaceMemberAction>[] {
  const isLastOwner = memberLevel === 'OWNER' && ownerCount <= 1;

  if (!canAdminister) {
    if (!isSelf || isLastOwner) {
      return [];
    }

    return [
      { value: memberLevel, label: SPACE_LEVEL_LABELS[memberLevel] },
      { value: 'LEAVE', label: 'Leave space', dividerBefore: true, isDestructive: true },
    ];
  }

  if (isLastOwner) {
    // The space must keep one owner: the row is a label, not a menu.
    return [{ value: 'OWNER', label: SPACE_LEVEL_LABELS.OWNER }];
  }

  return [
    ...SPACE_MEMBER_LEVEL_OPTIONS,
    {
      value: 'REMOVE' as const,
      label: isSelf ? 'Leave space' : 'Remove from space',
      dividerBefore: true,
      isDestructive: true,
    },
  ];
}

export function spaceMemberCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'member' : 'members'}`;
}

export function spaceDocumentCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'document' : 'documents'}`;
}

/** `Sep 3, 2026`, or null when the timestamp cannot be read. */
export function formatSpaceDate(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
