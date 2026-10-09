import React from 'react';
import { renderHook } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import toastsReducer from '@/stores/toasts/toasts.slice';
import type { DocumentAccessLevel } from '@/services/document.service';
import {
  attachmentService,
  AttachmentServiceApiError,
  UnsupportedUrlError,
  type UploadedAttachment,
} from '@/services/attachment.service';
import {
  UploadQueueCancelledError,
  createCancellableLimiter,
  createSingleFlight,
  describeUploadError,
  useAttachmentHandlers,
  withRefreshedToken,
  withRefreshedTokenAllowingAnonymous,
  type AttachmentHandlerDeps,
} from '@/components/editor/useAttachmentHandlers';

const STORED_URL = '/api/v1/attachments/11111111-2222-4333-8444-555555555555';

function unauthorized(): AttachmentServiceApiError {
  return new AttachmentServiceApiError('Unauthorized', 401);
}

function uploadedAttachment(documentId: string): UploadedAttachment {
  return {
    id: 'attachment-1',
    documentId,
    fileName: 'a.png',
    contentType: 'image/png',
    sizeBytes: 3,
    url: STORED_URL,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

const BASE_DEPS: AttachmentHandlerDeps = {
  documentId: 'doc-a',
  isAuthenticated: true,
  accessToken: 'token',
  isOnline: true,
  accessLevel: 'EDIT' as DocumentAccessLevel,
  deletedAt: null,
};

function createHarness() {
  const store = configureStore({ reducer: { toasts: toastsReducer } });
  const dispatchSpy = jest.spyOn(store, 'dispatch');
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    // eslint-disable-next-line react/no-children-prop -- a .ts file cannot use JSX; children-as-prop is the typed equivalent
    React.createElement(Provider, { store, children });
  return { dispatchSpy, wrapper };
}

function toastCalls(dispatchSpy: { mock: { calls: unknown[][] } }) {
  return dispatchSpy.mock.calls.filter(
    (call) => (call[0] as { type?: string } | undefined)?.type === 'toasts/addToast'
  );
}

describe('withRefreshedToken', () => {
  it('returns the first attempt without refreshing', async () => {
    const refresh = jest.fn(async () => 'new-token');

    await expect(
      withRefreshedToken(
        async () => 'ok',
        () => 'token',
        refresh
      )
    ).resolves.toBe('ok');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('passes non-401 errors through without refreshing', async () => {
    const failure = new AttachmentServiceApiError('Boom', 500);
    const refresh = jest.fn(async () => 'new-token');
    const run = jest.fn(async () => {
      throw failure;
    });

    await expect(withRefreshedToken(run, () => 'token', refresh)).rejects.toBe(failure);
    expect(refresh).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries once with the refreshed token after a 401', async () => {
    const run = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValue('retried');
    const refresh = jest.fn(async () => 'new-token');

    await expect(withRefreshedToken(run, () => 'stale-token', refresh)).resolves.toBe('retried');
    expect(run).toHaveBeenNthCalledWith(1, 'stale-token');
    expect(run).toHaveBeenNthCalledWith(2, 'new-token');
  });

  it('rethrows the original 401 when the refresh yields no token', async () => {
    const original = unauthorized();
    const run = jest.fn(async () => {
      throw original;
    });

    await expect(
      withRefreshedToken(
        run,
        () => 'stale-token',
        async () => null
      )
    ).rejects.toBe(original);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('rethrows the retry failure instead of the original 401', async () => {
    const retryFailure = new AttachmentServiceApiError('Forbidden', 403);
    const run = jest
      .fn<Promise<string>, [string]>()
      .mockRejectedValueOnce(unauthorized())
      .mockRejectedValue(retryFailure);

    await expect(
      withRefreshedToken(
        run,
        () => 'stale-token',
        async () => 'new-token'
      )
    ).rejects.toBe(retryFailure);
  });

  it('throws without running when no token is available', async () => {
    const run = jest.fn(async () => 'ok');
    const refresh = jest.fn(async () => 'new-token');

    await expect(withRefreshedToken(run, () => null, refresh)).rejects.toThrow(/access token/i);
    expect(run).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('allows an anonymous first attempt and still refreshes after a 401', async () => {
    const run = jest
      .fn<Promise<string>, [string | null]>()
      .mockRejectedValueOnce(unauthorized())
      .mockResolvedValue('retried');
    const refresh = jest.fn(async () => 'new-token');

    await expect(withRefreshedTokenAllowingAnonymous(run, () => null, refresh)).resolves.toBe(
      'retried'
    );
    expect(run).toHaveBeenNthCalledWith(1, null);
    expect(run).toHaveBeenNthCalledWith(2, 'new-token');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('rethrows the original 401 when an anonymous refresh yields no token', async () => {
    const original = unauthorized();
    const run = jest.fn(async () => {
      throw original;
    });

    await expect(
      withRefreshedTokenAllowingAnonymous(
        run,
        () => null,
        async () => null
      )
    ).rejects.toBe(original);
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('createCancellableLimiter', () => {
  it('runs up to the limit concurrently and queues the rest', async () => {
    const limiter = createCancellableLimiter(2, 10);
    let running = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const task = () =>
      limiter.limit(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => gates.push(resolve));
        running -= 1;
        return peak;
      });

    const first = task();
    const second = task();
    const third = task();
    await Promise.resolve();
    await Promise.resolve();
    expect(peak).toBe(2);

    gates.shift()?.();
    await first;
    await Promise.resolve();
    await Promise.resolve();
    // The queued third task started only after a slot freed.
    expect(peak).toBe(2);

    gates.shift()?.();
    gates.shift()?.();
    await expect(Promise.all([second, third])).resolves.toEqual([2, 2]);
  });

  it('releases the slot when a task fails so the queue still drains', async () => {
    const limiter = createCancellableLimiter(1, 10);
    const first = limiter.limit(async () => {
      throw new Error('upload failed');
    });
    const second = limiter.limit(async () => 'second');

    await expect(first).rejects.toThrow('upload failed');
    await expect(second).resolves.toBe('second');
  });

  it('rejects a task that would exceed the queued bound instead of parking it', async () => {
    const limiter = createCancellableLimiter(1, 2);
    const inFlight = limiter.limit(() => new Promise<string>(() => {}));
    const queued = [limiter.limit(async () => 'a'), limiter.limit(async () => 'b')];
    for (const promise of queued) {
      promise.catch(() => undefined);
    }

    await expect(limiter.limit(async () => 'overflow')).rejects.toThrow(/queued to upload/i);

    limiter.cancelAll();
    inFlight.catch(() => undefined);
  });

  it('cancelAll rejects every queued waiter without disturbing the in-flight task', async () => {
    const limiter = createCancellableLimiter(1, 5);
    const inFlight = limiter.limit(async () => 'first');
    const queued = [limiter.limit(async () => 'a'), limiter.limit(async () => 'b')];
    for (const promise of queued) {
      promise.catch(() => undefined);
    }

    limiter.cancelAll();

    await expect(queued[0]).rejects.toBeInstanceOf(UploadQueueCancelledError);
    await expect(queued[1]).rejects.toBeInstanceOf(UploadQueueCancelledError);
    await expect(inFlight).resolves.toBe('first');
  });
});

describe('createSingleFlight', () => {
  it('shares one in-flight call between concurrent callers', async () => {
    let resolveRun: (value: string) => void = () => {};
    const run = jest.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveRun = resolve;
        })
    );
    const call = createSingleFlight(run);

    const first = call();
    const second = call();

    expect(run).toHaveBeenCalledTimes(1);
    resolveRun('value');
    await expect(Promise.all([first, second])).resolves.toEqual(['value', 'value']);
  });

  it('starts a fresh call once the previous one has settled', async () => {
    const run = jest.fn(async () => 'value');
    const call = createSingleFlight(run);

    await call();
    await call();

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('shares a rejection without wedging the next call', async () => {
    const failure = new Error('boom');
    const run = jest.fn().mockRejectedValueOnce(failure).mockResolvedValue('ok');
    const call = createSingleFlight(run);

    await expect(call()).rejects.toBe(failure);
    await expect(call()).resolves.toBe('ok');
  });
});

describe('describeUploadError', () => {
  it('explains a 401 as an expired session', () => {
    expect(describeUploadError(new AttachmentServiceApiError('Unauthorized', 401), 'a.png')).toBe(
      'Your session expired. Sign in again to upload files.'
    );
  });

  it('explains a 403 as a permission problem', () => {
    expect(describeUploadError(new AttachmentServiceApiError('Forbidden', 403), 'a.png')).toBe(
      "You don't have permission to upload files to this document."
    );
  });

  it('explains a 404 as a sync or access change', () => {
    expect(describeUploadError(new AttachmentServiceApiError('Not found', 404), 'a.png')).toContain(
      'may not have finished syncing'
    );
  });

  it('surfaces the server message for a 413 quota or size failure', () => {
    expect(
      describeUploadError(new AttachmentServiceApiError('File exceeds the limit.', 413), 'big.zip')
    ).toBe('big.zip was not uploaded: File exceeds the limit.');
  });

  it('falls back to a size message for a blank 413', () => {
    expect(describeUploadError(new AttachmentServiceApiError('', 413), 'big.zip')).toContain(
      "server's upload limit"
    );
  });

  it('surfaces the server message for unexpected API failures', () => {
    expect(describeUploadError(new AttachmentServiceApiError('Boom', 500), 'a.png')).toBe('Boom');
  });

  it('falls back to a generic message for transport failures', () => {
    expect(describeUploadError(new TypeError('Failed to fetch'), 'a.png')).toBe(
      'Upload failed. Please try again.'
    );
  });
});

describe('useAttachmentHandlers', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not call the API or toast when resolving offline', async () => {
    const { dispatchSpy, wrapper } = createHarness();
    const resolveSpy = jest.spyOn(attachmentService, 'resolveAttachmentUrl');
    const { result } = renderHook((props: AttachmentHandlerDeps) => useAttachmentHandlers(props), {
      wrapper,
      initialProps: { ...BASE_DEPS, isOnline: false },
    });

    await expect(result.current.resolveFileUrl(STORED_URL)).rejects.toThrow(/connection/i);

    expect(resolveSpy).not.toHaveBeenCalled();
    expect(toastCalls(dispatchSpy)).toHaveLength(0);
  });

  it('rejects a queued upload when the document changes before its turn', async () => {
    const { wrapper } = createHarness();
    const resolvers: Array<(attachment: UploadedAttachment) => void> = [];
    const uploadSpy = jest
      .spyOn(attachmentService, 'uploadAttachment')
      .mockImplementation(
        () => new Promise<UploadedAttachment>((resolve) => resolvers.push(resolve))
      );
    const { result, rerender } = renderHook(
      (props: AttachmentHandlerDeps) => useAttachmentHandlers(props),
      { wrapper, initialProps: BASE_DEPS }
    );

    const uploads = Array.from({ length: 5 }, (_unused, index) =>
      result.current.uploadFile(new File(['x'], `f-${index}.png`))
    );
    // Four run at once; the fifth waits for a slot.
    uploads.forEach((promise) => promise.catch(() => undefined));

    rerender({ ...BASE_DEPS, documentId: 'doc-b' });
    resolvers[0](uploadedAttachment('doc-a'));

    await expect(uploads[4]).rejects.toThrow(/document you have left/i);
    expect(uploadSpy).toHaveBeenCalledTimes(4);
  });

  it('rejects an upload result that is not the stored attachment path', async () => {
    const { dispatchSpy, wrapper } = createHarness();
    jest.spyOn(attachmentService, 'uploadAttachment').mockResolvedValue({
      ...uploadedAttachment('doc-a'),
      url: 'https://evil.example.com/api/v1/attachments/11111111-2222-4333-8444-555555555555',
    });
    const { result } = renderHook((props: AttachmentHandlerDeps) => useAttachmentHandlers(props), {
      wrapper,
      initialProps: BASE_DEPS,
    });

    await expect(result.current.uploadFile(new File(['x'], 'x.png'))).rejects.toThrow(
      /cannot be stored safely/i
    );
    expect(toastCalls(dispatchSpy)).toHaveLength(1);
  });

  it('toasts and rejects when the upload queue is full', async () => {
    const { dispatchSpy, wrapper } = createHarness();
    jest
      .spyOn(attachmentService, 'uploadAttachment')
      .mockImplementation(() => new Promise<UploadedAttachment>(() => {}));
    const { result, unmount } = renderHook(
      (props: AttachmentHandlerDeps) => useAttachmentHandlers(props),
      { wrapper, initialProps: BASE_DEPS }
    );

    // Four run at once and twenty queue; the twenty-fifth and twenty-sixth are refused
    // outright, each reporting its own failure.
    const uploads = Array.from({ length: 26 }, (_unused, index) =>
      result.current.uploadFile(new File(['x'], `f-${index}.png`))
    );
    uploads.forEach((promise) => promise.catch(() => undefined));

    await expect(uploads[24]).rejects.toThrow(/queued to upload/i);
    await expect(uploads[25]).rejects.toThrow(/queued to upload/i);
    expect(toastCalls(dispatchSpy)).toHaveLength(2);

    unmount();
  });

  it('settles queued uploads on unmount without toasting', async () => {
    const { dispatchSpy, wrapper } = createHarness();
    jest
      .spyOn(attachmentService, 'uploadAttachment')
      .mockImplementation(() => new Promise<UploadedAttachment>(() => {}));
    const { result, unmount } = renderHook(
      (props: AttachmentHandlerDeps) => useAttachmentHandlers(props),
      { wrapper, initialProps: BASE_DEPS }
    );

    const uploads = Array.from({ length: 6 }, (_unused, index) =>
      result.current.uploadFile(new File(['x'], `f-${index}.png`))
    );
    uploads.forEach((promise) => promise.catch(() => undefined));

    unmount();

    // The two queued files reject quietly; a toast here would land on the next page.
    await expect(uploads[4]).rejects.toBeInstanceOf(UploadQueueCancelledError);
    await expect(uploads[5]).rejects.toBeInstanceOf(UploadQueueCancelledError);
    expect(toastCalls(dispatchSpy)).toHaveLength(0);
  });

  it('bounds the remembered resolve errors so broken URLs cannot grow the map forever', async () => {
    const { dispatchSpy, wrapper } = createHarness();
    jest
      .spyOn(attachmentService, 'resolveAttachmentUrl')
      .mockRejectedValue(new AttachmentServiceApiError('nope', 404));
    const { result } = renderHook((props: AttachmentHandlerDeps) => useAttachmentHandlers(props), {
      wrapper,
      initialProps: BASE_DEPS,
    });

    const urls = Array.from(
      { length: 201 },
      (_unused, index) => `https://a${index}.example.com/broken`
    );
    for (const url of urls) {
      await expect(result.current.resolveFileUrl(url)).rejects.toBeInstanceOf(
        AttachmentServiceApiError
      );
    }
    expect(toastCalls(dispatchSpy)).toHaveLength(201);

    // The oldest entry was evicted, so its next failure toasts again instead of being
    // suppressed by a map that would otherwise grow with every distinct URL.
    await expect(result.current.resolveFileUrl(urls[0])).rejects.toBeInstanceOf(
      AttachmentServiceApiError
    );
    expect(toastCalls(dispatchSpy)).toHaveLength(202);
  });

  it('rejects blob: URLs without reaching the network', async () => {
    const { dispatchSpy, wrapper } = createHarness();
    const resolveSpy = jest.spyOn(attachmentService, 'resolveAttachmentUrl');
    const { result } = renderHook((props: AttachmentHandlerDeps) => useAttachmentHandlers(props), {
      wrapper,
      initialProps: BASE_DEPS,
    });

    await expect(result.current.resolveFileUrl('blob:http://localhost/abc')).rejects.toBeInstanceOf(
      UnsupportedUrlError
    );
    expect(resolveSpy).toHaveBeenCalledWith('blob:http://localhost/abc', 'token');
    // The service rejects it (no fetch), and the hook reports one unsupported-URL notice.
    expect(toastCalls(dispatchSpy)).toHaveLength(1);
    expect(toastCalls(dispatchSpy)[0][0]).toMatchObject({
      payload: expect.objectContaining({ message: expect.stringContaining('unsupported') }),
    });
  });

  it('reports transport failures as generic load errors, not unsupported URLs', async () => {
    const { dispatchSpy, wrapper } = createHarness();
    jest
      .spyOn(attachmentService, 'resolveAttachmentUrl')
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook((props: AttachmentHandlerDeps) => useAttachmentHandlers(props), {
      wrapper,
      initialProps: BASE_DEPS,
    });

    await expect(result.current.resolveFileUrl(STORED_URL)).rejects.toBeInstanceOf(TypeError);
    expect(toastCalls(dispatchSpy)).toHaveLength(1);
    expect(toastCalls(dispatchSpy)[0][0]).toMatchObject({
      payload: expect.objectContaining({ message: expect.stringContaining('could not be loaded') }),
    });
  });
});
