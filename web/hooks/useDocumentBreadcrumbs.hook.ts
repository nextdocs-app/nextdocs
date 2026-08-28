import { useEffect, useMemo, useState } from 'react';
import { useAppSelector } from '@/stores/hooks';
import { documentService, type DocumentBreadcrumbItem } from '@/services/document.service';
import type { SidebarTreeNode } from '@/types/tree.types';

const EMPTY_NODES: Record<string, SidebarTreeNode> = {};

export function useDocumentBreadcrumbs(
  documentId: string,
  currentTitle?: string,
  currentIcon?: string | null
): {
  breadcrumbs: DocumentBreadcrumbItem[];
  isLoading: boolean;
} {
  const privateNodes: Record<string, SidebarTreeNode> = useAppSelector(
    (state) => state?.sidebarTree?.nodes ?? EMPTY_NODES
  );
  const sharedNodes: Record<string, SidebarTreeNode> = useAppSelector(
    (state) => state?.sharedTree?.nodes ?? EMPTY_NODES
  );
  const accessToken = useAppSelector((state) => state?.auth?.accessToken ?? null);

  const [serverState, setServerState] = useState<{
    documentId: string;
    items: DocumentBreadcrumbItem[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Compute breadcrumbs from local Redux tree nodes (0ms instant render)
  const localBreadcrumbs = useMemo<DocumentBreadcrumbItem[]>(() => {
    if (!documentId) return [];

    const items: DocumentBreadcrumbItem[] = [];
    let currentId: string | null = documentId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node: SidebarTreeNode | undefined = privateNodes[currentId] || sharedNodes[currentId];
      if (!node) {
        break;
      }
      items.push({
        id: node.id,
        title: node.title || 'Untitled',
        // Document icon is reserved for future icon/cover support; title is used for now
        icon: null,
        parentId: node.parentId,
      });
      currentId = node.parentId;
    }

    if (items.length === 0) {
      return [
        {
          id: documentId,
          title: currentTitle || 'Untitled',
          icon: currentIcon ?? null,
          parentId: null,
        },
      ];
    }

    return items.reverse();
  }, [documentId, privateNodes, sharedNodes, currentTitle, currentIcon]);

  // Fetch full path from server to catch any non-loaded ancestor levels
  useEffect(() => {
    if (!documentId || typeof documentService?.getDocumentBreadcrumbs !== 'function') {
      return;
    }

    let isCancelled = false;

    documentService
      .getDocumentBreadcrumbs(documentId, accessToken)
      .then((crumbs) => {
        if (!isCancelled) {
          setServerState({ documentId, items: crumbs || [] });
          setIsLoading(false);
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.warn('Failed to load breadcrumbs for document:', err);
          setServerState({ documentId, items: [] });
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [documentId, accessToken]);

  // Merge and apply reactive live updates to titles
  const breadcrumbs = useMemo<DocumentBreadcrumbItem[]>(() => {
    const serverBreadcrumbs =
      serverState && serverState.documentId === documentId ? serverState.items : [];

    const rawList =
      serverBreadcrumbs.length > 0 &&
      serverBreadcrumbs[serverBreadcrumbs.length - 1]?.id === documentId
        ? serverBreadcrumbs
        : localBreadcrumbs;

    if (rawList.length === 0) {
      return [
        {
          id: documentId,
          title: currentTitle || 'Untitled',
          icon: currentIcon ?? null,
          parentId: null,
        },
      ];
    }

    return rawList.map((item, index) => {
      const isCurrent = index === rawList.length - 1;
      if (isCurrent) {
        return {
          ...item,
          title: currentTitle && currentTitle.trim() ? currentTitle : 'Untitled',
          icon: currentIcon ?? null,
        };
      }

      // Check if ancestor title was updated in local tree store
      const localNode = privateNodes[item.id] || sharedNodes[item.id];
      const liveTitle = localNode?.title || item.title || 'Untitled';

      return {
        ...item,
        title: liveTitle,
      };
    });
  }, [
    serverState,
    localBreadcrumbs,
    documentId,
    currentTitle,
    currentIcon,
    privateNodes,
    sharedNodes,
  ]);

  return {
    breadcrumbs,
    isLoading,
  };
}
