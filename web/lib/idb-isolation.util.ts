import { indexedDBService } from '@/services/indexed-db.service';

const NEXTDOCS_LOCALSTORAGE_PREFIX = 'nextdocs:';

function clearNextdocsLocalStorageKeys(): void {
  if (typeof window === 'undefined') {
    return;
  }

  const keysToRemove: string[] = [];

  for (let i = 0; i < window.localStorage.length; i++) {
    const key = window.localStorage.key(i);
    if (key && key.startsWith(NEXTDOCS_LOCALSTORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    window.localStorage.removeItem(key);
  }
}

// Even if we are not clearing the data, one user's data won't be visible to another
// user because of the unique database name per user. This is just an extra cleanup
// step to free up space and avoid confusion.
export async function clearLocalUserData(): Promise<void> {
  if (indexedDBService.isAvailable()) {
    try {
      await indexedDBService.clearAllDocuments();
    } catch {
      try {
        await indexedDBService.wipeDatabase();
      } catch (wipeErr) {
        console.warn(
          '[idb-isolation] Critical: Failed to clear IndexedDB documents even with wipe fallback:',
          wipeErr
        );
      }
    }
  }

  clearNextdocsLocalStorageKeys();
}
