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

it('PATCHes only the fields the owner changed', async () => {
  mockFetch.mockReturnValue(
    makeResponse({
      success: true,
      data: { ...successBody.data, name: 'Renamed' },
      error: null,
    })
  );

  await workspaceApiService.updateCurrent('token-1', {
    name: 'Renamed',
    icon: { type: null, value: null },
  });

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current'),
    expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-1',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ name: 'Renamed', icon: { type: null, value: null } }),
    })
  );
});

it('uploads a workspace icon as multipart form data', async () => {
  mockFetch.mockReturnValue(
    makeResponse({
      success: true,
      data: { id: 'attachment-1' },
      error: null,
    })
  );
  const file = new File(['x'], 'icon.png', { type: 'image/png' });

  const uploaded = await workspaceApiService.uploadIcon('token-1', file);

  expect(uploaded).toEqual({ id: 'attachment-1' });
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
  expect(init.headers).not.toHaveProperty('Content-Type');
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get('file')).toBe(file);
});
