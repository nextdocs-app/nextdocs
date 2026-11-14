import { describe, expect, it, jest } from '@jest/globals';
import { MAX_REINDEX_DOCS } from '../../src/config.js';
import { handleSearchReindex } from '../../src/search-reindex.js';

const documentId = '11111111-1111-4111-8111-111111111111';
const secondDocumentId = '22222222-2222-4222-8222-222222222222';

function request(body: unknown) {
  return {
    org: 'nextdocs',
    bytes: async () =>
      new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

describe('handleSearchReindex', () => {
  it.each([
    ['an empty batch', { docids: [] }, 'docids must contain between'],
    [
      'a batch over the limit',
      { docids: Array(MAX_REINDEX_DOCS + 1).fill(documentId) },
      'docids must contain between',
    ],
    ['a malformed document id', { docids: ['not-a-uuid'] }, 'docids must be document UUIDs'],
    ['an unparseable body', 'not-json', 'docids must contain between'],
  ])('rejects %s before reading anything', async (_label, body, message) => {
    const seen: string[] = [];

    await expect(
      handleSearchReindex(request(body), {
        readUpdate: async (docid) => {
          seen.push(docid);
          return null;
        },
        index: async () => {},
      })
    ).rejects.toThrow(message);
    expect(seen).toEqual([]);
  });

  it('indexes every readable document and counts the failures', async () => {
    const indexed: string[] = [];

    const result = await handleSearchReindex(request({ docids: [documentId, secondDocumentId] }), {
      readUpdate: async (docid) => {
        if (docid === secondDocumentId) {
          throw new Error('read failed');
        }
        return new Uint8Array([1, 2, 3]);
      },
      index: async (docid) => {
        indexed.push(docid);
      },
    });

    expect(result).toEqual({ status: 'ok', indexed: 1, failed: 1 });
    expect(indexed).toEqual([documentId]);
  });

  it('counts a rejected index write as a failed document', async () => {
    const result = await handleSearchReindex(request({ docids: [documentId] }), {
      readUpdate: async () => new Uint8Array([1]),
      index: async () => {
        throw new Error('content-updated failed');
      },
    });

    // The index dep only rejects when the projection was not written, so this document
    // must not be reported as repaired.
    expect(result).toEqual({ status: 'ok', indexed: 0, failed: 1 });
  });

  it('stamps the index write with the instant before the document is read', async () => {
    jest.useFakeTimers();
    try {
      jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
      let producedAt: string | undefined;

      await handleSearchReindex(request({ docids: [documentId] }), {
        readUpdate: async () => {
          // A slow read: a live compaction would stamp a newer producedAt in this window.
          jest.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
          return new Uint8Array([1]);
        },
        index: async (_docid, _update, stamp) => {
          producedAt = stamp;
        },
      });

      expect(producedAt).toBe('2026-01-01T00:00:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('stops at the batch budget and reports the rest as failed', async () => {
    const read: string[] = [];

    const result = await handleSearchReindex(
      request({ docids: [documentId, secondDocumentId] }),
      {
        readUpdate: async (docid) => {
          read.push(docid);
          return null;
        },
        index: async () => {},
      },
      0
    );

    // The API's client would already have given up; both ids stay stale for the next pass.
    expect(result).toEqual({ status: 'ok', indexed: 0, failed: 2 });
    expect(read).toEqual([]);
  });

  it('indexes a missing room as empty content instead of skipping it', async () => {
    let seen: Uint8Array | undefined;

    await handleSearchReindex(request({ docids: [documentId] }), {
      readUpdate: async () => null,
      index: async (_docid, update) => {
        seen = update;
      },
    });

    // An absent room is empty content per the document model. Passing null through would
    // skip the index write entirely and the crawl would select the document forever.
    expect(seen).toBeInstanceOf(Uint8Array);
    expect(seen?.length).toBe(0);
  });
});
