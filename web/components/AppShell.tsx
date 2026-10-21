'use client';

import { Suspense, useEffect } from 'react';
import Sidebar from '@/components/sidebar';
import { AuthModal } from '@/components/AuthModal';
import { ToastContainer } from '@/components/ToastContainer';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { refreshSessionThunk } from '@/stores/auth/auth.slice';
import { setAuthModalOpen } from '@/stores/ui/ui.slice';
import { setMobileNavOpen } from '@/stores/sidebar/sidebar.slice';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { useAuth } from '@/hooks/useAuth.hook';
import { usePendingCloudDocumentCreates } from '@/hooks/usePendingCloudDocumentCreates.hook';
import { PENDING_DOCUMENT_DISCARDED_EVENT } from '@/lib/pending-cloud-create.util';
import { addToast } from '@/stores/toasts/toasts.slice';

export function AppShell({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const isAuthOpen = useAppSelector((state) => state.ui.isAuthModalOpen);
  const isMobileNavOpen = useAppSelector((state) => state.sidebar.isMobileNavOpen);
  const isMobileLayout = useIsMobileLayout();

  const { user, isTokenExpiringSoon, accessToken } = useAuth();
  usePendingCloudDocumentCreates(user?.id ?? null, accessToken);

  // Lock the page behind the drawer so the document cannot scroll under it.
  useEffect(() => {
    const shouldLock = isMobileLayout && isMobileNavOpen;
    document.body.classList.toggle('nd-mobile-nav-open', shouldLock);

    return () => document.body.classList.remove('nd-mobile-nav-open');
  }, [isMobileLayout, isMobileNavOpen]);

  // A discard the user did not ask for deletes a page they wrote. The row
  // disappearing is the symptom; saying why turns it from a bug into an answer.
  useEffect(() => {
    const handleDiscarded = (event: Event) => {
      const detail = (event as CustomEvent<{ announce?: boolean } | undefined>).detail;
      if (!detail?.announce) {
        return;
      }

      dispatch(
        addToast({
          type: 'error',
          message:
            'A page created offline could not be saved to your account and was removed from this device.',
        })
      );
    };

    window.addEventListener(PENDING_DOCUMENT_DISCARDED_EVENT, handleDiscarded);
    return () => window.removeEventListener(PENDING_DOCUMENT_DISCARDED_EVENT, handleDiscarded);
  }, [dispatch]);

  // Run exactly once on mount to restore session from the refresh-token cookie
  useEffect(() => {
    dispatch(refreshSessionThunk());

    const handleOpenAuth = () => dispatch(setAuthModalOpen(true));
    window.addEventListener('open-auth-modal', handleOpenAuth);
    return () => window.removeEventListener('open-auth-modal', handleOpenAuth);
  }, [dispatch]);

  // Auto-refresh token just before it expires to prevent UX drops
  useEffect(() => {
    if (isTokenExpiringSoon) {
      dispatch(refreshSessionThunk());
    }
  }, [isTokenExpiringSoon, dispatch]);

  return (
    // `h-dvh` rather than `h-screen`: mobile browsers shrink the visual viewport
    // as the address bar and the on-screen keyboard appear.
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      {isMobileLayout && isMobileNavOpen && (
        <button
          type="button"
          className="nd-mobile-nav-backdrop"
          aria-label="Close navigation"
          onClick={() => dispatch(setMobileNavOpen(false))}
        />
      )}
      <main className="nd-app-shell-main flex-1 flex flex-col min-w-0 bg-background text-foreground relative overflow-hidden">
        {/* By using a nested flex-1 overflow-y-auto child, we are effectively telling
        the browser that the scrollable region starts below the toolbar's height.*/}
        <div className="h-12 w-full shrink-0 z-30 pointer-events-none" aria-hidden="true" />
        <div className="flex-1 overflow-y-auto overflow-x-clip overscroll-contain w-full">
          {/*
            No global max-w here: each route centers its own column
            (DocumentPageHeader + EditorContent both use max-w-4xl with the
            same px, so header and editor stay aligned). A shell-level wrapper
            would double-constrain the cover banner, which must bleed full width.
          */}
          <Suspense>{children}</Suspense>
        </div>
      </main>
      {isAuthOpen && <AuthModal onClose={() => dispatch(setAuthModalOpen(false))} />}
      <ToastContainer />
    </div>
  );
}
