import type {
  CollaboratorAccessLevel,
  DocumentAccessLevel,
  DocumentGeneralAccessMode,
  DocumentWorkspaceAccessMode,
  SharingSourceKind,
} from '@/services/document.service';

export interface DropdownOption<T extends string = string> {
  value: T;
  label: string;
  description?: string;
  dividerBefore?: boolean;
  isDestructive?: boolean;
}

export type CollaboratorDropdownValue = CollaboratorAccessLevel | 'INHERIT' | 'LEAVE';
export type GeneralAccessModeDropdownValue =
  DocumentGeneralAccessMode | DocumentWorkspaceAccessMode | 'INHERIT';

export const ACCESS_LABELS: Record<string, string> = {
  VIEW: 'Can view',
  COMMENT: 'Can comment',
  EDIT: 'Can edit',
  OWNER: 'Owner',
  NO_ACCESS: 'No access',
};

/** OWNER is the only level that may also administer sharing below the page. */
export const OWNER_DESCRIPTION = 'Can edit and manage sharing, including child pages';

/**
 * The only way out of a page for the person themselves: the API keeps self-removal on
 * `DELETE /collaborators/me`, because a self No access row would be a breakpoint only
 * an admin could undo.
 */
export const LEAVE_LABEL = 'Leave page';

export const ACCESS_ACTION_LABELS: Record<string, string> = {
  VIEW: 'view',
  COMMENT: 'comment',
  EDIT: 'edit',
  OWNER: 'manage',
  NO_ACCESS: 'no access',
};

export const INVITE_ACCESS_OPTIONS: DropdownOption<DocumentAccessLevel>[] = [
  { value: 'OWNER', label: ACCESS_LABELS.OWNER, description: OWNER_DESCRIPTION },
  { value: 'EDIT', label: ACCESS_LABELS.EDIT },
  { value: 'COMMENT', label: ACCESS_LABELS.COMMENT },
  { value: 'VIEW', label: ACCESS_LABELS.VIEW },
];

export const GENERAL_ACCESS_LEVEL_OPTIONS: DropdownOption<DocumentAccessLevel>[] = [
  { value: 'VIEW', label: ACCESS_LABELS.VIEW },
  { value: 'COMMENT', label: ACCESS_LABELS.COMMENT },
  { value: 'EDIT', label: ACCESS_LABELS.EDIT },
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
  linkExpiresAt?: string | null;
}

export type GeneralAccessState = 'own' | 'inherited' | 'blocked' | 'expired' | 'private';

export interface GeneralAccessViewModel {
  /** Own link, inherited link, blocked inheritance, expired link, or fully private. */
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
  const isOwnLinkExpired =
    hasOwnPublicLink &&
    (settings?.hasActiveLink === false ||
      (Boolean(settings?.linkExpiresAt) &&
        new Date(settings!.linkExpiresAt!).getTime() <= Date.now()));
  const hasEffectivePublicLink =
    !isLinkBlocked &&
    (isInheritedPublicLink ||
      (!isOwnLinkExpired && (Boolean(settings?.hasActiveLink) || hasOwnPublicLink)));
  const inheritedFromTitle = normalizeTitle(settings?.inheritedFromTitle);

  const state: GeneralAccessState = isLinkBlocked
    ? 'blocked'
    : isInheritedPublicLink
      ? 'inherited'
      : isOwnLinkExpired
        ? 'expired'
        : hasOwnPublicLink
          ? 'own'
          : 'private';

  return {
    state,
    hasOwnPublicLink,
    isInheritedPublicLink,
    hasEffectivePublicLink,
    // An override or a block can be undone back to parent inheritance, like a
    // collaborator row's Inherit option. A block offers it even when the parent
    // source is redacted; the generic label needs no title.
    showInheritOption: isOverridingPublicLink || isLinkBlocked,
    showProvenanceBadge: isOverridingPublicLink || isBlockedWithAncestor,
    provenanceBadgePrefix: isBlockedWithAncestor ? 'Blocked from' : 'Overrides',
    provenanceBadgeTooltip: isBlockedWithAncestor
      ? `Blocks inheritance from ${inheritedFromTitle}`
      : `Overrides ${inheritedFromTitle}`,
    inheritedFromTitle,
    // Effective or expired links show Anyone with the link; private and blocked show Restricted.
    displayMode: hasEffectivePublicLink || state === 'expired' ? 'ANYONE_WITH_LINK' : 'RESTRICTED',
  };
}

/** Subset of SharingSettings the workspace-access view model reads. */
export interface WorkspaceAccessSettings {
  workspaceAccessMode?: DocumentWorkspaceAccessMode;
  workspaceAccessLevel?: DocumentAccessLevel;
  workspaceInherited?: boolean | null;
  /** PAGE when an ancestor page supplies the setting, SPACE when the anchoring space does. */
  workspaceInheritedFromKind?: SharingSourceKind | null;
  workspaceInheritedFromId?: string | null;
  workspaceInheritedFromTitle?: string | null;
  workspaceInheritBlocked?: boolean | null;
}

export type WorkspaceAccessState = 'own' | 'inherited' | 'blocked' | 'private';

