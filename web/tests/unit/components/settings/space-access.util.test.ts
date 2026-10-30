import {
  formatSpaceDate,
  spaceDocumentCountLabel,
  spaceMemberOptions,
} from '../../../../components/settings/workspace/space-access.util';

describe('spaceMemberOptions', () => {
  it('offers every level plus removal to an administrator', () => {
    const options = spaceMemberOptions({
      canAdminister: true,
      memberLevel: 'EDIT',
      isSelf: false,
      ownerCount: 2,
    });

    expect(options.map((option) => option.value)).toEqual([
      'OWNER',
      'EDIT',
      'COMMENT',
      'VIEW',
      'REMOVE',
    ]);
  });

  it('offers nothing that would demote or remove the last owner', () => {
    const options = spaceMemberOptions({
      canAdminister: true,
      memberLevel: 'OWNER',
      isSelf: true,
      ownerCount: 1,
    });

    expect(options.map((option) => option.value)).toEqual(['OWNER']);
  });

  it('lets a plain member leave but not change anyone', () => {
    expect(
      spaceMemberOptions({
        canAdminister: false,
        memberLevel: 'VIEW',
        isSelf: true,
        ownerCount: 2,
      }).map((option) => option.value)
    ).toEqual(['VIEW', 'LEAVE']);

    expect(
      spaceMemberOptions({
        canAdminister: false,
        memberLevel: 'EDIT',
        isSelf: false,
        ownerCount: 2,
      })
    ).toEqual([]);
  });

  it('keeps the last owner in the space even as themselves', () => {
    expect(
      spaceMemberOptions({
        canAdminister: false,
        memberLevel: 'OWNER',
        isSelf: true,
        ownerCount: 1,
      })
    ).toEqual([]);
  });
});

describe('spaceDocumentCountLabel', () => {
  it('formats single and plural document counts', () => {
    expect(spaceDocumentCountLabel(1)).toBe('1 document');
    expect(spaceDocumentCountLabel(0)).toBe('0 documents');
    expect(spaceDocumentCountLabel(7)).toBe('7 documents');
  });
});

describe('formatSpaceDate', () => {
  it('returns null for missing or unreadable timestamps', () => {
    expect(formatSpaceDate(null)).toBeNull();
    expect(formatSpaceDate('not-a-date')).toBeNull();
  });

  it('formats a timestamp', () => {
    expect(formatSpaceDate('2026-05-01T12:00:00Z')).toMatch(/2026/);
  });
});
