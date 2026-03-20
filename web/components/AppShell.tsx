'use client';

import { useEffect, useState } from 'react';
import { Suspense } from 'react';
import Sidebar from '@/components/Sidebar';
import { AuthModal } from '@/components/AuthModal';
import { useAppDispatch } from '@/stores/hooks';
import { refreshSessionThunk } from '@/stores/auth/auth.slice';
import { useAuth } from '@/hooks/useAuth.hook';

export function AppShell({ children }: { children: React.ReactNode }) {
  const dispatch = useAppDispatch();
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const { isTokenExpiringSoon } = useAuth();

  // Run exactly once on mount to restore session from the refresh-token cookie
  useEffect(() => {
    dispatch(refreshSessionThunk());
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh token just before it expires to prevent UX drops
  useEffect(() => {
    if (isTokenExpiringSoon) {
      dispatch(refreshSessionThunk());
    }
  }, [isTokenExpiringSoon, dispatch]);

  return (
    <div className="flex h-screen">
      <Sidebar onOpenAuth={() => setIsAuthOpen(true)} />
      <main className="flex-1 overflow-auto bg-background text-foreground">
        <div className="max-w-4xl mx-auto py-8 px-4">
          <Suspense>{children}</Suspense>
        </div>
      </main>
      {isAuthOpen && <AuthModal onClose={() => setIsAuthOpen(false)} />}
    </div>
  );
}
