'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth.hook';
import { resolveRootDocumentId } from '@/lib/root-document.util';

export default function RootDocumentResolver() {
  const router = useRouter();
  const { isAuthenticated, accessToken, isInitializing } = useAuth();
  const hasResolvedRef = useRef(false);

  useEffect(() => {
    if (isInitializing || hasResolvedRef.current) {
      return;
    }

    let cancelled = false;
    hasResolvedRef.current = true;

    const run = async () => {
      try {
        const documentId = await resolveRootDocumentId({ isAuthenticated, accessToken });
        if (!cancelled) {
          router.replace(`/doc/${documentId}`);
        }
      } catch (error) {
        console.error('Failed to resolve root document:', error);
        if (!cancelled) {
          hasResolvedRef.current = false;
        }
      }
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [isInitializing, isAuthenticated, accessToken, router]);

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-sm text-muted-foreground">Loading document...</div>
    </div>
  );
}
