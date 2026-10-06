import type {
  CollaboratorAccessLevel,
  DocumentAccessLevel,
  DocumentGeneralAccessMode,
} from '@/services/document.service';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  dividerBefore?: boolean;
  isDestructive?: boolean;
}

export type CollaboratorDropdownValue = CollaboratorAccessLevel | 'INHERIT';
export type GeneralModeDropdownValue = DocumentGeneralAccessMode | 'INHERIT';

export const ACCESS_LABELS: Record<string, string> = {
  VIEW: 'Can view',
  COMMENT: 'Can comment',
  EDIT: 'Can edit',
  OWNER: 'Full access',
  NO_ACCESS: 'No access',
};

export const ACCESS_ACTION_LABELS: Record<string, string> = {
  VIEW: 'view',
  COMMENT: 'comment',
  EDIT: 'edit',
  OWNER: 'manage',
  NO_ACCESS: 'no access',
};

export const INVITE_ACCESS_OPTIONS: DropdownOption<DocumentAccessLevel>[] = [
  { value: 'OWNER', label: 'Full access', description: 'Can edit and share' },
  { value: 'EDIT', label: 'Can edit' },
  { value: 'COMMENT', label: 'Can comment' },
  { value: 'VIEW', label: 'Can view' },
];

export const LINK_ACCESS_OPTIONS: DropdownOption<DocumentAccessLevel>[] = [
  { value: 'VIEW', label: 'Can view' },
  { value: 'COMMENT', label: 'Can comment' },
  { value: 'EDIT', label: 'Can edit' },
];

const GENERAL_MODE_OPTIONS: DropdownOption<DocumentGeneralAccessMode>[] = [
  { value: 'RESTRICTED', label: 'Restricted', description: 'Only people with access can open' },
  {
    value: 'ANYONE_WITH_LINK',
    label: 'Anyone with the link',
    description: 'Anyone with the link can access',
  },
];

export function normalizeTitle(value?: string | null, fallback = 'parent'): string {
  return (value || fallback).trim().replace(/\s+/g, ' ');
}

/** Subset of SharingSettings the general-access view model reads. */
export interface GeneralAccessSettings {
  generalAccessMode: DocumentGeneralAccessMode;
  linkAccessLevel: DocumentAccessLevel;
  hasActiveLink?: boolean | null;
  inherited?: boolean | null;
  inheritedFromId?: string | null;
  inheritedFromTitle?: string | null;
  linkInheritBlocked?: boolean | null;
}

export type GeneralAccessState = 'own' | 'inherited' | 'blocked' | 'private';

export interface GeneralAccessViewModel {
  /** Own link, inherited link, blocked inheritance, or fully private. */
  state: GeneralAccessState;
  hasOwnPublicLink: boolean;
  isInheritedPublicLink: boolean;
  hasEffectivePublicLink: boolean;
  showInheritOption: boolean;
  showProvenanceBadge: boolean;
  provenanceBadgePrefix: 'Overrides' | 'Blocked from';
  provenanceBadgeTooltip: string;
  inheritedFromTitle: string;
  displayMode: DocumentGeneralAccessMode;
}

/**
 * Single source of truth for the General access control, so the dropdown, the
 * badges and the save handlers cannot drift apart: an own link masks the
 * ancestor grant, a block shadows it entirely, and only own/effective links
 * display as "Anyone with the link".
 *
 * Server contract: the API clears `inherited` when an own link exists, and
 * never reports `hasActiveLink:true` with `RESTRICTED` and no inheritance.
 * `displayMode` is derived from the effective link so the dropdown cannot
 * contradict the helper sentence.
 */
export function getGeneralAccessViewModel(
  settings: GeneralAccessSettings | null | undefined
): GeneralAccessViewModel {
  const hasOwnPublicLink = settings?.generalAccessMode === 'ANYONE_WITH_LINK';
  const isInheritedPublicLink = Boolean(settings?.inherited);
  const isLinkBlocked = Boolean(settings?.linkInheritBlocked);
  const isOverridingPublicLink = hasOwnPublicLink && Boolean(settings?.inheritedFromId);
  const isBlockedWithAncestor = isLinkBlocked && Boolean(settings?.inheritedFromId);
  const hasEffectivePublicLink =
    (Boolean(settings?.hasActiveLink) || hasOwnPublicLink || isInheritedPublicLink) &&
    !isLinkBlocked;
  const inheritedFromTitle = normalizeTitle(settings?.inheritedFromTitle);

  const state: GeneralAccessState = isLinkBlocked
    ? 'blocked'
    : isInheritedPublicLink
      ? 'inherited'
      : hasOwnPublicLink
        ? 'own'
        : 'private';

  return {
    state,
    hasOwnPublicLink,
    isInheritedPublicLink,
    hasEffectivePublicLink,
    // An override or a block can be undone back to parent inheritance, like a
    // collaborator row's Inherit option. A block without an ancestor has
    // nowhere to inherit from, so it offers no Inherit option.
    showInheritOption: isOverridingPublicLink || isBlockedWithAncestor,
    showProvenanceBadge: isOverridingPublicLink || isBlockedWithAncestor,
    provenanceBadgePrefix: isBlockedWithAncestor ? 'Blocked from' : 'Overrides',
    provenanceBadgeTooltip: isBlockedWithAncestor
      ? `Blocks inheritance from ${inheritedFromTitle}`
      : `Overrides ${inheritedFromTitle}`,
    inheritedFromTitle,
    // Effective links show the effective mode so the dropdown never contradicts
    // the helper sentence ("Restricted" plus "Anyone ... can edit").
    displayMode: hasEffectivePublicLink ? 'ANYONE_WITH_LINK' : 'RESTRICTED',
  };
}

/**
 * Mode options for the General access dropdown, mirroring
 * getCollaboratorRowOptions: an override (own link over an ancestor grant, or
 * a blocked inheritance) offers its way back via an Inherit option.
 */
export function getGeneralModeOptions({
  showInheritOption,
  inheritedFromTitle,
}: {
  showInheritOption: boolean;
  inheritedFromTitle?: string | null;
}): DropdownOption<GeneralModeDropdownValue>[] {
  const options: DropdownOption<GeneralModeDropdownValue>[] = [...GENERAL_MODE_OPTIONS];
  if (showInheritOption) {
    const parentTitle = normalizeTitle(inheritedFromTitle, '');
    options.push({
      value: 'INHERIT',
      label: parentTitle ? `Inherit from ${parentTitle}` : 'Resume inheriting',
    });
  }
  return options;
}
