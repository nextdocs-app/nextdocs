import { commentAvatarUrl } from '../../../../components/editor/comment.utils';
import { buildInitialsAvatarDataUrl } from '../../../../lib/avatar.util';
import { getApiBaseUrl } from '../../../../lib/api-url.util';

describe('commentAvatarUrl', () => {
  it('resolves an uploaded photo against the API origin', () => {
    // BlockNote takes an image source, so a host-independent path is not enough.
    expect(commentAvatarUrl('user-1', 'Ada', '/api/v1/users/user-1/avatar?v=abc123')).toBe(
      `${getApiBaseUrl()}/api/v1/users/user-1/avatar?v=abc123`
    );
  });

  it('generates initials for an account without a photo', () => {
    expect(commentAvatarUrl('user-1', 'Ada Lovelace', null)).toBe(
      buildInitialsAvatarDataUrl('user-1', 'Ada Lovelace')
    );
    expect(commentAvatarUrl('user-1', 'Ada Lovelace', undefined)).toMatch(/^data:image\/svg\+xml,/);
  });

  it('generates initials instead of rendering a refused source', () => {
    // The same allowlist that guards <img> applies here: nothing else reaches the card.
    expect(commentAvatarUrl('user-1', 'Ada', 'javascript:alert(1)')).toBe(
      buildInitialsAvatarDataUrl('user-1', 'Ada')
    );
  });
});