export interface WorkspaceAccessViewModel {
  state: WorkspaceAccessState;
  displayMode: DocumentWorkspaceAccessMode;
  /** The level this channel grants: the page's own setting, or the inherited one. */
  level: DocumentAccessLevel;
  hasEffectiveWorkspaceAccess: boolean;
  hasOwnWorkspaceAccess: boolean;
  isInheritedWorkspaceAccess: boolean;
  isWorkspaceBlocked: boolean;
  showInheritOption: boolean;
  inheritFromTitle: string;
  sourceTitle: string | null;
  sourceId: string | null;
  sourceKind: SharingSourceKind | null;
  showSourceBadge: boolean;
  sourceBadgePrefix: 'From' | 'Overrides' | 'Blocked from';
  sourceBadgeTooltip: string;
}

/**
 * The General access row for "Anyone in this workspace".
 *
 * The API resolves the audience as one channel: a page's own setting, an ancestor page's,
 * or the anchoring space's everyone level, nearest first and stopped by a block. So this
 * view model never ranks those sources against each other — it renders the resolved state
 * and names whichever source the API reported. A space is not a separate behaviour here:
 * it is a container that supplies a grant, and a page inside it overrides or blocks the
 * setting exactly like a page under a shared ancestor.
 */
export function getWorkspaceAccessViewModel(
  settings: WorkspaceAccessSettings | null | undefined
): WorkspaceAccessViewModel {
  const hasOwn = settings?.workspaceAccessMode === 'WORKSPACE_MEMBERS';
  const isBlocked = Boolean(settings?.workspaceInheritBlocked);
  const isInherited = Boolean(settings?.workspaceInherited) && !isBlocked;
  const sourceKind = settings?.workspaceInheritedFromKind ?? null;
  const sourceId = settings?.workspaceInheritedFromId ?? null;
  const sourceTitle = settings?.workspaceInheritedFromTitle
    ? normalizeTitle(settings.workspaceInheritedFromTitle, '')
    : null;
  const hasSource = Boolean(sourceId || sourceTitle);
  const level: DocumentAccessLevel = settings?.workspaceAccessLevel ?? 'VIEW';
  const hasEffectiveWorkspaceAccess = !isBlocked && (hasOwn || isInherited);

  const state: WorkspaceAccessState = isBlocked
    ? 'blocked'
    : hasOwn
      ? 'own'
      : isInherited
        ? 'inherited'
        : 'private';

  // A block or an override still names the source it shadows or replaces, so the row can
  // offer "Inherit from X" instead of a dead end.
  const showSourceBadge = hasSource && (hasOwn || isBlocked || isInherited);
  const sourceBadgePrefix: WorkspaceAccessViewModel['sourceBadgePrefix'] = isBlocked
    ? 'Blocked from'
    : hasOwn
      ? 'Overrides'
      : 'From';
  const sourceBadgeTooltip = !showSourceBadge
    ? ''
    : isBlocked
      ? `Blocks inheritance from ${sourceTitle}`
      : hasOwn
        ? `Overrides ${sourceTitle}`
        : `From “${sourceTitle}”`;

  return {
    state,
    displayMode: hasEffectiveWorkspaceAccess ? 'WORKSPACE_MEMBERS' : 'RESTRICTED',
    level,
    hasEffectiveWorkspaceAccess,
    hasOwnWorkspaceAccess: hasOwn,
    isInheritedWorkspaceAccess: isInherited,
    isWorkspaceBlocked: isBlocked,
    // Undoing a block returns the page to the resolved source even when redaction
    // hides which source that is; undoing an override needs a source to name.
    showInheritOption: isBlocked || (hasOwn && hasSource),
    inheritFromTitle: showSourceBadge ? (sourceTitle ?? '') : '',
    sourceTitle: showSourceBadge ? sourceTitle : null,
    sourceId: showSourceBadge ? sourceId : null,
    sourceKind: showSourceBadge ? sourceKind : null,
    showSourceBadge,
    sourceBadgePrefix,
    sourceBadgeTooltip,
  };
}

/** Options for a General access row, including the other audience when it can be added. */
export function getGeneralAccessModeOptions({
  current,
  canRestrict,
  canAddWorkspace,
  canAddLink,
  showInheritOption,
  inheritFromTitle,
}: {
  current: DocumentGeneralAccessMode | DocumentWorkspaceAccessMode;
  canRestrict: boolean;
  canAddWorkspace: boolean;
  canAddLink: boolean;
  showInheritOption: boolean;
  inheritFromTitle?: string | null;
}): DropdownOption<GeneralAccessModeDropdownValue>[] {
  const options: DropdownOption<GeneralAccessModeDropdownValue>[] = [];
  if (canRestrict || current === 'RESTRICTED') {
    options.push({
      value: 'RESTRICTED',
      label: 'Restricted',
      description: 'Only people with access can open',
    });
  }
  if (canAddWorkspace || current === 'WORKSPACE_MEMBERS') {
    options.push({
      value: 'WORKSPACE_MEMBERS',
      label: 'Anyone in this workspace',
      description: 'Everyone in the workspace can access',
    });
  }
  if (canAddLink || current === 'ANYONE_WITH_LINK') {
    options.push({
      value: 'ANYONE_WITH_LINK',
      label: 'Anyone with the link',
      description: 'Anyone with the link can access',
    });
  }
  if (showInheritOption) {
    const parentTitle = normalizeTitle(inheritFromTitle, '');
    options.push({
      value: 'INHERIT',
      label: parentTitle ? `Inherit from ${parentTitle}` : 'Resume inheriting',
    });
  }
  return options;
}
