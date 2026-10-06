import { getGeneralAccessViewModel } from '@/components/share/shareOptions';

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

  it('offers no Inherit option for a block without an ancestor', () => {
    const vm = getGeneralAccessViewModel({
      ...base,
      generalAccessMode: 'RESTRICTED',
      hasActiveLink: false,
      linkInheritBlocked: true,
    });

    expect(vm.state).toBe('blocked');
    expect(vm.showInheritOption).toBe(false);
    expect(vm.showProvenanceBadge).toBe(false);
  });
});
