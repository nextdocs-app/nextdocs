import { workspaceApiService } from '../../../services/workspace.service';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => jest.clearAllMocks());

const successBody = {
  success: true,
  data: {
    id: 'workspace-1',
    name: 'Acme',
    icon: { type: 'emoji', value: '📚' },
    role: 'OWNER',
    memberCount: 3,
  },
  error: null,
  message: null,
};

function makeResponse(body: object, ok = true, status = 200) {
  const responseMock = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
  return Promise.resolve({
    ...responseMock,
    clone: () => responseMock,
  } as unknown as Response);
}

it('GETs the current workspace with the bearer token', async () => {
  mockFetch.mockReturnValue(makeResponse(successBody));

  const workspace = await workspaceApiService.getCurrent('token-1');

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current'),
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    })
  );
  expect(workspace).toEqual(successBody.data);
});

it('surfaces the API error instead of an empty workspace', async () => {
  mockFetch.mockReturnValue(
    makeResponse(
      { success: false, data: null, error: 'No workspace membership', message: null },
      false,
      404
    )
  );

  await expect(workspaceApiService.getCurrent('token-1')).rejects.toThrow(
    'No workspace membership'
  );
});
