import type { ComponentType } from 'react';
import type { IconProps } from '@/icons';

/**
 * Every settings page. The store opens one by id; typing it here keeps a
 * mistyped or renamed page from silently falling back to the first entry.
 */
export type SettingsEntryId =
  'profile' | 'preferences' | 'workspace-general' | 'workspace-people' | 'workspace-spaces';

/** One settings page: a nav entry plus the panel it renders. */
export interface SettingsEntry {
  /** Stable id used for the nav selection; unique across all groups. */
  id: SettingsEntryId;
  label: string;
  /** Shown under the page title in the content header. */
  description: string;
  icon: ComponentType<IconProps>;
  Panel: ComponentType;
  /**
   * Hidden from guests. Panels can still render a signed-out state as a
   * fallback, but an entry nobody can use should not appear in the nav.
   */
  requiresAuth?: boolean;
}

/** A labeled cluster of entries in the settings navigation. */
export interface SettingsGroup {
  id: string;
  label: string;
  entries: SettingsEntry[];
}
