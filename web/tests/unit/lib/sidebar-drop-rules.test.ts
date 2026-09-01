import { isSidebarDropAllowed, resolveSidebarMoveRoute } from '../../../lib/sidebar-drop-rules';

const privateToShared = {
  draggedId: 'doc-1',
  draggedIsShared: false,
  targetIsShared: true,
  draggedParentId: null,
  targetParentId: null,
};

const sharedDrag = (overrides?: Partial<Parameters<typeof isSidebarDropAllowed>[1]>) => ({
  draggedId: 'shared-1',
  draggedIsShared: true,
  targetIsShared: true,
  draggedParentId: null as string | null,
  targetParentId: null as string | null,
  ...overrides,
});

describe('isSidebarDropAllowed', () => {
  it('offers only nesting drops for private -> shared', () => {
    expect(isSidebarDropAllowed('mid', privateToShared)).toBe(true);
    expect(isSidebarDropAllowed('empty', privateToShared)).toBe(true);
    expect(isSidebarDropAllowed('top', privateToShared)).toBe(false);
    expect(isSidebarDropAllowed('bottom', privateToShared)).toBe(false);
  });

  it('blocks reparenting inside Shared but allows same-parent sibling reorder', () => {
    // Root-level shared docs reorder among themselves.
    expect(isSidebarDropAllowed('top', sharedDrag())).toBe(true);
    expect(isSidebarDropAllowed('bottom', sharedDrag())).toBe(true);

    // Nesting under another shared doc is blocked until FULL_ACCESS exists.
    expect(isSidebarDropAllowed('mid', sharedDrag())).toBe(false);
    expect(isSidebarDropAllowed('empty', sharedDrag())).toBe(false);

    // Reordering inside a different parent is a reparent - blocked.
    expect(
      isSidebarDropAllowed(
        'top',
        sharedDrag({ draggedParentId: 'parent-a', targetParentId: 'parent-b' })
      )
    ).toBe(false);
    expect(
      isSidebarDropAllowed(
        'bottom',
        sharedDrag({ draggedParentId: 'parent-a', targetParentId: 'parent-a' })
      )
    ).toBe(true);
  });

  it('keeps legacy behavior for private intra-tree moves', () => {
    const ctx = {
      draggedId: 'doc-1',
      draggedIsShared: false,
      targetIsShared: false,
      draggedParentId: null,
      targetParentId: null,
    };
    expect(isSidebarDropAllowed('top', ctx)).toBe(true);
    expect(isSidebarDropAllowed('mid', ctx)).toBe(true);
    expect(isSidebarDropAllowed('empty', ctx)).toBe(true);
  });

  it('blocks shared -> private entirely', () => {
    const ctx = {
      draggedId: 'shared-1',
      draggedIsShared: true,
      targetIsShared: false,
      draggedParentId: null,
      targetParentId: null,
    };
    expect(isSidebarDropAllowed('mid', ctx)).toBe(false);
    expect(isSidebarDropAllowed('top', ctx)).toBe(false);
  });
});

describe('resolveSidebarMoveRoute', () => {
  it('routes private -> shared nesting to adopt with the host parent', () => {
    const route = resolveSidebarMoveRoute(
      { documentId: 'doc-1', newParentId: 'shared-9' },
      { draggedIsShared: false, targetParentIdIsShared: true }
    );
    expect(route).toEqual({ kind: 'shared-nest-adopt', hostParentId: 'shared-9' });
  });

  it('routes plain private moves to the private tree', () => {
    const route = resolveSidebarMoveRoute(
      { documentId: 'doc-1', newParentId: null },
      { draggedIsShared: false, targetParentIdIsShared: false }
    );
    expect(route).toEqual({ kind: 'private' });
  });

  it('routes shared sibling reorders to the shared store', () => {
    const route = resolveSidebarMoveRoute(
      { documentId: 'shared-1', newParentId: null },
      { draggedIsShared: true, targetParentIdIsShared: false }
    );
    expect(route).toEqual({ kind: 'shared-reorder' });
  });

  it('blocks shared moves that would change parentage', () => {
    const route = resolveSidebarMoveRoute(
      { documentId: 'shared-1', newParentId: 'some-other-parent' },
      { draggedIsShared: true, targetParentIdIsShared: false }
    );
    expect(route).toEqual({ kind: 'blocked' });
  });
});
