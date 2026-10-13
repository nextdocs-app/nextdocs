'use client';

import { act, renderHook } from '@testing-library/react';
import { attachmentService } from '../../../services/attachment.service';
import { usePageImageUpload } from '../../../hooks/usePageImageUpload.hook';

jest.mock('../../../services/attachment.service', () => ({
  attachmentService: {
    uploadAttachment: jest.fn(),
    resolveAttachmentUrl: jest.fn(),
  },
}));

const uploadMock = attachmentService.uploadAttachment as jest.Mock;
const png = new File(['x'], 'icon.png', { type: 'image/png' });

describe('usePageImageUpload', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refuses to upload without a session', async () => {
    const { result } = renderHook(() =>
      usePageImageUpload({ documentId: 'doc-1', accessToken: null })
    );

    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.upload(png);
    });

    expect(uploaded).toBeNull();
    expect(result.current.error).toBe('Sign in to upload an image.');
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('rejects a non-image file before any network request', async () => {
    const { result } = renderHook(() =>
      usePageImageUpload({ documentId: 'doc-1', accessToken: 'token' })
    );

    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.upload(new File(['x'], 'notes.txt', { type: 'text/plain' }));
    });

    expect(uploaded).toBeNull();
    expect(result.current.error).toMatch(/PNG, JPEG, GIF, WebP or AVIF/);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('returns the uploaded attachment on success', async () => {
    const attachment = { id: '11111111-2222-4333-8444-555555555555' };
    uploadMock.mockResolvedValue(attachment);
    const { result } = renderHook(() =>
      usePageImageUpload({ documentId: 'doc-1', accessToken: 'token' })
    );

    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.upload(png);
    });

    expect(uploaded).toBe(attachment);
    expect(result.current.error).toBeNull();
    expect(result.current.isUploading).toBe(false);
    expect(uploadMock).toHaveBeenCalledWith('doc-1', png, 'token');
  });

  it('surfaces an upload failure as an error', async () => {
    uploadMock.mockRejectedValue(new Error('Quota exceeded.'));
    const { result } = renderHook(() =>
      usePageImageUpload({ documentId: 'doc-1', accessToken: 'token' })
    );

    let uploaded: unknown;
    await act(async () => {
      uploaded = await result.current.upload(png);
    });

    expect(uploaded).toBeNull();
    expect(result.current.error).toBe('Quota exceeded.');
  });
});
