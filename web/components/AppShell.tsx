'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Suspense } from 'react';
import Sidebar from '@/components/Sidebar';
import { AuthModal } from '@/components/AuthModal';
import { LocalDocsPromotionModal } from '@/components/LocalDocsPromotionModal';
import { RegistrationSyncOverlay } from '@/components/RegistrationSyncOverlay';
import { useAppDispatch } from '@/stores/hooks';
import { refreshSessionThunk } from '@/stores/auth/auth.slice';
import { useAuth } from '@/hooks/useAuth.hook';
import { documentService } from '@/services/document.service';
import { isUntitledTitle, isEmptyLocalDocument } from '@/lib/document-content.util';
import type { StoredDocument } from '@/types/document.types';

const LOCAL_IMPORT_LOCK_KEY = 'nextdocs-local-import-lock';
const REGISTRATION_SYNC_MIN_OVERLAY_MS = 800;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForNextPaint(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined') {
      resolve();
      return;
    }

    window.requestAnimationFrame(() => resolve());
  });
}

function tryAcquireImportLock(): boolean {
  const now = Date.now();
  const raw = localStorage.getItem(LOCAL_IMPORT_LOCK_KEY);
  const lockAgeMs = 30_000;

  if (raw) {
    const existing = Number(raw);
    if (Number.isFinite(existing) && now - existing < lockAgeMs) {
      return false;
    }
  }

  localStorage.setItem(LOCAL_IMPORT_LOCK_KEY, String(now));
  return true;
}

function releaseImportLock() {
  localStorage.removeItem(LOCAL_IMPORT_LOCK_KEY);
}

