import { canDropWithinSpace } from '@/components/sidebar/SpaceTree';
import type { SidebarTreeNode } from '@/types/tree.types';

function node(id: string, parentId: string | null = null): SidebarTreeNode {
  return {
    id,
    title: id,
    parentId,
    orderKey: 'a0',
    hasChildren: false,
    effectiveAccessLevel: 'EDIT',
    icon: null,
    isExpanded: false,
    isLoading: false,
    children: [],
    childrenLoaded: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

const nodes: Record<string, SidebarTreeNode> = {
  root: node('root'),
  otherRoot: node('otherRoot'),
  child: node('child', 'root'),
};

describe('canDropWithinSpace', () => {
  it('only lets a space root reorder against other roots', () => {
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'otherRoot', zone: 'top' })).toBe(true);
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'otherRoot', zone: 'bottom' })).toBe(true);
    // Dropping into a row would reparent the root, which clears its space.
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'otherRoot', zone: 'mid' })).toBe(false);
    expect(canDropWithinSpace(nodes, 'root', { nodeId: 'child', zone: 'top' })).toBe(false);
  });

  it('lets a nested document move anywhere inside the space', () => {
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'root', zone: 'mid' })).toBe(true);
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'otherRoot', zone: 'top' })).toBe(true);
  });

  it('refuses a drop it cannot resolve', () => {
    expect(canDropWithinSpace(nodes, 'missing', { nodeId: 'root', zone: 'mid' })).toBe(false);
    expect(canDropWithinSpace(nodes, 'child', { nodeId: 'missing', zone: 'mid' })).toBe(false);
  });
});
