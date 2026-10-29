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

const member = {
  userId: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada',
  avatarUrl: null,
  role: 'OWNER',
  joinedAt: '2026-01-05T10:00:00Z',
};

it('lists the roster with the bearer token', async () => {
  mockFetch.mockReturnValue(makeResponse({ success: true, data: [member], error: null }));

  const members = await workspaceApiService.listMembers('token-1');

  expect(members).toEqual([member]);
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current/members'),
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    })
  );
});

it('PATCHes a member role and returns the recalculated roster', async () => {
  const roster = [{ ...member, role: 'ADMIN' }];
  mockFetch.mockReturnValue(makeResponse({ success: true, data: roster, error: null }));

  await workspaceApiService.updateMemberRole('token-1', 'user-1', 'ADMIN');

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current/members/user-1'),
    expect.objectContaining({
      method: 'PATCH',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-1',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({ role: 'ADMIN' }),
    })
  );
});

it('DELETEs a member and returns the recalculated roster', async () => {
  mockFetch.mockReturnValue(makeResponse({ success: true, data: [member], error: null }));

  const roster = await workspaceApiService.removeMember('token-1', 'user-2');

  expect(roster).toEqual([member]);
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current/members/user-2'),
    expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    })
  );
});

it('requests pending invites with paging and newest-first sorting', async () => {
  const invitePage = {
    content: [
      {
        id: 'invite-1',
        email: 'new@example.com',
        role: 'MEMBER',
        expiresAt: '2026-11-30T00:00:00Z',
        createdAt: '2026-10-30T00:00:00Z',
      },
    ],
    totalElements: 1,
    totalPages: 1,
    size: 20,
    number: 0,
    first: true,
    last: true,
  };
  mockFetch.mockReturnValue(makeResponse({ success: true, data: invitePage, error: null }));

  const invites = await workspaceApiService.listInvites('token-1', 0, 20);

  expect(invites).toEqual(invitePage);
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining(
      '/api/v1/workspaces/current/invites?page=0&size=20&sort=createdAt%2Cdesc'
    ),
    expect.objectContaining({
      method: 'GET',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    })
  );
});

it('creates invites with one role for the submitted addresses', async () => {
  const results = [
    { email: 'new@example.com', status: 'INVITED', invite: null },
    { email: 'old@example.com', status: 'ALREADY_MEMBER', invite: null },
  ];
  mockFetch.mockReturnValue(makeResponse({ success: true, data: results, error: null }));

  const created = await workspaceApiService.createInvites(
    'token-1',
    ['new@example.com', 'old@example.com'],
    'ADMIN'
  );

  expect(created).toEqual(results);
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current/invites'),
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        Authorization: 'Bearer token-1',
        'Content-Type': 'application/json',
      }),
      body: JSON.stringify({
        emails: ['new@example.com', 'old@example.com'],
        role: 'ADMIN',
      }),
    })
  );
});

it('resends an invite through its resend endpoint', async () => {
  const rotated = {
    id: 'invite-1',
    email: 'new@example.com',
    role: 'MEMBER',
    expiresAt: '2026-12-15T00:00:00Z',
  };
  mockFetch.mockReturnValue(makeResponse({ success: true, data: rotated, error: null }));

  const created = await workspaceApiService.resendInvite('token-1', 'invite-1');

  expect(created).toEqual(rotated);
  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current/invites/invite-1/resend'),
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    })
  );
});

it('revokes an invite and accepts the empty 204 response', async () => {
  mockFetch.mockReturnValue(makeResponse({}, true, 204));

  await expect(workspaceApiService.revokeInvite('token-1', 'invite-1')).resolves.toBeUndefined();

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/workspaces/current/invites/invite-1'),
    expect.objectContaining({
      method: 'DELETE',
      headers: expect.objectContaining({ Authorization: 'Bearer token-1' }),
    })
  );
});
