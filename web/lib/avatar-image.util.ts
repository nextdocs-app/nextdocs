/**
 * Longest side of an uploaded profile photo. Avatars render at 48px at most, so
 * 512px covers a 3x-density screen with room for a future larger header.
 */
export const AVATAR_UPLOAD_DIMENSION = 512;

/** Below this size re-encoding buys nothing and only risks changing the image. */
const REENCODE_THRESHOLD_BYTES = 400 * 1024;

/**
 * Downscales a photo in the browser before it is uploaded.
 *
 * A camera roll image is 3-8 MB, which would be rejected, stored at full resolution
 * and re-downloaded for every comment thread it appears in — for a 48px circle. The
 * canvas re-encode bounds all three.
 *
 * The original file is returned unchanged whenever re-encoding is pointless or
 * impossible: an already-small image, a browser without `createImageBitmap`, or a
 * format the canvas cannot decode. The API sniffs the bytes either way and answers
 * with a readable error, so silent fallthrough is safe here.
 */
export async function prepareAvatarUpload(
  file: File,
  maxDimension = AVATAR_UPLOAD_DIMENSION
): Promise<File> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return file;
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= REENCODE_THRESHOLD_BYTES) {
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) {
      return file;
    }
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/webp', 0.9);
    });
    if (!blob) {
      return file;
    }

    // WebP is in the server's raster allowlist, and the name is fixed so the stored
    // file never carries a camera's original filename.
    return new File([blob], 'avatar.webp', { type: 'image/webp' });
  } finally {
    bitmap.close();
  }
}
