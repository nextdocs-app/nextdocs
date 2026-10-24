'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/useAuth.hook';
import { useNetworkStatus } from '@/hooks/useNetworkStatus.hook';
import { resolveRootDocumentId } from '@/lib/root-document.util';

const OfflineEditor = dynamic(() => import('@/components/editor'), { ssr: false });

export default function RootDocumentResolver() {
  const router = useRouter();
  const { user, isAuthenticated, accessToken, isInitializing } = useAuth();
  const { isOnline } = useNetworkStatus();
  const hasResolvedRef = useRef(false);
  const [offlineDocumentId, setOfflineDocumentId] = useState<string | null>(null);
  // A failed resolution used to fall back to the loading state with nothing to
  // retry it, so the shell spun forever. Hold the failure until the user (or a
  // reconnect) asks again.
  const [resolveFailed, setResolveFailed] = useState(false);
  const [retryTrigger, setRetryTrigger] = useState(0);

  useEffect(() => {
    if (isInitializing || !isAuthenticated || !accessToken || hasResolvedRef.current) {
      return;
    }

    setResolveFailed(false);

    let cancelled = false;
    let settled = false;
    hasResolvedRef.current = true;

    const run = async () => {
      try {
        const documentId = await resolveRootDocumentId({
          isAuthenticated,
          accessToken,
          userId: user?.id ?? null,
        });
        if (documentId && !cancelled) {
          // A router navigation fetches an RSC payload that an offline cold
          // load never cached. Open the local copy in place, as the sidebar
          // does when a document is created offline.
          if (isOnline) {
            router.replace(`/doc/${documentId}`);
          } else {
            setOfflineDocumentId(documentId);
          }
        }
      } catch (error) {
        console.error('Failed to resolve root document:', error);
        if (!cancelled) {
          hasResolvedRef.current = false;
          setResolveFailed(true);
        }
      } finally {
        settled = true;
      }
    };

    void run();

    return () => {
      cancelled = true;
      // A dependency change cancels the in-flight resolution; let the next
      // effect run instead of leaving the loading state stuck.
      if (!settled) {
        hasResolvedRef.current = false;
      }
    };
  }, [isInitializing, isAuthenticated, accessToken, user?.id, router, isOnline, retryTrigger]);

  // The workspace entry only mounts this resolver once a session exists, so a
  // guest never reaches it. Keep the loading shell while the token refresh
  // settles, matching what the server rendered.
  if (isInitializing) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading document...</div>
      </div>
    );
  }

  if (resolveFailed) {
    return (
      <div className="flex h-full items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <h1 className="text-xl font-semibold text-foreground">Unable to open your workspace</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The server did not respond as expected. Check your connection and try again.
          </p>
          <button
            type="button"
            onClick={() => setRetryTrigger((value) => value + 1)}
            className="mt-5 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (offlineDocumentId) {
    return <OfflineEditor documentId={offlineDocumentId} />;
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-sm text-muted-foreground">Loading document...</div>
    </div>
  );
}
