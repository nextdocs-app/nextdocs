import { Sliders, UserCircle } from '@/icons';
import type { SettingsEntry, SettingsGroup } from './types';
import { PreferencesPanel } from './panels/PreferencesPanel';
import { ProfilePanel } from './panels/ProfilePanel';

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
];

/** Flat lookup for panels; the nav keeps the grouped view. */
export const SETTINGS_ENTRIES: SettingsEntry[] = SETTINGS_GROUPS.flatMap((group) => group.entries);

/** Page shown when settings opens. */
export const DEFAULT_SETTINGS_ENTRY_ID = 'preferences';
