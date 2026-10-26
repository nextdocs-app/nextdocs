'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuth.hook';
import { workspaceApiService } from '@/services/workspace.service';
import type { Workspace } from '@/types/workspace.types';

const WORKSPACE_CACHE_KEY = 'nextdocs.workspace.current';

interface CachedWorkspace {
  userId: string;
  workspace: Workspace;
}

function readCachedWorkspace(userId: string | null): Workspace | null {
  if (typeof window === 'undefined' || !userId) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(WORKSPACE_CACHE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<CachedWorkspace>;
    return parsed.userId === userId && parsed.workspace ? parsed.workspace : null;
  } catch {
    return null;
  }
}

function cacheWorkspace(userId: string, workspace: Workspace): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify({ userId, workspace }));
}

/**
 * The signed-in member's workspace identity for chrome that labels the rail.
 *
 * The last identity is cached per user so an offline reload keeps the real
 * workspace name instead of flashing the neutral placeholder. Null while
 * loading, for guests, and when the probe fails.
 */
export function useWorkspace(): Workspace | null {
  const { isAuthenticated, accessToken, user } = useAuth();
  const userId = user?.id ?? null;
  const [loaded, setLoaded] = useState<{ userId: string | null; workspace: Workspace } | null>(
    () => {
      const cached = readCachedWorkspace(userId);
      return cached ? { userId, workspace: cached } : null;
    }
  );

  useEffect(() => {
    if (!isAuthenticated || !accessToken) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    workspaceApiService
      .getCurrent(accessToken, controller.signal)
      .then((next) => {
        if (cancelled) {
          return;
        }

        setLoaded({ userId, workspace: next });
        if (userId) {
          cacheWorkspace(userId, next);
        }
      })
      .catch(() => {
        // Keep the neutral placeholder rather than surfacing a chrome failure.
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [isAuthenticated, accessToken, userId]);

  // Tagging the value by user hides the previous account's identity during an
  // account switch, and a signed-out session shows no identity at all.
  const workspace = loaded && loaded.userId === userId ? loaded.workspace : null;
  return isAuthenticated && accessToken ? workspace : null;
}
