import {
  canonicalStoredAttachmentUrl,
  describeUploadBlockReason,
  isStoredAttachmentUrl,
  type UploadEligibility,
} from '@/lib/attachment.util';

describe('attachment.util', () => {
  const attachmentId = '11111111-2222-4333-8444-555555555555';
  const eligible: UploadEligibility = {
    isAuthenticated: true,
    accessToken: 'access-token',
    isOnline: true,
    accessLevel: 'EDIT',
    deletedAt: null,
  };

  describe('isStoredAttachmentUrl', () => {
    it('accepts the path the API hands back after an upload', () => {
      expect(isStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}`)).toBe(true);
    });

    it('rejects external, signed, and malformed URLs', () => {
      expect(isStoredAttachmentUrl('https://example.com/image.png')).toBe(false);
      expect(isStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}?exp=1&sig=x`)).toBe(false);
      expect(isStoredAttachmentUrl('/api/v1/attachments/not-a-uuid')).toBe(false);
      expect(isStoredAttachmentUrl('')).toBe(false);
    });

    it('accepts uppercase UUIDs but rejects trailing slashes and bare query strings', () => {
      expect(isStoredAttachmentUrl(`/api/v1/attachments/${attachmentId.toUpperCase()}`)).toBe(true);
      expect(isStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}/`)).toBe(false);
      expect(isStoredAttachmentUrl('?sig=abc')).toBe(false);
    });

    it('treats nullish input as not-a-stored-URL instead of throwing', () => {
      expect(isStoredAttachmentUrl(null as unknown as string)).toBe(false);
      expect(isStoredAttachmentUrl(undefined as unknown as string)).toBe(false);
    });
  });

  describe('canonicalStoredAttachmentUrl', () => {
    it('returns the bare stored path unchanged', () => {
      expect(canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}`)).toBe(
        `/api/v1/attachments/${attachmentId}`
      );
    });

    it('strips the signed query from a relative /file link', () => {
      expect(
        canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}/file?exp=1&sig=abc`)
      ).toBe(`/api/v1/attachments/${attachmentId}`);
    });

    it('strips a fragment from a relative stored path or /file link', () => {
      // Line 37 splits on [?#]: dropping the # handling would leak the fragment into
      // the stored-path match and return null for a valid attachment.
      expect(canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}#frag`)).toBe(
        `/api/v1/attachments/${attachmentId}`
      );
      expect(canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}/file#frag`)).toBe(
        `/api/v1/attachments/${attachmentId}`
      );
      expect(
        canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}/file?exp=1&sig=abc#frag`)
      ).toBe(`/api/v1/attachments/${attachmentId}`);
    });

    it('tolerates a trailing slash on a stored path or /file link', () => {
      // Without slash-stripping these fall through to the unsupported-URL error even
      // though they name an attachment.
      expect(canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}/`)).toBe(
        `/api/v1/attachments/${attachmentId}`
      );
      expect(canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}/file/`)).toBe(
        `/api/v1/attachments/${attachmentId}`
      );
      expect(
        canonicalStoredAttachmentUrl(
          `https://files.example.com/api/v1/attachments/${attachmentId}/`
        )
      ).toBe(`/api/v1/attachments/${attachmentId}`);
    });

    it('strips origin and query from an absolute signed link', () => {
      expect(
        canonicalStoredAttachmentUrl(
          `https://files.example.com/api/v1/attachments/${attachmentId}/file?exp=1&sig=abc`
        )
      ).toBe(`/api/v1/attachments/${attachmentId}`);
      expect(
        canonicalStoredAttachmentUrl(
          `http://localhost:8080/api/v1/attachments/${attachmentId}/file?exp=1&sig=abc`
        )
      ).toBe(`/api/v1/attachments/${attachmentId}`);
    });

    it('returns null for anything that is not an attachment URL', () => {
      expect(canonicalStoredAttachmentUrl('https://example.com/image.png')).toBeNull();
      expect(canonicalStoredAttachmentUrl('/other/path')).toBeNull();
      expect(canonicalStoredAttachmentUrl('javascript:alert(1)')).toBeNull();
      expect(canonicalStoredAttachmentUrl('data:text/html,x')).toBeNull();
      expect(
        canonicalStoredAttachmentUrl(`/api/v1/attachments/${attachmentId}/file/extra`)
      ).toBeNull();
      expect(canonicalStoredAttachmentUrl('')).toBeNull();
    });
  });

  describe('describeUploadBlockReason', () => {
    it('allows uploads when online with edit access', () => {
      expect(describeUploadBlockReason(eligible)).toBeNull();
    });

    it('allows owners', () => {
      expect(describeUploadBlockReason({ ...eligible, accessLevel: 'OWNER' })).toBeNull();
    });

    it('prefers the offline explanation', () => {
      expect(describeUploadBlockReason({ ...eligible, isOnline: false })).toBe('offline');
    });

    it('blocks signed-out sessions even when a stale level is cached', () => {
      expect(
        describeUploadBlockReason({ ...eligible, isAuthenticated: false, accessToken: null })
      ).toBe('unauthenticated');
      expect(describeUploadBlockReason({ ...eligible, accessToken: null })).toBe('unauthenticated');
    });

    it('blocks readers and commenters', () => {
      expect(describeUploadBlockReason({ ...eligible, accessLevel: 'VIEW' })).toBe('read-only');
      expect(describeUploadBlockReason({ ...eligible, accessLevel: 'COMMENT' })).toBe('read-only');
    });

    it('distinguishes a still-loading access level from missing permission', () => {
      expect(describeUploadBlockReason({ ...eligible, accessLevel: null })).toBe('syncing');
    });

    it('blocks trashed documents', () => {
      expect(describeUploadBlockReason({ ...eligible, deletedAt: '2026-01-01T00:00:00Z' })).toBe(
        'trashed'
      );
    });

    it('prefers trashed over read-only when a viewer opens a trashed document', () => {
      // Swapping the deletedAt and read-only branches would report 'read-only' here and
      // send a trashed viewer down the wrong remediation path.
      expect(
        describeUploadBlockReason({
          ...eligible,
          accessLevel: 'VIEW',
          deletedAt: '2026-01-01T00:00:00Z',
        })
      ).toBe('trashed');
      expect(
        describeUploadBlockReason({
          ...eligible,
          accessLevel: 'COMMENT',
          deletedAt: '2026-01-01T00:00:00Z',
        })
      ).toBe('trashed');
    });

    it('applies a fixed priority when several blockers coincide', () => {
      const blocked: UploadEligibility = {
        isAuthenticated: false,
        accessToken: null,
        isOnline: false,
        accessLevel: null,
        deletedAt: '2026-01-01T00:00:00Z',
      };
      // Offline always wins: nothing else can be acted on without a connection.
      expect(describeUploadBlockReason(blocked)).toBe('offline');
      // Without a session the trash state is irrelevant.
      expect(describeUploadBlockReason({ ...blocked, isOnline: true })).toBe('unauthenticated');
      // A trashed document outranks a still-loading access level.
      expect(
        describeUploadBlockReason({
          ...eligible,
          accessLevel: null,
          deletedAt: '2026-01-01T00:00:00Z',
        })
      ).toBe('trashed');
    });
  });
});
