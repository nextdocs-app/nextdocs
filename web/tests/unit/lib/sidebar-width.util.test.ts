import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_WIDTH_BOOTSTRAP_SCRIPT,
  SIDEBAR_WIDTH_CSS_VAR,
  SIDEBAR_WIDTH_STORAGE_KEY,
  applySidebarWidth,
  clampSidebarWidth,
  parseSidebarWidth,
  readAppliedSidebarWidth,
} from '../../../lib/sidebar-width.util';

const storedWidth = () => document.documentElement.style.getPropertyValue(SIDEBAR_WIDTH_CSS_VAR);

describe('sidebar width tokens', () => {
  it('defaults to the mobile drawer cap', () => {
    expect(SIDEBAR_DEFAULT_WIDTH).toBe(320);
  });
});

describe('parseSidebarWidth', () => {
  it('returns null for missing or unusable values', () => {
    expect(parseSidebarWidth(null)).toBeNull();
    expect(parseSidebarWidth('')).toBeNull();
    expect(parseSidebarWidth('wide')).toBeNull();
  });

  it('reads a numeric width', () => {
    expect(parseSidebarWidth('340')).toBe(340);
  });

  it('clamps into range instead of discarding', () => {
    expect(parseSidebarWidth('999')).toBe(SIDEBAR_MAX_WIDTH);
    expect(parseSidebarWidth('12')).toBe(SIDEBAR_MIN_WIDTH);
    expect(clampSidebarWidth(100)).toBe(SIDEBAR_MIN_WIDTH);
  });
});

describe('applied width', () => {
  beforeEach(() => {
    document.documentElement.style.removeProperty(SIDEBAR_WIDTH_CSS_VAR);
  });

  it('round-trips through the custom property', () => {
    applySidebarWidth(360);
    expect(storedWidth()).toBe('360px');
    expect(readAppliedSidebarWidth()).toBe(360);
  });

  it('falls back to the default before anything is applied', () => {
    expect(readAppliedSidebarWidth()).toBe(SIDEBAR_DEFAULT_WIDTH);
  });
});

describe('SIDEBAR_WIDTH_BOOTSTRAP_SCRIPT', () => {
  const runBootstrap = () => {
    document.documentElement.style.removeProperty(SIDEBAR_WIDTH_CSS_VAR);
    eval(SIDEBAR_WIDTH_BOOTSTRAP_SCRIPT);
  };

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('applies the stored width before React runs', () => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '420');
    runBootstrap();
    expect(storedWidth()).toBe('420px');
  });

  it('applies the default when nothing is stored', () => {
    runBootstrap();
    expect(storedWidth()).toBe(`${SIDEBAR_DEFAULT_WIDTH}px`);
  });

  it('keeps a stored width in range', () => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, '999');
    runBootstrap();
    expect(storedWidth()).toBe(`${SIDEBAR_MAX_WIDTH}px`);
  });

  it('leaves the CSS default in charge when storage is unreadable', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    });

    expect(() => runBootstrap()).not.toThrow();
    // Nothing is written, so `:root`'s value still paints the rail.
    expect(storedWidth()).toBe('');
  });
});
