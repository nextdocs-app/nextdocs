'use client';

import { Suspense, useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/sidebar';
import { ToastContainer } from '@/components/ToastContainer';
import { WorkspaceEntry } from '@/components/WorkspaceEntry';
import { Hamburger } from '@/icons';
import { useAppDispatch, useAppSelector } from '@/stores/hooks';
import { refreshSessionThunk, SILENT_REFRESH_MIN_INTERVAL_MS } from '@/stores/auth/auth.slice';
import { setCollapsed, setMobileNavOpen, toggleMobileNav } from '@/stores/sidebar/sidebar.slice';
import { useIsMobileLayout } from '@/hooks/useMediaQuery.hook';
import { useAuth } from '@/hooks/useAuth.hook';
import { usePendingCloudDocumentCreates } from '@/hooks/usePendingCloudDocumentCreates.hook';
import { PENDING_DOCUMENT_DISCARDED_EVENT } from '@/lib/pending-cloud-create.util';
import { addToast } from '@/stores/toasts/toasts.slice';

const emptySubscribe = () => () => {};

/** Publish the scrollport's per-edge gutter for full-bleed surfaces. */
function syncScrollbarGutter(node: HTMLDivElement | null) {
  if (
    !node ||
    typeof CSS === 'undefined' ||
    typeof CSS.supports !== 'function' ||
    !CSS.supports('scrollbar-gutter', 'stable both-edges')
  ) {
    return;
  }

  const gutter = Math.max(0, (node.offsetWidth - node.clientWidth) / 2);
  node.style.setProperty('--nd-scrollbar-gutter', `${gutter}px`);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const pathname = usePathname();
  const router = useRouter();
  const isMobileNavOpen = useAppSelector((state) => state.sidebar.isMobileNavOpen);
  const isSidebarCollapsed = useAppSelector((state) => state.sidebar.isCollapsed);
  const isMobileLayout = useIsMobileLayout();
  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const setScroller = useCallback((node: HTMLDivElement | null) => {
    scrollerRef.current = node;
    // Ref callbacks run before paint, so the cover never widens a frame late.
    syncScrollbarGutter(node);
  }, []);

  const { user, isTokenExpiringSoon, accessToken, isInitializing, isAuthenticated } = useAuth();
  usePendingCloudDocumentCreates(user?.id ?? null, accessToken);

  // Lock the page behind the drawer so the document cannot scroll under it.
  useEffect(() => {
    const shouldLock = isMobileLayout && isMobileNavOpen;
    document.body.classList.toggle('nd-mobile-nav-open', shouldLock);

    return () => document.body.classList.remove('nd-mobile-nav-open');
  }, [isMobileLayout, isMobileNavOpen]);

  // `scrollbar-gutter: stable both-edges` keeps the centered page column on the
  // scrollport's center line. It also narrows the content box on both sides, so
  // publish the per-edge gutter for full-bleed surfaces (the page cover) to
  // paint into. `offsetWidth - clientWidth` is both edges' worth of gutter;
  // overlay scrollbars and unsupporting browsers report zero.
  useEffect(() => {
    const syncGutter = () => syncScrollbarGutter(scrollerRef.current);
    window.addEventListener('resize', syncGutter);
    return () => window.removeEventListener('resize', syncGutter);
  }, []);

  // A discard the user did not ask for deletes a page they wrote. The row
  // disappearing is the symptom; saying why turns it from a bug into an answer.
  useEffect(() => {
    const handleDiscarded = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; announce?: boolean } | undefined>).detail;
      if (!detail?.announce) {
        return;
      }

      // The editor keeps its in-memory Y.Doc after the local copy is gone, so
      // leave the deleted page instead of letting further typing vanish.
      if (detail.id && pathname === `/doc/${detail.id}`) {
        router.replace('/');
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
  }, [dispatch, pathname, router]);

  // Run exactly once on mount to restore session from the refresh-token cookie
  useEffect(() => {
    dispatch(refreshSessionThunk());
  }, [dispatch]);

  // Auto-refresh token just before it expires to prevent UX drops. A failed
  // attempt clears the thunk's throttle stamp, so keep retrying while the
  // token is still expiring instead of waiting for the next API 401.
  useEffect(() => {
    if (!isTokenExpiringSoon) {
      return;
    }

    dispatch(refreshSessionThunk());
    const retry = setInterval(
      () => dispatch(refreshSessionThunk()),
      SILENT_REFRESH_MIN_INTERVAL_MS
    );
    return () => clearInterval(retry);
  }, [isTokenExpiringSoon, dispatch]);

  // `/` is the workspace entry: until the refresh settles, and for guests, it
  // must not mount the sidebar or document surfaces. The client snapshot keeps
  // a persisted session from changing the tree mid-hydration.
  const isWorkspaceEntry = pathname === '/' && (!isHydrated || isInitializing || !isAuthenticated);

  if (isWorkspaceEntry) {
    return <WorkspaceEntry />;
  }

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
        {/* Shell-level so a collapsed rail is still reachable on routes that
            render no document toolbar (loading and error screens). */}
        {(isMobileLayout || isSidebarCollapsed) && (
          <button
            type="button"
            onClick={() => {
              if (isMobileLayout) {
                dispatch(toggleMobileNav());
                return;
              }
              dispatch(setCollapsed(false));
            }}
            aria-label={isMobileLayout ? 'Open navigation' : 'Open sidebar'}
            aria-haspopup={isMobileLayout ? 'dialog' : undefined}
            aria-expanded={isMobileLayout ? isMobileNavOpen : false}
            title={isMobileLayout ? 'Open navigation' : 'Open sidebar'}
            className="
              fixed top-2 z-40 inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-sm
              md:h-7 md:w-7
              text-muted-foreground hover:text-foreground hover:bg-[var(--nd-toolbar-hover-bg)]
              transition-colors duration-150 cursor-pointer
              focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring
            "
            style={{ left: 'calc(0.5rem + env(safe-area-inset-left, 0px))' }}
          >
            <Hamburger size={19} />
          </button>
        )}
        {/* By using a nested flex-1 overflow-y-auto child, we are effectively telling
        the browser that the scrollable region starts below the toolbar's height.*/}
        <div className="h-12 w-full shrink-0 z-30 pointer-events-none" aria-hidden="true" />
        <div
          ref={setScroller}
          className="nd-app-scroll flex-1 overflow-y-auto overflow-x-clip overscroll-contain w-full"
        >
          {/*
            No global max-w here: each route centers its own column
            (DocumentPageHeader + EditorContent both use max-w-4xl with the
            same px, so header and editor stay aligned). A shell-level wrapper
            would double-constrain the cover banner, which must bleed full width.
          */}
          <Suspense>{children}</Suspense>
        </div>
      </main>
      <ToastContainer />
    </div>
  );
}
