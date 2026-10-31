/**
 * In-tab request to open a space's settings modal on a specific tab. The share
 * panel lives under DocToolbar and does not own the space modal, so it asks the
 * sidebar (which already mounts SpaceSettingsModal) instead of duplicating it.
 */
export const OPEN_SPACE_SETTINGS_EVENT = 'nextdocs:open-space-settings';

export type SpaceSettingsTab = 'general' | 'members';

export interface OpenSpaceSettingsDetail {
  spaceId: string;
  tab?: SpaceSettingsTab;
}

export function dispatchOpenSpaceSettings(detail: OpenSpaceSettingsDetail): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<OpenSpaceSettingsDetail>(OPEN_SPACE_SETTINGS_EVENT, { detail })
  );
}

/** Reads a dispatched event defensively: listeners also receive foreign events. */
export function parseOpenSpaceSettingsEvent(event: Event): OpenSpaceSettingsDetail | null {
  if (!(event instanceof CustomEvent)) {
    return null;
  }

  const detail = event.detail as Partial<OpenSpaceSettingsDetail> | null | undefined;
  if (!detail || typeof detail.spaceId !== 'string' || detail.spaceId.trim().length === 0) {
    return null;
  }

  return {
    spaceId: detail.spaceId,
    tab: detail.tab === 'members' ? 'members' : 'general',
  };
}
