import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { MAX_RECHECK_DOCS } from '../../src/config.js';
import { notifyContentUpdated, shouldNotifyContentUpdated } from '../../src/content-updated.js';
import { handleRecheck } from '../../src/server.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const otherDocumentId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';

function recheckRequest(
  body: unknown,
  recheck: (
    docRef: { org: string; docid: string; branch: string },
    opts: { users?: string[] | null }
  ) => Promise<void> = async () => {}
) {
  return {
    org: 'nextdocs',
    yhub: { recheckAuth: recheck },
    bytes: async () =>
      new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('handleRecheck', () => {
  it.each([
    ['an empty batch', { docids: [] }, 'docids must contain between'],
    [
      'a batch over the limit',
      { docids: Array(MAX_RECHECK_DOCS + 1).fill(documentId) },
      'docids must contain between',
    ],
    ['a malformed document id', { docids: ['not-a-uuid'] }, 'docids must be document UUIDs'],
    [
      'a malformed user id',
      { docids: [documentId], users: ['not-a-uuid'] },
      'users must be user UUIDs',
    ],
    ['an unparseable body', 'not-json', 'docids must contain between'],
  ])('rejects %s before rechecking anything', async (_label, body, message) => {
    const seen: string[] = [];

    await expect(
      handleRecheck(
        recheckRequest(body, async (docRef) => {
          seen.push(docRef.docid);
        })
      )
    ).rejects.toThrow(message);
    expect(seen).toEqual([]);
  });

  it('treats an empty users list as match-all instead of a silent no-op', async () => {
    let seenUsers: string[] | null | undefined;
    const request = recheckRequest({ docids: [documentId], users: [] }, async (_docRef, opts) => {
      seenUsers = opts.users;
    });

    await expect(handleRecheck(request)).resolves.toEqual({ status: 'ok', rechecked: 1 });
    expect(seenUsers).toBeNull();
  });

  it('passes a non-empty user filter through', async () => {
    let seenUsers: string[] | null | undefined;
    const request = recheckRequest(
      { docids: [documentId], users: [userId] },
      async (_docRef, opts) => {
        seenUsers = opts.users;
      }
    );

    await handleRecheck(request);
    expect(seenUsers).toEqual([userId]);
  });

  it('rechecks every room in the batch with the main branch', async () => {
    const seen: Array<{ docid: string; branch: string }> = [];
    const request = recheckRequest({ docids: [documentId, otherDocumentId] }, async (docRef) => {
      seen.push({ docid: docRef.docid, branch: docRef.branch });
    });

    await expect(handleRecheck(request)).resolves.toEqual({ status: 'ok', rechecked: 2 });
    expect(seen.sort((a, b) => a.docid.localeCompare(b.docid))).toEqual(
      [
        { docid: documentId, branch: 'main' },
        { docid: otherDocumentId, branch: 'main' },
      ].sort((a, b) => a.docid.localeCompare(b.docid))
    );
  });

  it('rechecks a large batch in parallel instead of serially', async () => {
    const docids = Array.from(
      { length: 4 },
      (_, index) => `${String(index + 1).repeat(8)}-0000-4000-8000-000000000000`
    );
    let inFlight = 0;
    let maxInFlight = 0;

    const request = recheckRequest({ docids }, async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
    });

    await expect(handleRecheck(request)).resolves.toEqual({ status: 'ok', rechecked: 4 });
    // Serial rechecks leave this at 1; the gate's whole point is more than that.
    expect(maxInFlight).toBeGreaterThan(1);
  });

  it('continues past a failed room and answers 503 for the partial batch', async () => {
    const seen: string[] = [];
    const request = recheckRequest({ docids: [documentId, otherDocumentId] }, async (docRef) => {
      seen.push(docRef.docid);
      if (docRef.docid === documentId) {
        throw new Error('room is wedged');
      }
    });

    await expect(handleRecheck(request)).rejects.toThrow('Failed to re-check 1 of 2 document(s)');
    expect(seen).toEqual([documentId, otherDocumentId]);
  });
});

describe('notifyContentUpdated', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function reply(status: number): Response {
    return { ok: status >= 200 && status < 300, status } as Response;
  }

  it('retries a 5xx and stops once an attempt succeeds', async () => {
    const statuses = [503, 200];
    global.fetch = jest.fn(async () => reply(statuses.shift() ?? 200)) as unknown as typeof fetch;

    await notifyContentUpdated(documentId);

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a contract error', async () => {
    global.fetch = jest.fn(async () => reply(400)) as unknown as typeof fetch;

    await notifyContentUpdated(documentId);

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a 429 and a network error', async () => {
    let call = 0;
    global.fetch = jest.fn(async () => {
      call += 1;
      if (call === 1) {
        throw new TypeError('fetch failed');
      }
      return reply(call === 2 ? 429 : 200);
    }) as unknown as typeof fetch;

    await notifyContentUpdated(documentId);

    expect(global.fetch).toHaveBeenCalledTimes(3);
  });
});

describe('shouldNotifyContentUpdated', () => {
  it('accepts only this organization, the main branch, and a UUID', () => {
    expect(shouldNotifyContentUpdated({ org: 'nextdocs', docid: documentId, branch: 'main' })).toBe(
      true
    );
    expect(shouldNotifyContentUpdated({ org: 'other', docid: documentId, branch: 'main' })).toBe(
      false
    );
    expect(
      shouldNotifyContentUpdated({ org: 'nextdocs', docid: documentId, branch: 'draft' })
    ).toBe(false);
    expect(
      shouldNotifyContentUpdated({ org: 'nextdocs', docid: 'not-a-uuid', branch: 'main' })
    ).toBe(false);
  });
});
