import {
  applyNodeMeta,
  collectSubtreeIds,
  pruneUnreachableNodes,
} from '../../../lib/tree-meta.util';

describe('applyNodeMeta', () => {
  it('normalizes a title update', () => {
    const node = { title: 'Old', icon: null as null };
    applyNodeMeta(node, { title: '   ' });

    expect(node.title).toBe('Untitled');
  });

  it('leaves the title alone when no title is given', () => {
    const node = { title: 'Keep', icon: null as null };
    applyNodeMeta(node, { icon: null });

    expect(node.title).toBe('Keep');
  });

  it('sanitizes the icon the same way for both trees', () => {
    const node = { title: 'T', icon: null as null };
    applyNodeMeta(node, { icon: { type: 'builtin', value: '../../etc/passwd' } as never });

    expect(node.icon).toBeNull();
  });

  it('keeps a valid icon', () => {
    const node = { title: 'T', icon: null as null };
    applyNodeMeta(node, { icon: { type: 'emoji', value: '📝' } });

    expect(node.icon).toEqual({ type: 'emoji', value: '📝' });
  });

  it('clears the icon on an explicit null', () => {
    const node = { title: 'T', icon: { type: 'emoji', value: '📝' } as never };
    applyNodeMeta(node, { icon: null });

    expect(node.icon).toBeNull();
  });

  it('skips the icon when it is undefined', () => {
    const icon = { type: 'emoji', value: '📝' } as never;
    const node = { title: 'T', icon };
    applyNodeMeta(node, {});

    expect(node.icon).toBe(icon);
  });

  it('leaves an unchanged icon alone so title keystrokes do not re-render', () => {
    const icon = { type: 'emoji', value: '📝' } as never;
    const node = { title: 'Old', icon };
    applyNodeMeta(node, { title: 'New', icon: { type: 'emoji', value: '📝' } });

    expect(node.title).toBe('New');
    expect(node.icon).toBe(icon);
  });
});

describe('pruneUnreachableNodes', () => {
  it('drops nodes unreachable from the roots and reports them', () => {
    const nodes: Record<string, { children: string[] }> = {
      a: { children: ['b'] },
      b: { children: [] },
      orphan: { children: ['ghost'] },
      ghost: { children: [] },
    };

    const pruned = pruneUnreachableNodes(nodes, ['a']);

    expect(pruned.sort()).toEqual(['ghost', 'orphan']);
    expect(Object.keys(nodes).sort()).toEqual(['a', 'b']);
  });

  it('keeps lazily loaded subtrees of surviving roots', () => {
    const nodes: Record<string, { children: string[] }> = {
      a: { children: ['b'] },
      b: { children: ['c'] },
      c: { children: [] },
    };

    expect(pruneUnreachableNodes(nodes, ['a'])).toEqual([]);
    expect(Object.keys(nodes).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('collectSubtreeIds', () => {
  it('collects a node plus all descendants', () => {
    const nodes: Record<string, { children: string[] }> = {
      a: { children: ['b', 'c'] },
      b: { children: ['d'] },
      c: { children: [] },
      d: { children: [] },
      other: { children: [] },
    };

    expect(collectSubtreeIds(nodes, 'a').sort()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('terminates on a corrupt cycle instead of looping forever', () => {
    const nodes: Record<string, { children: string[] }> = {
      a: { children: ['b'] },
      b: { children: ['a'] },
    };

    expect(collectSubtreeIds(nodes, 'a').sort()).toEqual(['a', 'b']);
  });
});
