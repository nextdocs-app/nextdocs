import { commentAnchorService } from '../../../services/comment-anchor.service';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function reply(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const selection = {
  anchor: { item: { client: 1, clock: 2 }, tname: null, assoc: 0 },
  head: { item: { client: 1, clock: 9 }, tname: null, assoc: 0 },
};

describe('commentAnchorService', () => {
  it('posts the thread id and Yjs selection to the realtime anchor endpoint', async () => {
    const fetchMock = jest.fn(async () => reply(200, { status: 'ok' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await commentAnchorService.add('doc-1', 'token-1', 'thread-1', selection);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/api/anchor/v1/nextdocs/doc-1',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: 'Bearer token-1',
        },
      })
    );

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({
      threadId: 'thread-1',
      selection,
    });
  });

  it('omits the Authorization header for a share-link guest', async () => {
    const fetchMock = jest.fn(async () => reply(200, { status: 'ok' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await commentAnchorService.add('doc-1', null, 'thread-1', selection);

    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toEqual({
      'Content-Type': 'application/json',
      Accept: 'application/json',
    });
  });

  it('deletes an orphaned anchor by thread id', async () => {
    const fetchMock = jest.fn(async () => reply(200, { status: 'ok' }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await commentAnchorService.remove('doc-1', 'token-1', 'thread-1');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:1234/api/anchor/v1/nextdocs/doc-1?threadId=thread-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer token-1',
        },
      })
    );
  });

  it('turns a rejected request into an ApiError with the server message', async () => {
    global.fetch = jest.fn(async () =>
      reply(409, { error: 'Selection no longer exists' })
    ) as unknown as typeof fetch;

    await expect(
      commentAnchorService.add('doc-1', 'token-1', 'thread-1', selection)
    ).rejects.toMatchObject({
      message: 'Selection no longer exists',
      status: 409,
    });
  });

  it('falls back to a status message when the body is not JSON', async () => {
    global.fetch = jest.fn(async () => {
      return {
        ok: false,
        status: 503,
        json: async () => {
          throw new SyntaxError('not json');
        },
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await expect(commentAnchorService.remove('doc-1', null, 'thread-1')).rejects.toMatchObject({
      message: 'Failed to remove comment anchor (503)',
      status: 503,
    });
  });
});
