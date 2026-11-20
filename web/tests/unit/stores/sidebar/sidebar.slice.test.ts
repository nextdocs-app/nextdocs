import sidebarReducer, {
  hydratePreferences,
  resetSidebar,
  setSearchQuery,
  setSpaceExpanded,
} from '../../../../stores/sidebar/sidebar.slice';

const initial = sidebarReducer(undefined, { type: '@@init' });

describe('sidebar.slice remembered state', () => {
  it('defaults to an expanded rail with no space unfolded', () => {
    expect(initial.isCollapsed).toBe(false);
    expect(initial.isPrivateOpen).toBe(true);
    expect(initial.isSharedOpen).toBe(true);
    expect(initial.isSpacesOpen).toBe(true);
    expect(initial.expandedSpaceIds).toEqual([]);
  });

  it('hydrates the stored rail state in one dispatch', () => {
    const state = sidebarReducer(
      initial,
      hydratePreferences({
        collapsed: true,
        sections: { spaces: false, private: false, shared: true },
      })
    );

    expect(state.isCollapsed).toBe(true);
    expect(state.isSpacesOpen).toBe(false);
    expect(state.isPrivateOpen).toBe(false);
    expect(state.isSharedOpen).toBe(true);
  });

  it('tracks unfolded spaces in the order they were opened', () => {
    let state = sidebarReducer(initial, setSpaceExpanded({ spaceId: 'space-1', expanded: true }));
    state = sidebarReducer(state, setSpaceExpanded({ spaceId: 'space-2', expanded: true }));
    expect(state.expandedSpaceIds).toEqual(['space-1', 'space-2']);

    state = sidebarReducer(state, setSpaceExpanded({ spaceId: 'space-1', expanded: false }));
    expect(state.expandedSpaceIds).toEqual(['space-2']);

    // Re-expanding moves it to the end, which is the order the cap trims from.
    state = sidebarReducer(state, setSpaceExpanded({ spaceId: 'space-1', expanded: true }));
    expect(state.expandedSpaceIds).toEqual(['space-2', 'space-1']);
  });

  it('ignores a redundant expansion change', () => {
    const expanded = sidebarReducer(
      initial,
      setSpaceExpanded({ spaceId: 'space-1', expanded: true })
    );
    expect(sidebarReducer(expanded, setSpaceExpanded({ spaceId: 'space-1', expanded: true }))).toBe(
      expanded
    );
    expect(sidebarReducer(initial, setSpaceExpanded({ spaceId: 'space-1', expanded: false }))).toBe(
      initial
    );
  });

  it('leaves remembered preferences alone when the transient surfaces reset', () => {
    let state = sidebarReducer(
      initial,
      hydratePreferences({
        collapsed: true,
        sections: { spaces: false, private: true, shared: false },
      })
    );
    state = sidebarReducer(state, setSpaceExpanded({ spaceId: 'space-1', expanded: true }));
    state = sidebarReducer(state, setSearchQuery('roadmap'));

    const reset = sidebarReducer(state, resetSidebar());

    expect(reset.searchQuery).toBe('');
    expect(reset.isCollapsed).toBe(true);
    expect(reset.isSpacesOpen).toBe(false);
    expect(reset.isSharedOpen).toBe(false);
    expect(reset.expandedSpaceIds).toEqual(['space-1']);
  });
});
