/**
 * @jest-environment node
 *
 * The rail preferences are read during the server render and in `<head>`, so
 * the modules must work with no `window`, no `document` and no storage at all.
 * jsdom cannot express that; a node environment can.
 */
import { createPreferenceStore } from '../../../lib/preference-store.util';
import {
  applySidebarCollapsedAttribute,
  sidebarUiPreference,
} from '../../../lib/sidebar-preferences.util';
import { SIDEBAR_DEFAULT_WIDTH, readAppliedSidebarWidth } from '../../../lib/sidebar-width.util';

describe('sidebar preferences without a browser', () => {
  it('reads the defaults when there is no storage to read', () => {
    const store = createPreferenceStore<{ collapsed: boolean }>({
      key: 'nextdocs:test-preference',
      version: 1,
      defaults: () => ({ collapsed: false }),
      parse: (payload) => ({ collapsed: payload.collapsed === true }),
      encode: (value) => ({ collapsed: value.collapsed }),
    });

    expect(store.read()).toEqual({ collapsed: false });
    expect(sidebarUiPreference.read()).toEqual({
      collapsed: false,
      sections: { spaces: true, private: true, shared: true },
    });
  });

  it('keeps the value in memory when there is nowhere to write it', () => {
    const store = createPreferenceStore<{ collapsed: boolean }>({
      key: 'nextdocs:test-preference',
      version: 1,
      defaults: () => ({ collapsed: false }),
      parse: (payload) => ({ collapsed: payload.collapsed === true }),
      encode: (value) => ({ collapsed: value.collapsed }),
    });

    expect(() => store.set({ collapsed: true })).not.toThrow();
    expect(store.read()).toEqual({ collapsed: true });
    expect(JSON.parse(store.serialize())).toEqual({ v: 1, collapsed: true });
  });

  it('treats a storage object that throws on access as absent', () => {
    const fakeWindow = {
      addEventListener: jest.fn(),
    } as unknown as Window;
    Object.defineProperty(fakeWindow, 'localStorage', {
      get() {
        throw new DOMException('Storage is disabled.', 'SecurityError');
      },
    });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: fakeWindow });

    try {
      const store = createPreferenceStore<{ collapsed: boolean }>({
        key: 'nextdocs:test-preference',
        version: 1,
        defaults: () => ({ collapsed: false }),
        parse: (payload) => ({ collapsed: payload.collapsed === true }),
        encode: (value) => ({ collapsed: value.collapsed }),
      });

      expect(store.read()).toEqual({ collapsed: false });
      expect(() => store.set({ collapsed: true })).not.toThrow();
      expect(store.read()).toEqual({ collapsed: true });
    } finally {
      Reflect.deleteProperty(globalThis, 'window');
    }
  });

  it('leaves the width and the collapse signal alone', () => {
    expect(readAppliedSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(() => applySidebarCollapsedAttribute(true)).not.toThrow();
  });
});
