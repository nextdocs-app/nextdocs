'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useLocalDocuments } from '@/hooks/useLocalDocuments.hook';
import { documentService } from '@/services/document.service';
import { NewDocument, Search, ChevronRight, DocumentText, Settings, Login } from '@/icons';
import { SettingsModal } from '@/components/SettingsModal';
import { useTheme } from '@/hooks/useTheme.hook';
import { useAuth } from '@/hooks/useAuth.hook';

const emptySubscribe = () => () => {};

export default function Sidebar({ onOpenAuth }: { onOpenAuth: () => void }) {
  const router = useRouter();
  const params = useParams();
  const activeDocId = (params?.id as string) || 'default-doc';
  const { documents, isLoading, refresh } = useLocalDocuments();
  const { resolvedTheme } = useTheme();
  const { user, isAuthenticated, logout } = useAuth();
  const userInitial =
    user?.displayName?.trim()?.charAt(0)?.toUpperCase() ||
    user?.email?.charAt(0)?.toUpperCase() ||
    'U';

  const [isPrivateOpen, setIsPrivateOpen] = useState(true);
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);

  // Use useSyncExternalStore to safely detect if we are on the client
  // without triggering "cascading render" lint errors or hydration mismatches.
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const handleCreateFile = useCallback(async () => {
    try {
      const newId = crypto.randomUUID();
      const { ydoc, meta } = await documentService.createDocument();
      await documentService.saveDocument(newId, ydoc, meta);
      await refresh(false);
      router.push(`/doc/${newId}`);
    } catch (error) {
      console.error('Failed to create document:', error);
      // TODO: Replace alert with a non-blocking notification system (e.g., toast)
      alert('Failed to create document. Please try again.');
    }
  }, [router, refresh]);

  const handleSelectDocument = useCallback(
    (id: string) => {
      if (id === 'default-doc') {
        router.push('/');
      } else {
        router.push(`/doc/${id}`);
      }
    },
    [router]
  );

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return;
    }

    const handleOutsideClick = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAccountMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAccountMenuOpen]);

  if (!isClient) {
    return <aside className="w-64 border-r flex-shrink-0 bg-sidebar" />;
  }

  return (
    <aside className="w-64 border-r flex-shrink-0 flex flex-col overflow-hidden bg-sidebar text-sidebar-foreground border-border select-none">
      {/* Top actions */}
      <div className="flex flex-col gap-0.5 px-2 pt-3 pb-1">
        {/* New Document */}
        <button
          onClick={handleCreateFile}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                     text-sidebar-foreground hover:bg-sidebar-accent
                     transition-colors duration-100 cursor-pointer"
        >
          <NewDocument className="flex-shrink-0 opacity-80" />
          <span className="text-[14px]">New document</span>
        </button>

        {/* Search Documents (TODO: currently placeholder) */}
        <button
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                     text-sidebar-foreground hover:bg-sidebar-accent
                     transition-colors duration-100 cursor-pointer"
        >
          <Search className="flex-shrink-0 opacity-80" />
          <span className="text-[14px]">Search documents</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto flex flex-col">
        {/* Private section — collapsible */}
        <div className="group flex flex-col">
          <button
            onClick={() => setIsPrivateOpen((prev) => !prev)}
            aria-expanded={isPrivateOpen}
            className="flex items-center gap-1 px-4 py-2 text-left
                       text-[13px] text-muted-foreground cursor-pointer"
          >
            <span className="font-medium">Private</span>
            <ChevronRight
              className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 ${isPrivateOpen ? 'rotate-90' : 'rotate-0'}`}
            />
          </button>

          {isPrivateOpen && (
            <nav className="px-2 pb-2">
              {isLoading ? (
                <div className="flex flex-col gap-0.5 px-1">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-8 rounded-lg bg-sidebar-accent/30 animate-pulse" />
                  ))}
                </div>
              ) : documents.length === 0 ? (
                <div className="px-3 pt-1">
                  <p className="text-[13px] text-muted-foreground/50">No documents yet</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-px">
                  {documents.map((doc) => {
                    const isActive = doc.id === activeDocId;
                    return (
                      <li key={doc.id}>
                        <button
                          onClick={() => handleSelectDocument(doc.id)}
                          className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left
                            transition-colors duration-100 cursor-pointer
                            ${
                              isActive
                                ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent text-sidebar-accent-foreground'
                                : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground'
                            }`}
                        >
                          <DocumentText className="flex-shrink-0 opacity-50" />
                          <span className="text-[13px] truncate">
                            {doc.meta.title || 'Untitled'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </nav>
          )}
        </div>

        <div
          className="relative mt-auto sticky bottom-0 border-t border-border bg-sidebar p-2"
          ref={accountMenuRef}
        >
          {isAccountMenuOpen && (
            <div
              className={`absolute bottom-[calc(100%+0.35rem)] left-2 right-2 z-20 rounded-xl border border-sidebar-border
                       p-1.5 shadow-lg ${
                         resolvedTheme === 'dark'
                           ? 'bg-[#303030] text-white'
                           : 'bg-popover text-popover-foreground'
                       }`}
              role="menu"
              aria-label="Account options"
            >
              <button
                className={`w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors cursor-pointer flex items-center gap-2 ${
                  resolvedTheme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-foreground/[0.07]'
                }`}
                role="menuitem"
                onClick={() => {
                  setIsAccountMenuOpen(false);
                  setIsSettingsOpen(true);
                }}
              >
                <Settings className="flex-shrink-0 opacity-90" />
                Settings
              </button>
              {isAuthenticated ? (
                <button
                  className={`w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors cursor-pointer flex items-center gap-2 ${
                    resolvedTheme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-foreground/[0.07]'
                  }`}
                  role="menuitem"
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    logout();
                  }}
                >
                  <Login className="flex-shrink-0 opacity-90" />
                  Log out
                </button>
              ) : (
                <button
                  className={`w-full rounded-lg px-3 py-2 text-left text-[13px] transition-colors cursor-pointer flex items-center gap-2 ${
                    resolvedTheme === 'dark' ? 'hover:bg-white/10' : 'hover:bg-foreground/[0.07]'
                  }`}
                  role="menuitem"
                  onClick={() => {
                    setIsAccountMenuOpen(false);
                    onOpenAuth();
                  }}
                >
                  <Login className="flex-shrink-0 opacity-90" />
                  Log in
                </button>
              )}
            </div>
          )}

          <button
            onClick={() => setIsAccountMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={isAccountMenuOpen}
            className="w-full rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-sidebar-accent cursor-pointer
                     flex items-center justify-between gap-2"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden="true"
                className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-sidebar-accent text-sidebar-foreground/70 flex-shrink-0"
              >
                {isAuthenticated && user ? (
                  <span className="text-[11px] font-semibold leading-none select-none">
                    {userInitial}
                  </span>
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                  >
                    <circle cx="12" cy="8" r="3.25" />
                    <path d="M5.5 18.25a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
                  </svg>
                )}
              </span>
              <span className="truncate text-[14px]">
                {isAuthenticated && user ? user.displayName : 'Guest User'}
              </span>
            </span>
            <ChevronRight
              className={`flex-shrink-0 opacity-70 transition-transform duration-150 ${
                isAccountMenuOpen ? '-rotate-90' : 'rotate-90'
              }`}
            />
          </button>
        </div>
      </div>
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </aside>
  );
}
