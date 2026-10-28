'use client';

import { useCallback, useState } from 'react';
import { attachmentService } from '@/services/attachment.service';
import { validatePageImageFile } from '@/lib/document-icon.util';

/** The only part of an upload the icon picker needs. */
export interface UploadedPageImage {
  id: string;
}

/**
 * Shared picker upload pipeline.
 *
 * The icon and cover pickers carried identical `handleUpload` bodies (auth
 * guard, fail-fast MIME/size check, uploading flag, error mapping). One hook
 * keeps the failure messages and the `accept`-is-advisory comment in a single
 * place; callers map the uploaded attachment to their own value shape.
 *
 * `uploadFile` lets a picker that is not attached to a document (the workspace
 * icon) supply its own endpoint while keeping the same validation and state.
 */
export function usePageImageUpload({
  documentId,
  accessToken,
  uploadFile,
}: {
  documentId?: string;
  accessToken: string | null;
  uploadFile?: (file: File) => Promise<UploadedPageImage>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const upload = useCallback(
    async (file: File) => {
      if (!accessToken) {
        setError('Sign in to upload an image.');
        return null;
      }
      // `accept` is advisory only: fail fast before any network request. The
      // server still enforces size/quota and the icon/cover raster-type check.
      const fileError = validatePageImageFile(file);
      if (fileError) {
        setError(fileError);
        return null;
      }
      setIsUploading(true);
      setError(null);
      try {
        if (uploadFile) {
          return await uploadFile(file);
        }

        if (!documentId) {
          setError('Upload is unavailable here.');
          return null;
        }

        return await attachmentService.uploadAttachment(documentId, file, accessToken);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [documentId, accessToken, uploadFile]
  );

  return { error, setError, isUploading, upload };
}
