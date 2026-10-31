import { useEffect, useMemo, useState } from 'react';
import { useAppSelector } from '@/stores/hooks';
import {
  documentService,
  type DocumentBreadcrumbItem,
  type DocumentBreadcrumbSpace,
} from '@/services/document.service';
import type { DocumentIcon } from '@/types/document.types';
import type { SidebarTreeNode } from '@/types/tree.types';
import type { SpaceTree, SpaceSummary } from '@/stores/spaceTree/spaceTree.slice';

const EMPTY_NODES: Record<string, SidebarTreeNode> = {};
const EMPTY_SPACE_TREES: Record<string, SpaceTree> = {};

export function useDocumentBreadcrumbs(
  documentId: string,
  currentTitle?: string,
  currentIcon?: DocumentIcon | null
): {
  breadcrumbs: DocumentBreadcrumbItem[];
  space: DocumentBreadcrumbSpace | null;
  isLoading: boolean;
} {
  const privateNodes: Record<string, SidebarTreeNode> = useAppSelector(
    (state) => state?.sidebarTree?.nodes ?? EMPTY_NODES
  );
  const sharedNodes: Record<string, SidebarTreeNode> = useAppSelector(
    (state) => state?.sharedTree?.nodes ?? EMPTY_NODES
  );
  const spaceTrees: Record<string, SpaceTree> = useAppSelector(
    (state) => state?.spaceTree?.trees ?? EMPTY_SPACE_TREES
  );
  const spaceSummaries: Record<string, SpaceSummary> | undefined = useAppSelector(
    (state) => state?.spaceTree?.spaces
  );
  const accessToken = useAppSelector((state) => state?.auth?.accessToken ?? null);

  const [serverState, setServerState] = useState<{
    documentId: string;
    items: DocumentBreadcrumbItem[];
  } | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Compute breadcrumbs from local Redux tree nodes (0ms instant render)
  const { localBreadcrumbs, localSpace, matchedSpaceId } = useMemo<{
    localBreadcrumbs: DocumentBreadcrumbItem[];
    localSpace: DocumentBreadcrumbSpace | null;
    matchedSpaceId: string | null;
  }>(() => {
    if (!documentId) {
      return { localBreadcrumbs: [], localSpace: null, matchedSpaceId: null };
    }

    // Check if the document belongs to a space tree
    let foundSpaceId: string | null = null;
    let spaceNodes: Record<string, SidebarTreeNode> | null = null;

    for (const [spaceId, tree] of Object.entries(spaceTrees)) {
      if (tree?.nodes?.[documentId]) {
        foundSpaceId = spaceId;
        spaceNodes = tree.nodes;
        break;
      }
    }

    const items: DocumentBreadcrumbItem[] = [];
    let currentId: string | null = documentId;
    const visited = new Set<string>();

    const resolvedLocalSpace: DocumentBreadcrumbSpace | null = foundSpaceId
      ? (spaceSummaries?.[foundSpaceId] ?? { id: foundSpaceId, name: 'Space', icon: null })
      : null;

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node: SidebarTreeNode | undefined =
        spaceNodes?.[currentId] || privateNodes[currentId] || sharedNodes[currentId];
      if (!node) {
        break;
      }
      items.push({
        id: node.id,
        title: node.title || 'Untitled',
        icon: node.icon,
        parentId: node.parentId,
        space: resolvedLocalSpace,
      });
      currentId = node.parentId;
    }

    if (items.length === 0) {
      return {
        localBreadcrumbs: [
          {
            id: documentId,
            title: currentTitle || 'Untitled',
            icon: currentIcon ?? null,
            parentId: null,
            space: resolvedLocalSpace,
          },
        ],
        localSpace: resolvedLocalSpace,
        matchedSpaceId: foundSpaceId,
      };
    }

    return {
      localBreadcrumbs: items.reverse(),
      localSpace: resolvedLocalSpace,
      matchedSpaceId: foundSpaceId,
    };
  }, [
    documentId,
    privateNodes,
    sharedNodes,
    spaceTrees,
    spaceSummaries,
    currentTitle,
    currentIcon,
  ]);

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

  const serverBreadcrumbs =
    serverState && serverState.documentId === documentId ? serverState.items : [];

  const serverSpace = useMemo(() => {
    return serverBreadcrumbs.find((b) => b.space)?.space ?? null;
  }, [serverBreadcrumbs]);

  const effectiveSpace = serverSpace ?? localSpace;

  // Merge and apply reactive live updates to titles
  const breadcrumbs = useMemo<DocumentBreadcrumbItem[]>(() => {
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
          space: effectiveSpace,
        },
      ];
    }

    return rawList.map((item, index) => {
      const isCurrent = index === rawList.length - 1;
      if (isCurrent) {
        return {
          ...item,
          space: effectiveSpace ?? item.space ?? null,
          title: currentTitle && currentTitle.trim() ? currentTitle : 'Untitled',
          // Only fall back while meta is unknown (`undefined`). A known
          // deletion (`null`) must win — otherwise the old icon flashes back.
          icon: currentIcon === undefined ? item.icon : currentIcon,
        };
      }

      // Check if ancestor title/icon was updated in local tree store
      const localNode =
        privateNodes[item.id] ||
        sharedNodes[item.id] ||
        (matchedSpaceId ? spaceTrees[matchedSpaceId]?.nodes[item.id] : undefined);
      const liveTitle = localNode?.title || item.title || 'Untitled';

      return {
        ...item,
        space: effectiveSpace ?? item.space ?? null,
        title: liveTitle,
        icon: localNode?.icon === undefined ? item.icon : localNode.icon,
      };
    });
  }, [
    serverBreadcrumbs,
    localBreadcrumbs,
    effectiveSpace,
    documentId,
    currentTitle,
    currentIcon,
    privateNodes,
    sharedNodes,
    spaceTrees,
    matchedSpaceId,
  ]);

  return {
    breadcrumbs,
    space: effectiveSpace,
    isLoading,
  };
}
