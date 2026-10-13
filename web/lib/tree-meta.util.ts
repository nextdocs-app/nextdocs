import { normalizeDocumentTitle } from '@/lib/document-content.util';
import { sanitizeDocumentIcon } from '@/lib/document-icon.util';
import type { DocumentIcon } from '@/types/document.types';

/**
 * Shared title/icon applier for the private and shared trees.
 *
 * Both slices previously carried an identical `updateNodeMeta` reducer body
 * (normalize title, sanitize icon). A single helper keeps the two trees from
 * drifting — notably the shared tree once assigned the raw icon without
 * sanitizing, so a stale IndexedDB payload could reach img/CSS there.
 */
export function applyNodeMeta(
  node: { title: string; icon?: DocumentIcon | null },
  update: { title?: string; icon?: DocumentIcon | null }
): void {
  if (update.title !== undefined) {
    node.title = normalizeDocumentTitle(update.title);
  }
  if (update.icon !== undefined) {
    const next = sanitizeDocumentIcon(update.icon) ?? null;
    // Title-only writes fan out the full meta, so the icon arrives unchanged
    // on every keystroke. Skip the assignment when the sanitized JSON matches
    // to avoid wasted work and extra re-renders. An absent key still normalizes
    // to explicit null so readers see one "no icon" shape.
    if (node.icon === undefined || JSON.stringify(next) !== JSON.stringify(node.icon)) {
      node.icon = next;
    }
  }
}

/**
 * Shared reachability sweep for tree slices.
 *
 * Drops every node id that is no longer reachable from `rootIds` by following
 * `children` links. Returns the pruned ids so callers can log or react.
 */
export function pruneUnreachableNodes(
  nodes: Record<string, { children: string[] }>,
  rootIds: readonly string[]
): string[] {
  const reachable = new Set<string>(rootIds);
  const queue = [...rootIds];
  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodes[id];
    if (!node) {
      continue;
    }
    for (const childId of node.children) {
      if (!reachable.has(childId)) {
        reachable.add(childId);
        queue.push(childId);
      }
    }
  }
  const pruned: string[] = [];
  for (const id of Object.keys(nodes)) {
    if (!reachable.has(id)) {
      delete nodes[id];
      pruned.push(id);
    }
  }
  return pruned;
}

/**
 * Collects a node plus all of its descendants by following `children` links.
 * Shared by both trees' `removeNode` so subtree deletion cannot drift.
 * Tolerates corrupt cycles (a visited set) instead of looping forever.
 */
export function collectSubtreeIds(
  nodes: Record<string, { children: string[] }>,
  rootId: string
): string[] {
  const visited = new Set<string>([rootId]);
  const collected = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const currentNode = nodes[currentId];
    if (currentNode?.children) {
      for (const childId of currentNode.children) {
        if (!visited.has(childId)) {
          visited.add(childId);
          collected.push(childId);
          queue.push(childId);
        }
      }
    }
  }
  return collected;
}
