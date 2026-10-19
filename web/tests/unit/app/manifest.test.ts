import { existsSync } from 'fs';
import { join } from 'path';
import manifest from '@/app/manifest';

describe('web app manifest', () => {
  const result = manifest();

  it('describes a standalone installable app', () => {
    expect(result.name).toBe('NextDocs');
    expect(result.short_name).toBe('NextDocs');
    expect(result.start_url).toBe('/');
    expect(result.scope).toBe('/');
    expect(result.display).toBe('standalone');
    expect(result.theme_color).toBe('#e78f80');
  });

  it('declares the icon sizes browsers require for installation', () => {
    const icons = result.icons ?? [];

    expect(icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/icons/icon-192.png', sizes: '192x192' }),
        expect.objectContaining({ src: '/icons/icon-512.png', sizes: '512x512' }),
        expect.objectContaining({
          src: '/icons/icon-maskable-512.png',
          sizes: '512x512',
          purpose: 'maskable',
        }),
      ])
    );
  });

  it('points at icons that actually ship in public/', () => {
    for (const icon of result.icons ?? []) {
      expect(existsSync(join(process.cwd(), 'public', icon.src!))).toBe(true);
    }
  });
});
