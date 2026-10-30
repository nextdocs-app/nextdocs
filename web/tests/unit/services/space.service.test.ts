import { spaceApiService } from '../../../services/space.service';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => jest.clearAllMocks());

function makeResponse(body: object) {
  const responseMock = {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
  return Promise.resolve({
    ...responseMock,
    clone: () => responseMock,
  } as unknown as Response);
}

it('POSTs the neighbour ids to the per-user space move endpoint', async () => {
  const moved = { id: 'space-1', name: 'Design', orderKey: 'a0' };
  mockFetch.mockReturnValue(makeResponse({ success: true, data: moved, error: null }));

  const space = await spaceApiService.move('token-1', 'space-1', {
    prevSiblingId: 'space-2',
    nextSiblingId: null,
  });

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/spaces/space-1/move'),
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-1',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ prevSiblingId: 'space-2', nextSiblingId: null }),
    })
  );
  expect(space).toEqual(moved);
});
