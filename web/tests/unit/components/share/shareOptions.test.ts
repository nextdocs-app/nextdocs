import {
  getGeneralAccessModeOptions,
  getGeneralAccessViewModel,
  getWorkspaceAccessViewModel,
} from '@/components/share/shareOptions';

describe('getGeneralAccessViewModel', () => {
  const base = { linkAccessLevel: 'VIEW' } as const;

  it('treats an own link as own access without inherited provenance', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'ANYONE_WITH_LINK',
      hasActiveLink: true,
    });

    expect(vm.state).toBe('own');
    expect(vm.displayMode).toBe('ANYONE_WITH_LINK');
    expect(vm.hasEffectivePublicLink).toBe(true);
    expect(vm.showInheritOption).toBe(false);
    expect(vm.showProvenanceBadge).toBe(false);
  });

  it('treats an ancestor grant as inherited and offers no Inherit option', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'RESTRICTED',
      hasActiveLink: false,
      inherited: true,
      inheritedFromId: 'doc-parent',
      inheritedFromTitle: 'Parent Wiki',
    });

    expect(vm.state).toBe('inherited');
    expect(vm.hasEffectivePublicLink).toBe(true);
    expect(vm.displayMode).toBe('ANYONE_WITH_LINK');
    expect(vm.showInheritOption).toBe(false);
  });

  it('marks an own link over an ancestor grant as an override', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'ANYONE_WITH_LINK',
      hasActiveLink: true,
      inheritedFromId: 'doc-parent',
      inheritedFromTitle: 'Parent Wiki',
    });

    expect(vm.state).toBe('own');
    expect(vm.showInheritOption).toBe(true);
    expect(vm.showProvenanceBadge).toBe(true);
    expect(vm.provenanceBadgePrefix).toBe('Overrides');
    expect(vm.provenanceBadgeTooltip).toBe('Overrides Parent Wiki');
  });

  it('marks a blocked document as private on the link channel', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'RESTRICTED',
      hasActiveLink: false,
      inheritedFromId: 'doc-parent',
      inheritedFromTitle: 'Parent Wiki',
      linkInheritBlocked: true,
    });

    expect(vm.state).toBe('blocked');
    expect(vm.hasEffectivePublicLink).toBe(false);
    expect(vm.displayMode).toBe('RESTRICTED');
    expect(vm.showInheritOption).toBe(true);
    expect(vm.provenanceBadgePrefix).toBe('Blocked from');
    expect(vm.provenanceBadgeTooltip).toBe('Blocks inheritance from Parent Wiki');
  });

  it('reports a fully private document without badges or options', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'RESTRICTED',
      hasActiveLink: false,
    });

    expect(vm.state).toBe('private');
    expect(vm.displayMode).toBe('RESTRICTED');
    expect(vm.showInheritOption).toBe(false);
    expect(vm.showProvenanceBadge).toBe(false);
  });

  it('falls back safely when settings have not loaded', () => {
    const vm = getGeneralAccessViewModel(null);

    expect(vm.state).toBe('private');
    expect(vm.displayMode).toBe('RESTRICTED');
    expect(vm.hasEffectivePublicLink).toBe(false);
  });

  it('keeps dropdown and helper consistent when the link is active', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'RESTRICTED',
      hasActiveLink: true,
    });

    expect(vm.hasEffectivePublicLink).toBe(true);
    expect(vm.displayMode).toBe('ANYONE_WITH_LINK');
  });

  it('prefers inherited state when own and inherited flags are both set', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'ANYONE_WITH_LINK',
      hasActiveLink: true,
      inherited: true,
      inheritedFromId: 'doc-parent',
      inheritedFromTitle: 'Parent Wiki',
    });

    expect(vm.state).toBe('inherited');
    expect(vm.displayMode).toBe('ANYONE_WITH_LINK');
    expect(vm.hasEffectivePublicLink).toBe(true);
  });

  it('offers the generic Inherit option for a block without a visible source', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'RESTRICTED',
      hasActiveLink: false,
      linkInheritBlocked: true,
    });

    expect(vm.state).toBe('blocked');
    // Redaction hides which ancestor is blocked, but resuming inheritance is still
    // the user's action; the dropdown falls back to the generic label.
    expect(vm.showInheritOption).toBe(true);
    expect(vm.showProvenanceBadge).toBe(false);
  });

  it('identifies expired own link when hasActiveLink is false', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'ANYONE_WITH_LINK',
      hasActiveLink: false,
    });

    expect(vm.state).toBe('expired');
    expect(vm.hasEffectivePublicLink).toBe(false);
    expect(vm.displayMode).toBe('ANYONE_WITH_LINK');
  });

  it('identifies expired link from past linkExpiresAt date', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'ANYONE_WITH_LINK',
      hasActiveLink: true,
      linkExpiresAt: '2020-01-01T00:00:00Z',
    });

    expect(vm.state).toBe('expired');
    expect(vm.hasEffectivePublicLink).toBe(false);
  });
});

