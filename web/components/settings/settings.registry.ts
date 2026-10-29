import { Sliders, UserCircle, Users, Workspace } from '@/icons';
import type { SettingsEntry, SettingsGroup } from './types';
import { PreferencesPanel } from './panels/PreferencesPanel';
import { ProfilePanel } from './panels/ProfilePanel';
import { WorkspaceGeneralPanel } from './panels/WorkspaceGeneralPanel';
import { WorkspacePeoplePanel } from './panels/WorkspacePeoplePanel';

/**
 * The settings catalog. Everything the dialog shows — nav order, group
 * headings, page titles, and panels — is derived from this list.
 *
 * To add a page: append an entry with its icon and `Panel`. The nav item,
 * default content header, and small-screen tab are rendered automatically.
 * Settings inside a panel are composed from `SettingsSection` / `SettingsRow`.
 */
export const SETTINGS_GROUPS: SettingsGroup[] = [
  {
    id: 'account',
    label: 'Account',
    entries: [
      {
        id: 'profile',
        label: 'Profile',
        description: 'Manage your personal profile and account details.',
        icon: UserCircle,
        Panel: ProfilePanel,
      },
      {
        id: 'preferences',
        label: 'Preferences',
        description: 'Choose how NextDocs looks and behaves on this device.',
        icon: Sliders,
        Panel: PreferencesPanel,
      },
    ],
  },
  {
    id: 'workspace',
    label: 'Workspace',
    entries: [
      {
        id: 'workspace-general',
        label: 'General',
        description: 'Manage the workspace name and icon.',
        icon: Workspace,
        requiresAuth: true,
        Panel: WorkspaceGeneralPanel,
      },
      {
        id: 'workspace-people',
        label: 'People',
        description: 'See who has access to this workspace and manage invitations.',
        icon: Users,
        requiresAuth: true,
        Panel: WorkspacePeoplePanel,
      },
    ],
  },
];

/** Flat lookup for panels; the nav keeps the grouped view. */
export const SETTINGS_ENTRIES: SettingsEntry[] = SETTINGS_GROUPS.flatMap((group) => group.entries);

/**
 * The groups a visitor can actually use. Entries that need a session are
 * dropped for guests, and a group with nothing left disappears with them.
 */
export function getSettingsGroups(isAuthenticated: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) => !entry.requiresAuth || isAuthenticated),
  })).filter((group) => group.entries.length > 0);
}

/** Page shown when settings opens. */
export const DEFAULT_SETTINGS_ENTRY_ID = 'preferences';
