export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  dividerBefore?: boolean;
  isDestructive?: boolean;
}

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

export const INVITE_ACCESS_OPTIONS: DropdownOption[] = [
  { value: 'OWNER', label: 'Full access', description: 'Can edit and share' },
  { value: 'EDIT', label: 'Can edit' },
  { value: 'COMMENT', label: 'Can comment' },
  { value: 'VIEW', label: 'Can view' },
];

export const LINK_ACCESS_OPTIONS: DropdownOption[] = [
  { value: 'VIEW', label: 'Can view' },
  { value: 'COMMENT', label: 'Can comment' },
  { value: 'EDIT', label: 'Can edit' },
];

const GENERAL_MODE_OPTIONS: DropdownOption[] = [
  { value: 'RESTRICTED', label: 'Restricted', description: 'Only people with access can open' },
  {
    value: 'ANYONE_WITH_LINK',
    label: 'Anyone with the link',
    description: 'Anyone with the link can access',
  },
];

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
}): DropdownOption[] {
  const options = [...GENERAL_MODE_OPTIONS];
  if (showInheritOption) {
    const parentTitle = (inheritedFromTitle || '').trim().replace(/\s+/g, ' ');
    options.push({
      value: 'INHERIT',
      label: parentTitle ? `Inherit from ${parentTitle}` : 'Resume inheriting',
    });
  }
  return options;
}
