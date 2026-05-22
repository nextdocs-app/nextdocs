import { clearLocalUserData } from '@/lib/idb-isolation.util';
import { indexedDBService } from '@/services/indexed-db.service';

jest.mock('../../../services/indexed-db.service', () => ({
  indexedDBService: {
    clearAllDocuments: jest.fn(),
    wipeDatabase: jest.fn(),
    isAvailable: jest.fn().mockReturnValue(true),
    getUserId: jest.fn().mockReturnValue('user-1'),
    setUserId: jest.fn(),
  },
}));

const mockClearAllDocuments = indexedDBService.clearAllDocuments as jest.MockedFunction<
  typeof indexedDBService.clearAllDocuments
>;
const mockWipeDatabase = indexedDBService.wipeDatabase as jest.MockedFunction<
  typeof indexedDBService.wipeDatabase
>;
const mockIsAvailable = indexedDBService.isAvailable as jest.MockedFunction<
  typeof indexedDBService.isAvailable
>;
const mockGetUserId = indexedDBService.getUserId as jest.MockedFunction<
  typeof indexedDBService.getUserId
>;

describe('clearLocalUserData', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAvailable.mockReturnValue(true);
    mockGetUserId.mockReturnValue('user-1');
    mockClearAllDocuments.mockReset(); // Use Reset to clear return values too
    mockWipeDatabase.mockReset();
    mockClearAllDocuments.mockResolvedValue(undefined);
    mockWipeDatabase.mockResolvedValue(undefined);

    // Seed localStorage with a mix of nextdocs and foreign keys
    localStorage.setItem('nextdocs:pending-sync:doc-abc', '3');
    localStorage.setItem('nextdocs:document-access:doc-abc', 'EDIT');
    localStorage.setItem('nextdocs:document-access:doc-xyz', 'VIEW');
    localStorage.setItem('other-app:unrelated-key', 'keep-me');
    localStorage.setItem('just-a-random-key', 'keep-me-too');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('clears the IndexedDB document store', async () => {
    mockClearAllDocuments.mockResolvedValue();
    await clearLocalUserData();
    expect(mockClearAllDocuments).toHaveBeenCalledTimes(1);
  });

  it('removes all keys with the nextdocs: prefix from localStorage', async () => {
    mockClearAllDocuments.mockResolvedValue();
    await clearLocalUserData();

    expect(localStorage.getItem('nextdocs:pending-sync:doc-abc')).toBeNull();
    expect(localStorage.getItem('nextdocs:document-access:doc-abc')).toBeNull();
    expect(localStorage.getItem('nextdocs:document-access:doc-xyz')).toBeNull();
  });

  it('does not remove unrelated localStorage keys', async () => {
    mockClearAllDocuments.mockResolvedValue();
    await clearLocalUserData();

    expect(localStorage.getItem('other-app:unrelated-key')).toBe('keep-me');
    expect(localStorage.getItem('just-a-random-key')).toBe('keep-me-too');
  });

  it('skips IDB clearing if IndexedDB is not available', async () => {
    mockIsAvailable.mockReturnValue(false);
    await clearLocalUserData();
    expect(mockClearAllDocuments).not.toHaveBeenCalled();
    expect(mockWipeDatabase).not.toHaveBeenCalled();
  });

  it('does not clear guest documents when there is no authenticated user context', async () => {
    mockGetUserId.mockReturnValue(null);

    await clearLocalUserData();

    expect(mockClearAllDocuments).not.toHaveBeenCalled();
    expect(mockWipeDatabase).not.toHaveBeenCalled();
  });

  it('falls back to wipeDatabase if clearAllDocuments rejects', async () => {
    mockClearAllDocuments.mockRejectedValue(new Error('QuotaExceededError'));
    mockWipeDatabase.mockResolvedValue();

    await clearLocalUserData();

    expect(mockClearAllDocuments).toHaveBeenCalledTimes(1);
    expect(mockWipeDatabase).toHaveBeenCalledTimes(1);
  });

  it('completes successfully even when both clear and wipe reject (best-effort)', async () => {
    mockClearAllDocuments.mockRejectedValue(new Error('QuotaExceededError'));
    mockWipeDatabase.mockRejectedValue(new Error('Wipe failed'));

    // Suppress expected warning noise in test logs
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(clearLocalUserData()).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Critical: Failed to clear IndexedDB documents'),
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });

  it('still clears localStorage keys even when all IDB calls fail', async () => {
    mockClearAllDocuments.mockRejectedValue(new Error('IDB unavailable'));
    mockWipeDatabase.mockRejectedValue(new Error('Fallback failed'));
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    await clearLocalUserData();

    expect(localStorage.getItem('nextdocs:pending-sync:doc-abc')).toBeNull();
    expect(localStorage.getItem('nextdocs:document-access:doc-abc')).toBeNull();

    (console.warn as jest.Mock).mockRestore();
  });

  it('is a no-op for localStorage when there are no nextdocs: keys', async () => {
    mockClearAllDocuments.mockResolvedValue();
    localStorage.clear();
    localStorage.setItem('some-other-key', 'value');

    await clearLocalUserData();

    expect(localStorage.getItem('some-other-key')).toBe('value');
  });
});
