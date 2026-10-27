import { ApiError, apiRequest } from '../../../services/api-client';

const mockFetch = jest.fn();

beforeAll(() => {
  global.fetch = mockFetch;
});

beforeEach(() => jest.clearAllMocks());

function makeResponse(
  body: object | string,
  { ok = true, status = 200, statusText = 'OK', rejectJson = false } = {}
) {
  const response = {
    ok,
    status,
    statusText,
    json: () =>
      rejectJson
        ? Promise.reject(new SyntaxError('Unexpected token <'))
        : Promise.resolve(body as object),
    text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
  };
  return {
    ...response,
    clone: () => response,
  } as unknown as Response;
}

const successBody = { success: true, data: { id: '1' }, error: null };

it('sends the refresh cookie and JSON content type', async () => {
  mockFetch.mockReturnValue(Promise.resolve(makeResponse(successBody)));

  await apiRequest('/api/v1/example', { method: 'POST', body: JSON.stringify({ a: 1 }) });

  expect(mockFetch).toHaveBeenCalledWith(
    expect.stringContaining('/api/v1/example'),
    expect.objectContaining({
      method: 'POST',
      credentials: 'include',
      headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
    })
  );
});

it('omits the JSON content type on a request with no body', async () => {
  // A body-less GET promising JSON is not a simple request: it would trigger a
  // CORS preflight on every probe, so the header stays off until there is a body.
  mockFetch.mockReturnValue(Promise.resolve(makeResponse(successBody)));

  await apiRequest('/api/v1/instance/status', { method: 'GET' });

  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  expect(init.headers).not.toHaveProperty('Content-Type');
});

it('unwraps the envelope data', async () => {
  mockFetch.mockReturnValue(Promise.resolve(makeResponse(successBody)));

  await expect(apiRequest('/api/v1/example')).resolves.toEqual({ id: '1' });
});

it('returns undefined for an empty 204 only when allowed', async () => {
  mockFetch.mockReturnValue(Promise.resolve(makeResponse({}, { status: 204 })));

  await expect(
    apiRequest('/api/v1/example', { method: 'POST' }, { allowEmptyData: true })
  ).resolves.toBeUndefined();
});

it('accepts a null data payload when empty data is allowed', async () => {
  mockFetch.mockReturnValue(
    Promise.resolve(makeResponse({ success: true, data: null, error: null }))
  );

  await expect(
    apiRequest('/api/v1/example', {}, { allowEmptyData: true })
  ).resolves.toBeUndefined();
});

it('throws the envelope error on a failed request', async () => {
  mockFetch.mockReturnValue(
    Promise.resolve(
      makeResponse(
        { success: false, data: null, error: 'Invalid credentials' },
        { ok: false, status: 401 }
      )
    )
  );

  await expect(apiRequest('/api/v1/example')).rejects.toMatchObject({
    name: 'ApiError',
    message: 'Invalid credentials',
    status: 401,
  });
});

it('falls back to the HTTP status when the envelope has no error', async () => {
  mockFetch.mockReturnValue(
    Promise.resolve(
      makeResponse(
        { success: false, data: null, error: null },
        { ok: false, status: 500, statusText: 'Server Error' }
      )
    )
  );

  await expect(apiRequest('/api/v1/example')).rejects.toThrow('Request failed with status 500');
});

it('reports the raw body when a diagnostic request cannot be parsed', async () => {
  mockFetch.mockReturnValue(
    Promise.resolve(makeResponse('<html>gateway</html>', { rejectJson: true }))
  );

  await expect(
    apiRequest('/api/v1/example', {}, { includeRawBodyOnParseError: true })
  ).rejects.toThrow('Raw body: <html>gateway</html>');
});

it('marks every failure as an ApiError', async () => {
  mockFetch.mockReturnValue(
    Promise.resolve(makeResponse({ success: false, data: null, error: 'Nope' }, { ok: false }))
  );

  await expect(apiRequest('/api/v1/example')).rejects.toBeInstanceOf(ApiError);
});
