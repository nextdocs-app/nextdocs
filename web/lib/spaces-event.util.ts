/**
 * Fired in-tab when a settings mutation changes which spaces the caller sees
 * (create, rename, archive, restore, delete). The sidebar renders its own copy
 * of that list, so it listens instead of growing a second spaces store.
 * Cross-tab sync is deliberately out of scope; the next fetch reconciles other
 * tabs.
 */
export const SPACES_UPDATED_EVENT = 'nextdocs:spaces-updated';

export function dispatchSpacesUpdated(): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(SPACES_UPDATED_EVENT));
}
