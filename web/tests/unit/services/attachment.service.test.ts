import {
  AttachmentServiceApiError,
  UnsupportedUrlError,
  attachmentService,
  parseSignedUrlExpiry,
} from '@/services/attachment.service';

const API_BASE = 'http://localhost:8080';
const ATTACHMENT_ID = '11111111-2222-4333-8444-555555555555';
const STORED_URL = `/api/v1/attachments/${ATTACHMENT_ID}`;

/** Mirrors the service's bound; keep in sync if MAX_CACHED_URLS changes. */
const MAX_CACHED_URLS = 200;

/** Distinct, pattern-valid stored URLs for exercising the cache bound. */
function distinctStoredUrls(count: number): string[] {
  return Array.from(
    { length: count },
    (_unused, index) =>
      `/api/v1/attachments/00000000-0000-4000-8000-${String(index).padStart(12, '0')}`
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('attachment.service', () => {
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    attachmentService.resetAttachmentUrlCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('uploadAttachment', () => {
    it('posts multipart form data with the bearer token and no manual content type', async () => {
      const uploaded = {
        id: ATTACHMENT_ID,
        documentId: 'doc-1',
        fileName: 'a.png',
        contentType: 'image/png',
        sizeBytes: 3,
        url: STORED_URL,
        createdAt: '2026-01-01T00:00:00.000Z',
      };
      fetchMock.mockResolvedValue(jsonResponse({ success: true, data: uploaded, error: null }));

      const file = new File(['abc'], 'a.png', { type: 'image/png' });
      const result = await attachmentService.uploadAttachment('doc-1', file, 'token-123');

      expect(result).toEqual(uploaded);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API_BASE}/api/v1/documents/doc-1/attachments`);
      expect(init.method).toBe('POST');
      expect(init.credentials).toBe('include');
      expect(init.headers.Authorization).toBe('Bearer token-123');
      expect(init.headers['Content-Type']).toBeUndefined();
      expect(init.body).toBeInstanceOf(FormData);
      expect((init.body as FormData).get('file')).toBe(file);
    });

    it('url-encodes the document id', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: true, data: { id: ATTACHMENT_ID, url: STORED_URL }, error: null })
      );

      await attachmentService.uploadAttachment(
        'doc/with/slashes',
        new File(['a'], 'a.txt'),
        'token'
      );

      expect(fetchMock.mock.calls[0][0]).toBe(
        `${API_BASE}/api/v1/documents/doc%2Fwith%2Fslashes/attachments`
      );
    });

    it('throws an AttachmentServiceApiError carrying the server message', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          {
            success: false,
            data: null,
            error: 'The uploaded file exceeds the configured size limit.',
          },
          413
        )
      );

      await expect(
        attachmentService.uploadAttachment('doc-1', new File(['a'], 'big.zip'), 'token')
      ).rejects.toMatchObject({
        name: 'AttachmentServiceApiError',
        status: 413,
        message: 'The uploaded file exceeds the configured size limit.',
      });
    });

    it('surfaces network failures', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      await expect(
        attachmentService.uploadAttachment('doc-1', new File(['a'], 'a.png'), 'token')
      ).rejects.toBeInstanceOf(TypeError);
    });
  });

  describe('resolveAttachmentUrl', () => {
    it('passes non-internal http(s) URLs through untouched', async () => {
      await expect(
        attachmentService.resolveAttachmentUrl('https://example.com/image.png', 'token')
      ).resolves.toBe('https://example.com/image.png');
      await expect(
        attachmentService.resolveAttachmentUrl('http://example.com/image.png', 'token')
      ).resolves.toBe('http://example.com/image.png');

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects javascript: and data: URLs instead of rendering them', async () => {
      await expect(
        attachmentService.resolveAttachmentUrl('javascript:alert(1)', 'token')
      ).rejects.toBeInstanceOf(UnsupportedUrlError);
      await expect(
        attachmentService.resolveAttachmentUrl('data:text/html,<script>alert(1)</script>', null)
      ).rejects.toBeInstanceOf(UnsupportedUrlError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('fetches a signed URL once and caches it', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );

      const resolved = await attachmentService.resolveAttachmentUrl(STORED_URL, 'token');
      expect(resolved).toBe(`${API_BASE}${STORED_URL}/file?exp=4102444800&sig=abc`);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${API_BASE}${STORED_URL}/url`);
      expect(init.method).toBe('GET');
      expect(init.headers.Authorization).toBe('Bearer token');

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, 'token')).resolves.toBe(
        resolved
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('omits the Authorization header for anonymous viewers', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );

      await attachmentService.resolveAttachmentUrl(STORED_URL, null);

      expect(fetchMock.mock.calls[0][1].headers).toEqual({});
    });

    it('omits the Authorization header for an undefined token', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );

      await attachmentService.resolveAttachmentUrl(STORED_URL, undefined as unknown as null);

      expect(fetchMock.mock.calls[0][1].headers).toEqual({});
    });

    it('never serves one identity a signed URL minted for another', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: `${STORED_URL}/file?exp=4102444800&sig=aaa`, expiresAt: 4102444800 },
            error: null,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: `${STORED_URL}/file?exp=4102444800&sig=bbb`, expiresAt: 4102444800 },
            error: null,
          })
        );

      const firstIdentity = await attachmentService.resolveAttachmentUrl(STORED_URL, 'token-a');
      const secondIdentity = await attachmentService.resolveAttachmentUrl(STORED_URL, 'token-b');
      expect(firstIdentity).toContain('sig=aaa');
      expect(secondIdentity).toContain('sig=bbb');

      // Each identity must keep its own cached URL: re-resolving for the first
      // token must not hand back the second token's mint.
      await expect(
        attachmentService.resolveAttachmentUrl(STORED_URL, 'token-a')
      ).resolves.toContain('sig=aaa');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('rejects blob: and relative non-attachment URLs without a request', async () => {
      await expect(
        attachmentService.resolveAttachmentUrl('blob:http://localhost/uuid', 'token')
      ).rejects.toBeInstanceOf(UnsupportedUrlError);
      await expect(
        attachmentService.resolveAttachmentUrl('/other/path', 'token')
      ).rejects.toBeInstanceOf(UnsupportedUrlError);
      await expect(
        attachmentService.resolveAttachmentUrl('bare-string', 'token')
      ).rejects.toBeInstanceOf(UnsupportedUrlError);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('throws when the envelope reports failure on a 200 response', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ success: false, data: null, error: 'Envelope says no.' }, 200)
      );

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).rejects.toMatchObject({
        name: 'AttachmentServiceApiError',
        status: 200,
        message: 'Envelope says no.',
      });
    });

    it('retries a failed resolution once its negative-cache window lapses', async () => {
      const dateSpy = jest.spyOn(Date, 'now');
      const start = 1_700_000_000_000;
      fetchMock.mockResolvedValue(
        jsonResponse(
          { success: false, data: null, error: 'The requested resource was not found.' },
          404
        )
      );

      dateSpy.mockReturnValue(start);
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).rejects.toBeInstanceOf(
        AttachmentServiceApiError
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // Thirty seconds later the negative entry has lapsed: the next render mints again.
      dateSpy.mockReturnValue(start + 30_001);
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toContain(
        '/file?'
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('de-duplicates per access token, never across identities', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );

      await Promise.all([
        attachmentService.resolveAttachmentUrl(STORED_URL, 'token-a'),
        attachmentService.resolveAttachmentUrl(STORED_URL, 'token-b'),
      ]);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('negative-caches failed resolutions so a broken attachment cannot hammer the endpoint', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { success: false, data: null, error: 'The requested resource was not found.' },
          404
        )
      );

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).rejects.toBeInstanceOf(
        AttachmentServiceApiError
      );
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).rejects.toBeInstanceOf(
        AttachmentServiceApiError
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);

      // A new session must be allowed to retry immediately instead of inheriting the failure.
      attachmentService.resetAttachmentUrlCache();
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toContain(
        '/file?'
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('caches a URL with an unparseable expiry instead of re-minting on every render', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 'not-a-date' },
          error: null,
        })
      );

      await attachmentService.resolveAttachmentUrl(STORED_URL, null);
      await attachmentService.resolveAttachmentUrl(STORED_URL, null);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('de-duplicates concurrent resolutions of the same attachment', async () => {
      let resolveFetch: (response: Response) => void = () => {};
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      );

      const first = attachmentService.resolveAttachmentUrl(STORED_URL, null);
      const second = attachmentService.resolveAttachmentUrl(STORED_URL, null);
      resolveFetch(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );

      await expect(Promise.all([first, second])).resolves.toEqual([
        `${API_BASE}${STORED_URL}/file?exp=4102444800&sig=abc`,
        `${API_BASE}${STORED_URL}/file?exp=4102444800&sig=abc`,
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('drops a late resolution that settles after the session changed', async () => {
      let resolveFetch: (response: Response) => void = () => {};
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolveFetch = resolve;
          })
      );

      const pending = attachmentService.resolveAttachmentUrl(STORED_URL, 'token-a');
      // A logout/login wipes the maps while the mint request is still in flight.
      attachmentService.resetAttachmentUrlCache();
      resolveFetch(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=aaa`, expiresAt: 4102444800 },
          error: null,
        })
      );
      await expect(pending).resolves.toBe(`${API_BASE}${STORED_URL}/file?exp=4102444800&sig=aaa`);

      // The stale result must not have repopulated the next session's cache.
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=bbb`, expiresAt: 4102444800 },
          error: null,
        })
      );
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, 'token-b')).resolves.toBe(
        `${API_BASE}${STORED_URL}/file?exp=4102444800&sig=bbb`
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps a newer in-flight resolution when an older one settles late', async () => {
      const resolvers: Array<(response: Response) => void> = [];
      fetchMock.mockImplementation(
        () =>
          new Promise<Response>((resolve) => {
            resolvers.push(resolve);
          })
      );

      const first = attachmentService.resolveAttachmentUrl(STORED_URL, 'token-a');
      attachmentService.resetAttachmentUrlCache();
      const second = attachmentService.resolveAttachmentUrl(STORED_URL, 'token-b');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      resolvers[0](
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=aaa`, expiresAt: 4102444800 },
          error: null,
        })
      );
      resolvers[1](
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=bbb`, expiresAt: 4102444800 },
          error: null,
        })
      );

      await expect(first).resolves.toContain('sig=aaa');
      await expect(second).resolves.toContain('sig=bbb');
      // The older settlement must not have evicted the newer resolution or its cache entry.
      await expect(
        attachmentService.resolveAttachmentUrl(STORED_URL, 'token-b')
      ).resolves.toContain('sig=bbb');
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('re-signs once the cached URL nears expiry', async () => {
      const now = Date.now();
      const dateSpy = jest.spyOn(Date, 'now');
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: '/first', expiresAt: (now + 5 * 60_000) / 1000 },
            error: null,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: '/second', expiresAt: (now + 60 * 60_000) / 1000 },
            error: null,
          })
        );

      dateSpy.mockReturnValue(now);
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/first`
      );

      dateSpy.mockReturnValue(now + 5 * 60_000);
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/second`
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('re-mints when the cached URL sits exactly on the safety margin', async () => {
      // Freshness is strict (>): expiresAt - margin == now must re-mint, or >= would
      // serve a URL that expires mid-render.
      const now = 1_700_000_000_000;
      const dateSpy = jest.spyOn(Date, 'now');
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: '/first', expiresAt: (now + 60_000) / 1000 },
            error: null,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: '/second', expiresAt: (now + 120_000) / 1000 },
            error: null,
          })
        );

      dateSpy.mockReturnValue(now);
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/first`
      );

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/second`
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('serves the cached URL one millisecond past the safety margin', async () => {
      const now = 1_700_000_000_000;
      const dateSpy = jest.spyOn(Date, 'now');
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: '/first', expiresAt: (now + 60_001) / 1000 },
          error: null,
        })
      );

      dateSpy.mockReturnValue(now);
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/first`
      );
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/first`
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps an absolute URL served from a public file host', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            url: `https://files.example.com/api/v1/attachments/${ATTACHMENT_ID}/file?exp=4102444800&sig=abc`,
            expiresAt: 4102444800,
          },
          error: null,
        })
      );

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `https://files.example.com/api/v1/attachments/${ATTACHMENT_ID}/file?exp=4102444800&sig=abc`
      );
    });

    it('re-mints a URL the server reports as already expired instead of caching it', async () => {
      const dateSpy = jest.spyOn(Date, 'now');
      const now = 1_700_000_000_000;
      dateSpy.mockReturnValue(now);
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: '/stale', expiresAt: now / 1000 - 1 },
            error: null,
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            success: true,
            data: { url: '/fresh', expiresAt: now / 1000 + 3600 },
            error: null,
          })
        );

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/stale`
      );
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).resolves.toBe(
        `${API_BASE}/fresh`
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('mints from a relative signed URL instead of rejecting it', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );

      await expect(
        attachmentService.resolveAttachmentUrl(`${STORED_URL}/file?exp=1&sig=stale`, 'token')
      ).resolves.toBe(`${API_BASE}${STORED_URL}/file?exp=4102444800&sig=abc`);

      expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE}${STORED_URL}/url`);
    });

    it('evicts the oldest cached URL once the cache bound is reached', async () => {
      const urls = distinctStoredUrls(MAX_CACHED_URLS + 1);
      fetchMock.mockResolvedValue(
        jsonResponse({
          success: true,
          data: { url: `${STORED_URL}/file?exp=4102444800&sig=abc`, expiresAt: 4102444800 },
          error: null,
        })
      );

      for (const url of urls) {
        await attachmentService.resolveAttachmentUrl(url, null);
      }
      expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHED_URLS + 1);

      // The newest entry survived...
      await attachmentService.resolveAttachmentUrl(urls[urls.length - 1], null);
      expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHED_URLS + 1);

      // ...and the oldest was evicted, so it re-mints instead of growing the cache forever.
      await attachmentService.resolveAttachmentUrl(urls[0], null);
      expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHED_URLS + 2);
    });

    it('bounds the negative cache the same way', async () => {
      const urls = distinctStoredUrls(MAX_CACHED_URLS + 1);
      fetchMock.mockResolvedValue(
        jsonResponse(
          { success: false, data: null, error: 'The requested resource was not found.' },
          404
        )
      );

      for (const url of urls) {
        await expect(attachmentService.resolveAttachmentUrl(url, null)).rejects.toBeInstanceOf(
          AttachmentServiceApiError
        );
      }
      expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHED_URLS + 1);

      // The oldest failure was evicted, so it retries immediately rather than inheriting a
      // permanent negative entry from an unbounded map.
      await expect(attachmentService.resolveAttachmentUrl(urls[0], null)).rejects.toBeInstanceOf(
        AttachmentServiceApiError
      );
      expect(fetchMock).toHaveBeenCalledTimes(MAX_CACHED_URLS + 2);
    });

    it('throws when the sign endpoint rejects the request', async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          { success: false, data: null, error: 'The requested resource was not found.' },
          404
        )
      );

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).rejects.toBeInstanceOf(
        AttachmentServiceApiError
      );
    });

    it('rethrows transport failures without disguising them as unsupported URLs', async () => {
      const failure = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValue(failure);

      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).rejects.toBe(failure);
      // Negative-cached under the original error, so the retry window holds without a
      // second request.
      await expect(attachmentService.resolveAttachmentUrl(STORED_URL, null)).rejects.toBe(failure);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['', '   ', 'javascript:alert(1)', 'data:text/plain,hi', 'ftp://files.example.com/x'])(
      'rejects a minted URL of %p instead of caching the API root',
      async (mintedUrl) => {
        fetchMock.mockResolvedValue(
          jsonResponse({
            success: true,
            data: { url: mintedUrl, expiresAt: 4102444800 },
            error: null,
          })
        );

        await expect(
          attachmentService.resolveAttachmentUrl(STORED_URL, null)
        ).rejects.toBeInstanceOf(AttachmentServiceApiError);
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    );
  });

  describe('parseSignedUrlExpiry', () => {
    it('accepts epoch seconds and ISO instants', () => {
      expect(parseSignedUrlExpiry(1_700_000_000)).toBe(1_700_000_000_000);
      expect(parseSignedUrlExpiry('1700000000')).toBe(1_700_000_000_000);
      expect(parseSignedUrlExpiry('2030-01-01T00:00:00.000Z')).toBe(
        Date.parse('2030-01-01T00:00:00.000Z')
      );
    });

    it('marks values it cannot parse as 0 instead of pretending they are fresh', () => {
      expect(parseSignedUrlExpiry('not-a-date')).toBe(0);
      expect(parseSignedUrlExpiry('')).toBe(0);
      expect(parseSignedUrlExpiry(null)).toBe(0);
      expect(parseSignedUrlExpiry(undefined)).toBe(0);
    });
  });
});
