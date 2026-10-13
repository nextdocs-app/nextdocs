'use client';

import { useCallback, useState } from 'react';
import { attachmentService } from '@/services/attachment.service';
import { validatePageImageFile } from '@/lib/document-icon.util';

/**
 * Shared picker upload pipeline.
 *
 * The icon and cover pickers carried identical `handleUpload` bodies (auth
 * guard, fail-fast MIME/size check, uploading flag, error mapping). One hook
 * keeps the failure messages and the `accept`-is-advisory comment in a single
 * place; callers map the uploaded attachment to their own value shape.
 */
export function usePageImageUpload({
  documentId,
  accessToken,
}: {
  documentId: string;
  accessToken: string | null;
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
        return await attachmentService.uploadAttachment(documentId, file, accessToken);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [documentId, accessToken]
  );

  return { error, setError, isUploading, upload };
}