describe('getWorkspaceAccessViewModel', () => {
  it('renders a space-supplied audience as the resolved setting', () => {
    const vm = getWorkspaceAccessViewModel({
      workspaceAccessMode: 'RESTRICTED',
      workspaceAccessLevel: 'EDIT',
      workspaceInherited: true,
      workspaceInheritedFromKind: 'SPACE',
      workspaceInheritedFromId: 'space-1',
      workspaceInheritedFromTitle: 'Engineering',
    });

    expect(vm.state).toBe('inherited');
    expect(vm.hasEffectiveWorkspaceAccess).toBe(true);
    expect(vm.level).toBe('EDIT');
    expect(vm.showSourceBadge).toBe(true);
    expect(vm.sourceKind).toBe('SPACE');
    expect(vm.sourceBadgePrefix).toBe('From');
    expect(vm.sourceTitle).toBe('Engineering');
    // Inheriting is the resting state, so there is nothing to undo.
    expect(vm.showInheritOption).toBe(false);
  });

  it('lets a page override the space audience like any inherited setting', () => {
    const vm = getWorkspaceAccessViewModel({
      workspaceAccessMode: 'WORKSPACE_MEMBERS',
      workspaceAccessLevel: 'VIEW',
      workspaceInheritedFromKind: 'SPACE',
      workspaceInheritedFromId: 'space-1',
      workspaceInheritedFromTitle: 'Engineering',
    });

    expect(vm.state).toBe('own');
    expect(vm.level).toBe('VIEW');
    expect(vm.sourceKind).toBe('SPACE');
    expect(vm.sourceBadgePrefix).toBe('Overrides');
    expect(vm.sourceBadgeTooltip).toBe('Overrides Engineering');
    expect(vm.showInheritOption).toBe(true);
    expect(vm.inheritFromTitle).toBe('Engineering');
  });

  it('reports an inherited workspace audience and its ancestor source', () => {
    const vm = getWorkspaceAccessViewModel({
      workspaceAccessMode: 'RESTRICTED',
      workspaceAccessLevel: 'COMMENT',
      workspaceInherited: true,
      workspaceInheritedFromKind: 'PAGE',
      workspaceInheritedFromId: 'doc-parent',
      workspaceInheritedFromTitle: 'Parent Wiki',
    });

    expect(vm.state).toBe('inherited');
    expect(vm.level).toBe('COMMENT');
    expect(vm.sourceKind).toBe('PAGE');
    expect(vm.sourceBadgePrefix).toBe('From');
    expect(vm.sourceBadgeTooltip).toBe('From “Parent Wiki”');
    expect(vm.showInheritOption).toBe(false);
  });

  it('marks an own workspace level over an ancestor as an override', () => {
    const vm = getWorkspaceAccessViewModel({
      workspaceAccessMode: 'WORKSPACE_MEMBERS',
      workspaceAccessLevel: 'EDIT',
      workspaceInheritedFromKind: 'PAGE',
      workspaceInheritedFromId: 'doc-parent',
      workspaceInheritedFromTitle: 'Parent Wiki',
    });

    expect(vm.state).toBe('own');
    expect(vm.sourceBadgePrefix).toBe('Overrides');
    expect(vm.sourceBadgeTooltip).toBe('Overrides Parent Wiki');
    expect(vm.showInheritOption).toBe(true);
    expect(vm.inheritFromTitle).toBe('Parent Wiki');
  });

  it('keeps a blocked workspace audience private and offers inheritance back', () => {
    const vm = getWorkspaceAccessViewModel({
      workspaceAccessMode: 'RESTRICTED',
      workspaceAccessLevel: 'VIEW',
      workspaceInheritBlocked: true,
      workspaceInheritedFromKind: 'SPACE',
      workspaceInheritedFromId: 'space-1',
      workspaceInheritedFromTitle: 'Engineering',
    });

    expect(vm.state).toBe('blocked');
    expect(vm.hasEffectiveWorkspaceAccess).toBe(false);
    expect(vm.displayMode).toBe('RESTRICTED');
    expect(vm.sourceKind).toBe('SPACE');
    expect(vm.sourceBadgePrefix).toBe('Blocked from');
    expect(vm.sourceBadgeTooltip).toBe('Blocks inheritance from Engineering');
    expect(vm.showInheritOption).toBe(true);
  });

  it('keeps the state but no source when the API hides an unreachable source', () => {
    const vm = getWorkspaceAccessViewModel({
      workspaceAccessMode: 'RESTRICTED',
      workspaceAccessLevel: 'EDIT',
      workspaceInherited: true,
    });

    expect(vm.state).toBe('inherited');
    expect(vm.hasEffectiveWorkspaceAccess).toBe(true);
    expect(vm.level).toBe('EDIT');
    expect(vm.showSourceBadge).toBe(false);
    expect(vm.sourceKind).toBeNull();
  });

  it('keeps an empty inherit title when a source has no title', () => {
    const vm = getWorkspaceAccessViewModel({
      workspaceAccessMode: 'RESTRICTED',
      workspaceAccessLevel: 'EDIT',
      workspaceInheritBlocked: true,
      workspaceInheritedFromId: 'doc-parent',
    });

    expect(vm.showSourceBadge).toBe(true);
    expect(vm.inheritFromTitle).toBe('');
  });

  it('falls back safely when workspace settings have not loaded', () => {
    const vm = getWorkspaceAccessViewModel(null);

    expect(vm.state).toBe('private');
    expect(vm.hasEffectiveWorkspaceAccess).toBe(false);
    expect(vm.showSourceBadge).toBe(false);
  });
});

describe('getGeneralAccessModeOptions', () => {
  it('keeps Restricted when the mode is already restricted even without a restrict switch', () => {
    const options = getGeneralAccessModeOptions({
      current: 'RESTRICTED',
      canRestrict: false,
      canAddWorkspace: false,
      canAddLink: false,
      showInheritOption: false,
    });

    expect(options.map((option) => option.value)).toEqual(['RESTRICTED']);
  });

  it('omits Restricted when the caller may neither restrict nor keep a restricted mode', () => {
    const options = getGeneralAccessModeOptions({
      current: 'INHERIT' as never,
      canRestrict: false,
      canAddWorkspace: false,
      canAddLink: false,
      showInheritOption: false,
    });

    expect(options).toEqual([]);
  });
});
