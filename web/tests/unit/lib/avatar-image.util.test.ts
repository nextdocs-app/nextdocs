import { AVATAR_UPLOAD_DIMENSION, prepareAvatarUpload } from '../../../lib/avatar-image.util';

describe('prepareAvatarUpload', () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap;
  });

  it('passes the file through when the browser cannot decode it', async () => {
    // jsdom has no createImageBitmap; the API still sniffs the bytes, so the
    // original file is a safe fallback rather than an error on the client.
    // @ts-expect-error - deliberately removing a browser global
    delete globalThis.createImageBitmap;
    const file = new File(['png'], 'portrait.png', { type: 'image/png' });

    await expect(prepareAvatarUpload(file)).resolves.toBe(file);
  });

  it('keeps an already-small image untouched', async () => {
    globalThis.createImageBitmap = jest.fn().mockResolvedValue({
      width: 200,
      height: 200,
      close: jest.fn(),
    }) as unknown as typeof createImageBitmap;
    const file = new File(['png'], 'avatar.png', { type: 'image/png' });

    await expect(prepareAvatarUpload(file)).resolves.toBe(file);
  });

  it('falls back to the original when the source cannot be decoded', async () => {
    globalThis.createImageBitmap = jest
      .fn()
      .mockRejectedValue(new Error('unsupported')) as unknown as typeof createImageBitmap;
    const file = new File(['garbage'], 'broken.png', { type: 'image/png' });

    await expect(prepareAvatarUpload(file)).resolves.toBe(file);
  });

  it('re-encodes a large photo down to the avatar size', async () => {
    const bitmap = { width: 4000, height: 3000, close: jest.fn() };
    globalThis.createImageBitmap = jest
      .fn()
      .mockResolvedValue(bitmap) as unknown as typeof createImageBitmap;
    const drawImage = jest.fn();
    const toBlob = jest.fn((callback: (blob: Blob | null) => void) => {
      callback(new Blob(['small'], { type: 'image/webp' }));
    });
    const context = { drawImage };
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue(context as unknown as CanvasRenderingContext2D);
    HTMLCanvasElement.prototype.toBlob = toBlob as unknown as HTMLCanvasElement['toBlob'];

    const prepared = await prepareAvatarUpload(
      new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' })
    );

    // The long edge is capped and the aspect ratio is kept.
    const canvas = toBlob.mock.instances[0] as unknown as HTMLCanvasElement;
    expect(AVATAR_UPLOAD_DIMENSION).toBe(512);
    expect(canvas.width).toBe(512);
    expect(canvas.height).toBe(384);
    expect(drawImage).toHaveBeenCalled();
    expect(prepared.name).toBe('avatar.webp');
    expect(prepared.type).toBe('image/webp');
    expect(bitmap.close).toHaveBeenCalled();
  });

  it('keeps the original when the canvas cannot be drawn on', async () => {
    globalThis.createImageBitmap = jest.fn().mockResolvedValue({
      width: 4000,
      height: 3000,
      close: jest.fn(),
    }) as unknown as typeof createImageBitmap;
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const file = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });

    await expect(prepareAvatarUpload(file)).resolves.toBe(file);
  });

  it('keeps the original when the encoder produces nothing', async () => {
    globalThis.createImageBitmap = jest.fn().mockResolvedValue({
      width: 4000,
      height: 3000,
      close: jest.fn(),
    }) as unknown as typeof createImageBitmap;
    jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({ drawImage: jest.fn() } as unknown as CanvasRenderingContext2D);
    HTMLCanvasElement.prototype.toBlob = ((callback: (blob: Blob | null) => void) => {
      callback(null);
    }) as unknown as HTMLCanvasElement['toBlob'];
    const file = new File([new Uint8Array(1024)], 'photo.jpg', { type: 'image/jpeg' });

    await expect(prepareAvatarUpload(file)).resolves.toBe(file);
  });
});
