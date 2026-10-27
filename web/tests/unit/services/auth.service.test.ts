import { authApiService } from '../../../services/auth.service';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => jest.clearAllMocks());

const successBody = {
  success: true,
  data: {
    accessToken: 'tok',
    tokenType: 'Bearer',
    expiresIn: 3600,
    user: {
      id: '1',
      email: 'a@b.com',
      displayName: 'Alice',
      avatarUrl: null,
      emailVerified: false,
    },
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

it('login POSTs credentials and returns the auth response', async () => {
  mockFetch.mockReturnValue(makeResponse(successBody));
  const result = await authApiService.login({ email: 'a@b.com', password: 'pw' });
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/auth/login'),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ email: 'a@b.com', password: 'pw' }),
    })
  );
  expect(result).toEqual(successBody.data);
});

it('register POSTs to the correct endpoint', async () => {
  mockFetch.mockReturnValue(makeResponse(successBody));
  await authApiService.register({ email: 'a@b.com', displayName: 'Alice', password: 'pw' });
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/auth/register'),
    expect.objectContaining({ method: 'POST' })
  );
});

it('register forwards the invite token in the request body', async () => {
  mockFetch.mockReturnValue(makeResponse(successBody));
  await authApiService.register({
    email: 'a@b.com',
    displayName: 'Alice',
    password: 'pw',
    inviteToken: 'invite-token',
  });
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/auth/register'),
    expect.objectContaining({
      body: JSON.stringify({
        email: 'a@b.com',
        displayName: 'Alice',
        password: 'pw',
        inviteToken: 'invite-token',
      }),
    })
  );
});

it('previewInvite POSTs the token in the body, never the URL', async () => {
  mockFetch.mockReturnValue(
    makeResponse({
      success: true,
      data: {
        email: 'invitee@example.com',
        workspaceName: 'Acme',
        role: 'MEMBER',
        expiresAt: '2030-01-15T12:00:00Z',
      },
      error: null,
      message: null,
    })
  );

  const result = await authApiService.previewInvite('invite-token');

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/auth/invite/preview'),
    expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ token: 'invite-token' }),
    })
  );
  expect(mockFetch.mock.calls[0][0]).not.toContain('invite-token');
  expect(result.workspaceName).toBe('Acme');
});

it('getInstanceStatus reads the public instance probe', async () => {
  mockFetch.mockReturnValue(
    makeResponse({
      success: true,
      data: { initialized: false },
      error: null,
      message: null,
    })
  );

  const status = await authApiService.getInstanceStatus();

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/instance/status'),
    expect.objectContaining({ method: 'GET' })
  );
  expect(status.initialized).toBe(false);
});

it('refresh sends credentials:include so the HTTP-only cookie is forwarded', async () => {
  mockFetch.mockReturnValue(makeResponse(successBody));
  await authApiService.refresh();
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/auth/refresh'),
    expect.objectContaining({ credentials: 'include' })
  );
});

it('throws with body.error message when the request fails', async () => {
  mockFetch.mockReturnValue(
    makeResponse(
      { success: false, data: null, error: 'Invalid credentials', message: null },
      false,
      401
    )
  );
  await expect(authApiService.login({ email: 'a@b.com', password: 'bad' })).rejects.toThrow(
    'Invalid credentials'
  );
});

it('throws a status-based fallback message when body.error is absent', async () => {
  mockFetch.mockReturnValue(
    makeResponse({ success: false, data: null, error: null, message: null }, false, 500)
  );
  await expect(authApiService.login({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
    'Request failed with status 500'
  );
});

it('throws when body.success is false even on a 200 response', async () => {
  mockFetch.mockReturnValue(
    makeResponse({ success: false, data: null, error: 'Unexpected server error', message: null })
  );
  await expect(authApiService.login({ email: 'a@b.com', password: 'pw' })).rejects.toThrow(
    'Unexpected server error'
  );
});

it('logout attaches an Authorization: Bearer header when an access token is provided', async () => {
  mockFetch.mockReturnValue(
    makeResponse({ success: true, data: null, error: null, message: null })
  );
  await authApiService.logout('my-token');
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/auth/logout'),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer my-token' }),
    })
  );
});

it('logout omits the Authorization header when no access token is provided', async () => {
  mockFetch.mockReturnValue(
    makeResponse({ success: true, data: null, error: null, message: null })
  );
  await authApiService.logout();
  const [, init] = mockFetch.mock.calls[0];
  expect((init.headers as Record<string, string>)['Authorization']).toBeUndefined();
});