export function getDocsEligibleForAccountMove(docs: StoredDocument[]): StoredDocument[] {
  return docs.filter((doc) => !(isUntitledTitle(doc.meta.title) && isEmptyLocalDocument(doc)));
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isLocalDocsModalOpen, setIsLocalDocsModalOpen] = useState(false);
  const [localDocsToPromote, setLocalDocsToPromote] = useState<StoredDocument[]>([]);
  const [isImportingLocalDocs, setIsImportingLocalDocs] = useState(false);
  const [localDocsError, setLocalDocsError] = useState<string | null>(null);
  const [isRegistrationSyncOverlayOpen, setIsRegistrationSyncOverlayOpen] = useState(false);
  const openAuthModal = useCallback(() => {
    setIsAuthOpen(true);
  }, []);
  const { user, isTokenExpiringSoon, isAuthenticated, accessToken, lastAuthAction } = useAuth();
  const didPromptImportRef = useRef(false);
  const ownsLocalImportLockRef = useRef(false);
  const bulkImportInFlightRef = useRef<Promise<void> | null>(null);
  const bulkImportCompletedKeyRef = useRef<string | null>(null);

  const getBulkImportActionKey = useCallback(() => {
    if (!user?.id || !lastAuthAction) {
      return null;
    }

    return `${user.id}:${lastAuthAction}`;
  }, [user?.id, lastAuthAction]);

  const moveLocalDocsToAccount = useCallback(
    async (docs: StoredDocument[]) => {
      const actionKey = getBulkImportActionKey();

      if (actionKey && bulkImportCompletedKeyRef.current === actionKey) {
        return;
      }

      if (bulkImportInFlightRef.current) {
        await bulkImportInFlightRef.current;
        return;
      }

      const run = (async () => {
        if (!accessToken) {
          throw new Error('Missing access token');
        }

        const imported = await documentService.bulkImportLocalDocuments(accessToken, docs);
        const importedIds = new Set(
          imported.imported
            .map((item) => item.localId)
            .filter((id): id is string => typeof id === 'string' && id.length > 0)
        );

        const allDocsConfirmed = docs.every((doc) => importedIds.has(doc.id));
        if (!allDocsConfirmed) {
          throw new Error('Backend did not confirm all local documents were persisted.');
        }

        // Delete local docs only after backend confirms all were imported.
        await documentService.deleteGuestDocumentsByIds(docs.map((doc) => doc.id));

        if (actionKey) {
          bulkImportCompletedKeyRef.current = actionKey;
        }
      })();

      bulkImportInFlightRef.current = run;

      try {
        await run;
      } finally {
        bulkImportInFlightRef.current = null;
      }
    },
    [accessToken, getBulkImportActionKey]
  );

  const waitForBulkImportInFlight = useCallback(async () => {
    const inFlight = bulkImportInFlightRef.current;
    if (!inFlight) {
      return;
    }

    try {
      await inFlight;
    } catch {
      // Ignore import failures here; callers only need teardown ordering.
    }
  }, []);

  const releaseImportLockIfOwned = useCallback(() => {
    if (ownsLocalImportLockRef.current) {
      releaseImportLock();
      ownsLocalImportLockRef.current = false;
    }
  }, []);

  const closePromotionFlow = useCallback(() => {
    didPromptImportRef.current = true;
    setIsLocalDocsModalOpen(false);
    setLocalDocsToPromote([]);
    setIsImportingLocalDocs(false);
    setLocalDocsError(null);
    setIsRegistrationSyncOverlayOpen(false);
    releaseImportLockIfOwned();
  }, [releaseImportLockIfOwned]);

  // Run exactly once on mount to restore session from the refresh-token cookie
  useEffect(() => {
    dispatch(refreshSessionThunk());

    const handleOpenAuth = () => setIsAuthOpen(true);
    window.addEventListener('open-auth-modal', handleOpenAuth);
    return () => window.removeEventListener('open-auth-modal', handleOpenAuth);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh token just before it expires to prevent UX drops
  useEffect(() => {
    if (isTokenExpiringSoon) {
      dispatch(refreshSessionThunk());
    }
  }, [isTokenExpiringSoon, dispatch]);

  // Reset the one-shot prompt guard when auth session ends so a future
  // explicit login/register in the same tab can trigger the prompt again.
  useEffect(() => {
    if (isAuthenticated && user?.id) {
      return;
    }

    let isDisposed = false;

    const resetAfterInFlightImport = async () => {
      await waitForBulkImportInFlight();

      if (isDisposed) {
        return;
      }

      didPromptImportRef.current = false;
      bulkImportCompletedKeyRef.current = null;
      bulkImportInFlightRef.current = null;
      releaseImportLockIfOwned();
    };

    void resetAfterInFlightImport();

    return () => {
      isDisposed = true;
    };
  }, [isAuthenticated, user?.id, waitForBulkImportInFlight, releaseImportLockIfOwned]);

  // Prompt once per app load after login to promote local docs into account.
  useEffect(() => {
    const isRegistrationFlow = lastAuthAction === 'register';
    const isLoginFlow = lastAuthAction === 'login';

    if (
      !isAuthenticated ||
      !accessToken ||
      !user?.id ||
      didPromptImportRef.current ||
      (!isRegistrationFlow && !isLoginFlow)
    ) {
      return;
    }

    if (!tryAcquireImportLock()) {
      return;
    }

    ownsLocalImportLockRef.current = true;

    let cancelled = false;

    const run = async () => {
      try {
        const localDocs = await documentService.getAllGuestDocuments();
        const promotableLocalDocs = getDocsEligibleForAccountMove(localDocs);
        const junkDocs = localDocs.filter(
          (doc) => !promotableLocalDocs.some((p) => p.id === doc.id)
        );

        // Immediately clean up junk guest documents (empty untitled docs) to prevent
        // them from haunting the user after they log out later.
        if (junkDocs.length > 0) {
          try {
            await documentService.deleteGuestDocumentsByIds(junkDocs.map((d) => d.id));
          } catch (error) {
            console.warn('[AppShell] Failed to clean up junk guest documents:', error);
          }
        }

        if (cancelled || promotableLocalDocs.length === 0) {
          didPromptImportRef.current = true;
          setIsRegistrationSyncOverlayOpen(false);
          releaseImportLockIfOwned();
          return;
        }

        if (isRegistrationFlow) {
          setLocalDocsToPromote(promotableLocalDocs);
          setIsRegistrationSyncOverlayOpen(true);
          setIsImportingLocalDocs(true);
          setLocalDocsError(null);

          await waitForNextPaint();
          const syncStartedAt = Date.now();

          await moveLocalDocsToAccount(promotableLocalDocs);

          const elapsed = Date.now() - syncStartedAt;
          if (elapsed < REGISTRATION_SYNC_MIN_OVERLAY_MS) {
            await wait(REGISTRATION_SYNC_MIN_OVERLAY_MS - elapsed);
          }

          closePromotionFlow();
          return;
        }

        setLocalDocsToPromote(promotableLocalDocs);
        setIsLocalDocsModalOpen(true);
      } catch (error) {
        console.error('Failed to import local documents:', error);
        setIsImportingLocalDocs(false);
        setIsRegistrationSyncOverlayOpen(lastAuthAction === 'register');
        setLocalDocsError(
          error instanceof Error ? error.message : 'Failed to import local documents.'
        );

        if (!isRegistrationFlow) {
          releaseImportLockIfOwned();
        }
      }
    };

    void run();

    return () => {
      cancelled = true;

      const releaseLockAfterInFlightImport = async () => {
        await waitForBulkImportInFlight();
        releaseImportLockIfOwned();
      };

      void releaseLockAfterInFlightImport();
    };
  }, [
    isAuthenticated,
    accessToken,
    user?.id,
    lastAuthAction,
    closePromotionFlow,
    moveLocalDocsToAccount,
    releaseImportLockIfOwned,
    waitForBulkImportInFlight,
  ]);

  const runMoveToAccount = useCallback(async () => {
    if (!accessToken || !user?.id || localDocsToPromote.length === 0) {
      return;
    }

    try {
      setIsLocalDocsModalOpen(false);
      setIsRegistrationSyncOverlayOpen(true);
      setIsImportingLocalDocs(true);
      setLocalDocsError(null);

      await waitForNextPaint();
      const syncStartedAt = Date.now();

      await moveLocalDocsToAccount(localDocsToPromote);

      const elapsed = Date.now() - syncStartedAt;
      if (elapsed < REGISTRATION_SYNC_MIN_OVERLAY_MS) {
        await wait(REGISTRATION_SYNC_MIN_OVERLAY_MS - elapsed);
      }

      closePromotionFlow();
    } catch (error) {
      setIsImportingLocalDocs(false);
      setLocalDocsError(
        error instanceof Error ? error.message : 'Failed to import local documents.'
      );
    }
  }, [accessToken, user?.id, localDocsToPromote, moveLocalDocsToAccount, closePromotionFlow]);

  const handleDiscardLocalData = async () => {
    if (localDocsToPromote.length === 0) {
      closePromotionFlow();
      return;
    }

    try {
      setIsImportingLocalDocs(true);
      setLocalDocsError(null);

      await documentService.deleteGuestDocumentsByIds(localDocsToPromote.map((doc) => doc.id));

      closePromotionFlow();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to discard local documents.';
      setLocalDocsError(message);
      setIsImportingLocalDocs(false);
    }
  };

  return (
    <div className="flex h-screen">
      <Sidebar onOpenAuth={openAuthModal} />
      <main className="nd-app-shell-main flex-1 flex flex-col min-w-0 bg-background text-foreground relative overflow-hidden">
        {/* By using a nested flex-1 overflow-y-auto child, we are effectively telling 
        the browser that the scrollable region starts below the toolbar's height.*/}
        <div className="h-14 w-full shrink-0 z-30 pointer-events-none" aria-hidden="true" />
        <div className="flex-1 overflow-y-auto overflow-x-clip w-full">
          <div className="max-w-4xl mx-auto px-4">
            <Suspense>{children}</Suspense>
          </div>
        </div>
      </main>
      {isAuthOpen && <AuthModal onClose={() => setIsAuthOpen(false)} />}
      {isLocalDocsModalOpen && (
        <LocalDocsPromotionModal
          count={localDocsToPromote.length}
          isImporting={isImportingLocalDocs}
          error={localDocsError}
          onMoveToAccount={runMoveToAccount}
          onDiscardLocalData={handleDiscardLocalData}
        />
      )}
      {isRegistrationSyncOverlayOpen && (
        <RegistrationSyncOverlay
          count={localDocsToPromote.length}
          isLoading={isImportingLocalDocs}
          error={localDocsError}
          onRetry={runMoveToAccount}
        />
      )}
    </div>
  );
}
