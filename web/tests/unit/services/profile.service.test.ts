import { profileApiService } from '../../../services/profile.service';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => jest.clearAllMocks());

const account = {
  id: 'user-1',
  email: 'ada@example.com',
  displayName: 'Ada Lovelace',
  avatarUrl: '/api/v1/users/user-1/avatar?v=abc123',
};

function res(body: object, ok = true, status = 200) {
  const response = {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
  return Promise.resolve({ ...response, clone: () => response } as unknown as Response);
}

function envelope(data: object) {
  return { success: true, data, error: null, message: null };
}

it('reads the signed-in account with the bearer token', async () => {
  mockFetch.mockReturnValue(res(envelope(account)));

  const result = await profileApiService.get('tok');

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/users/me'),
    expect.objectContaining({ method: 'GET', headers: { Authorization: 'Bearer tok' } })
  );
  expect(result).toEqual(account);
});

it('renames through PATCH with a JSON body', async () => {
  mockFetch.mockReturnValue(res(envelope({ ...account, displayName: 'Ada Lovelace' })));

  const result = await profileApiService.updateDisplayName('tok', 'Ada   Lovelace');

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/users/me'),
    expect.objectContaining({
      method: 'PATCH',
      headers: { Authorization: 'Bearer tok', 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: 'Ada   Lovelace' }),
    })
  );
  expect(result.displayName).toBe('Ada Lovelace');
});

it('uploads the photo as multipart form data under the server field name', async () => {
  mockFetch.mockReturnValue(res(envelope(account)));
  const file = new File(['png'], 'portrait.webp', { type: 'image/webp' });

  const result = await profileApiService.uploadAvatar('tok', file);

  const [, init] = mockFetch.mock.calls[0];
  expect(mockFetch.mock.calls[0][0]).toContain('/api/v1/users/me/avatar');
  // A PUT replaces the photo, so the same account can never hold two.
  expect(init.method).toBe('PUT');
  expect(init.headers).toEqual({ Authorization: 'Bearer tok' });
  // The browser must set the multipart boundary itself, so no Content-Type is sent.
  expect(init.body).toBeInstanceOf(FormData);
  expect((init.body as FormData).get('file')).toBe(file);
  expect(result).toEqual(account);
});

it('removes the photo with DELETE', async () => {
  mockFetch.mockReturnValue(res(envelope({ ...account, avatarUrl: null })));

  const result = await profileApiService.removeAvatar('tok');

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/users/me/avatar'),
    expect.objectContaining({ method: 'DELETE', headers: { Authorization: 'Bearer tok' } })
  );
  expect(result.avatarUrl).toBeNull();
});

it('surfaces the envelope error text when a rename is refused', async () => {
  // The API puts a readable sentence in `error` and the error code or detail in
  // `message`; the panel shows the former, so that is what must reach the caller.
  mockFetch.mockReturnValue(
    res(
      {
        success: false,
        data: null,
        error: 'Please check the values you entered.',
        message: 'displayName: size must be between 1 and 100',
      },
      false,
      400
    )
  );

  await expect(profileApiService.updateDisplayName('tok', 'x')).rejects.toThrow(
    'Please check the values you entered.'
  );
});
