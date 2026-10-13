import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Relative paths, matching the other component tests: jest.mock does not
// resolve the `@/` alias, though the components' own imports do.
import { DocumentPageHeader } from '../../../components/page/DocumentPageHeader';
import type { DocumentCover, DocumentIcon } from '../../../types/document.types';

// The header only reads the access token to resolve uploaded images; the tests
// use emoji/builtin/link values, so no store is needed.
jest.mock('../../../stores/hooks', () => ({
  useAppSelector: () => null,
  useAppDispatch: () => jest.fn(),
}));

// jsdom reports no `matchMedia`, which reads as a mouse. Flipping this models a
// phone, where the cover actions have no hover to appear from.
let mockIsTouchInput = false;

jest.mock('../../../hooks/useMediaQuery.hook', () => ({
  ...jest.requireActual('../../../hooks/useMediaQuery.hook'),
  useIsTouchInput: () => mockIsTouchInput,
}));

const mockCatalogNames = [
  'airplane',
  'alarm',
  ...Array.from({ length: 98 }, (_, i) => `icon-${i + 1}`),
];

// Sectioned responses arrive through the same hook; empty keeps the flat
// grid the older tests cover, while the section tests below fill it in.
let mockCatalogCategories: { id: string; label: string; icons: string[] }[] = [];

jest.mock('../../../hooks/useIconCatalog.hook', () => ({
  useIconCatalog: () => ({
    names: mockCatalogNames,
    categories: mockCatalogCategories,
    isLoading: false,
    error: null,
  }),
}));

// Pre-fetched glyph bundle; an empty map keeps the grid on the per-glyph
// URLs the older tests cover, while the bundle tests below fill it in.
let mockIconBundle: Map<string, string> | null = new Map();
let mockIconBundleLoading = false;
let mockIconBundleError: string | null = null;

jest.mock('../../../hooks/useIconBundle.hook', () => ({
  useIconBundle: () => ({
    bundle: mockIconBundle,
    isLoading: mockIconBundleLoading,
    error: mockIconBundleError,
  }),
}));

/**
 * jsdom has no IntersectionObserver. Records every observer the picker builds
 * so a test can drive the sentinel the way a browser would at the bottom edge.
 */
function installObserverMock() {
  const instances: {
    callback: IntersectionObserverCallback;
    observe: jest.Mock;
    disconnect: jest.Mock;
  }[] = [];
  const OriginalIO = window.IntersectionObserver;
  window.IntersectionObserver = jest.fn().mockImplementation((callback) => {
    const instance = { callback, observe: jest.fn(), disconnect: jest.fn() };
    instances.push(instance);
    return instance;
  }) as unknown as typeof IntersectionObserver;

  return {
    instances,
    /** The node the newest observer was pointed at. */
    observedNode: () =>
      instances[instances.length - 1]?.observe.mock.calls[0]?.[0] as HTMLElement | undefined,
    intersect: async () => {
      const newest = instances[instances.length - 1];
      await act(async () => {
        newest?.callback([{ isIntersecting: true } as IntersectionObserverEntry], null as never);
      });
    },
    restore: () => {
      // Assigning `undefined` would leave an own-property that defeats `in`
      // checks elsewhere; remove it so the global is truly absent again.
      if (OriginalIO === undefined) {
        delete (window as unknown as Record<string, unknown>).IntersectionObserver;
      } else {
        window.IntersectionObserver = OriginalIO;
      }
    },
  };
}

jest.mock('../../../hooks/useTheme.hook', () => ({
  useTheme: () => ({ resolvedTheme: 'light', theme: 'light' }),
}));

jest.mock('../../../components/page/EmojiMartPicker', () => ({
  EmojiMartPicker: ({ onEmojiSelect }: { onEmojiSelect: (emoji: { native: string }) => void }) => (
    <div data-testid="emoji-mart-picker">
      <button
        type="button"
        aria-label="grin happy smile"
        onClick={() => onEmojiSelect({ native: '😀' })}
      >
        😀
      </button>
    </div>
  ),
}));

jest.mock('../../../services/attachment.service', () => ({
  attachmentService: {
    uploadAttachment: jest.fn(),
    resolveAttachmentUrl: jest.fn(),
  },
}));

afterEach(() => {
  mockIsTouchInput = false;
  mockCatalogCategories = [];
  mockIconBundle = new Map();
  mockIconBundleLoading = false;
  mockIconBundleError = null;
});

type Overrides = {
  icon?: DocumentIcon;
  cover?: DocumentCover;
  isReadOnly?: boolean;
  canEdit?: boolean;
  canUpload?: boolean;
};

function renderHeader(overrides: Overrides = {}) {
  const handlers = {
    onTitleChange: jest.fn(),
    onTitleBlur: jest.fn(),
    onTitleKeyDown: jest.fn(),
    onSelectIcon: jest.fn(),
    onRemoveIcon: jest.fn(),
    onSelectCover: jest.fn(),
    onRemoveCover: jest.fn(),
    onCoverPositionChange: jest.fn(),
  };

  render(
    <DocumentPageHeader
      documentId="doc-1"
      title="Untitled"
      icon={overrides.icon}
      cover={overrides.cover}
      isReadOnly={overrides.isReadOnly ?? false}
      canEdit={overrides.canEdit ?? true}
      canUpload={overrides.canUpload ?? true}
      accessToken="token"
      {...handlers}
    />
  );

  return handlers;
}

function renderHeaderWithRerender(overrides: Overrides = {}) {
  const handlers = {
    onTitleChange: jest.fn(),
    onTitleBlur: jest.fn(),
    onTitleKeyDown: jest.fn(),
    onSelectIcon: jest.fn(),
    onRemoveIcon: jest.fn(),
    onSelectCover: jest.fn(),
    onRemoveCover: jest.fn(),
    onCoverPositionChange: jest.fn(),
  };

  const element = (icon: DocumentIcon | undefined) => (
    <DocumentPageHeader
      documentId="doc-1"
      title="Untitled"
      icon={icon}
      cover={overrides.cover}
      isReadOnly={overrides.isReadOnly ?? false}
      canEdit={overrides.canEdit ?? true}
      canUpload={overrides.canUpload ?? true}
      accessToken="token"
      {...handlers}
    />
  );

  const utils = render(element(overrides.icon));

  return {
    ...handlers,
    rerenderWithIcon: (icon: DocumentIcon | undefined) => utils.rerender(element(icon)),
  };
}

describe('DocumentPageHeader', () => {
  it('offers "Add icon" and "Add cover" before either is set', () => {
    renderHeader();

    expect(screen.getByRole('button', { name: 'Add icon' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add cover' })).toBeInTheDocument();
  });

  it('aligns the page actions with the start of the title', () => {
    renderHeader();

    // The row borrows each button's horizontal padding back from the title
    // gutter, so the icon — not the button box — lines up with the first glyph.
    expect(screen.getByRole('button', { name: 'Add icon' }).parentElement?.className).toMatch(
      /-ml-2/
    );
  });

  it('hides both actions for a read-only reader', () => {
    renderHeader({ isReadOnly: true, canEdit: false });

    expect(screen.queryByRole('button', { name: 'Add icon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add cover' })).not.toBeInTheDocument();
  });

  it('picks an emoji from the picker and closes it', async () => {
    const user = userEvent.setup();
    const { onSelectIcon } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));

    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    // The panel opens on the icons tab (the emoji dataset parses lazily), so
    // select the emoji tab before picking.
    await user.click(within(panel).getByRole('tab', { name: 'Emoji' }));
    await user.click(within(panel).getByRole('button', { name: 'grin happy smile' }));

    expect(onSelectIcon).toHaveBeenCalledWith({ type: 'emoji', value: '😀' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('picks a glyph from the builtin catalog', async () => {
    const user = userEvent.setup();
    const { onSelectIcon } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    await user.click(within(panel).getByRole('tab', { name: 'Icons' }));
    await user.click(within(panel).getByRole('button', { name: 'airplane' }));

    expect(onSelectIcon).toHaveBeenCalledWith({ type: 'builtin', value: 'airplane' });
  });

  it('selects an icon with a chosen color from the color menu', async () => {
    const user = userEvent.setup();
    const { onSelectIcon } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    await user.click(within(panel).getByRole('tab', { name: 'Icons' }));

    // Click color selector button
    await user.click(within(panel).getByRole('button', { name: 'Icon color: Default' }));
    // Pick 'Blue'
    await user.click(within(panel).getByRole('option', { name: /Blue/i }));

    // Pick 'airplane' icon
    await user.click(within(panel).getByRole('button', { name: 'airplane' }));

    expect(onSelectIcon).toHaveBeenCalledWith({
      type: 'builtin',
      value: 'airplane',
      color: 'blue',
    });
  });

  it('filters the builtin catalog through the search field', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });

    // The panel opens on the icons tab; searching narrows the grid.
    await user.type(within(panel).getByPlaceholderText('Search icons'), 'airplane');

    expect(within(panel).getByRole('button', { name: 'airplane' })).toBeInTheDocument();
    expect(within(panel).queryByRole('button', { name: 'alarm' })).toBeNull();
  });

  it('groups the builtin catalog under labeled section headers', async () => {
    mockCatalogCategories = [
      { id: 'essentials', label: 'Essentials', icons: ['airplane', 'alarm'] },
      { id: 'more', label: 'More', icons: ['archive', 'anchor'] },
    ];
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });

    expect(within(panel).getByRole('heading', { name: 'Essentials' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'More' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'airplane' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'archive' })).toBeInTheDocument();
  });

  it('narrows the sectioned grid through the category filter', async () => {
    mockCatalogCategories = [
      { id: 'essentials', label: 'Essentials', icons: ['airplane', 'alarm'] },
      { id: 'more', label: 'More', icons: ['archive', 'anchor'] },
    ];
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });

    await user.click(within(panel).getByRole('button', { name: 'Icon category: All categories' }));
    await user.click(within(panel).getByRole('option', { name: /More/ }));

    expect(within(panel).queryByRole('button', { name: 'airplane' })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'archive' })).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: 'Essentials' })).toBeNull();
    expect(within(panel).getByRole('heading', { name: 'More' })).toBeInTheDocument();
  });

  it('dismisses the category menu on outside click without changing the filter', async () => {
    mockCatalogCategories = [
      { id: 'essentials', label: 'Essentials', icons: ['airplane', 'alarm'] },
      { id: 'more', label: 'More', icons: ['archive', 'anchor'] },
    ];
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    await user.click(within(panel).getByRole('button', { name: 'Icon category: All categories' }));
    expect(within(panel).getByRole('option', { name: /More/ })).toBeInTheDocument();

    // Inside the panel but outside the menu: the menu closes, the grid keeps
    // every section.
    await user.click(within(panel).getByPlaceholderText('Search icons'));

    expect(within(panel).queryByRole('option', { name: /More/ })).toBeNull();
    expect(within(panel).getByRole('button', { name: 'airplane' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'archive' })).toBeInTheDocument();
  });

  it('keeps section headers while searching the sectioned catalog', async () => {
    mockCatalogCategories = [
      { id: 'essentials', label: 'Essentials', icons: ['airplane', 'alarm'] },
      { id: 'more', label: 'More', icons: ['archive', 'anchor'] },
    ];
    const user = userEvent.setup();
    const { onSelectIcon } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    await user.type(within(panel).getByPlaceholderText('Search icons'), 'airplane');

    expect(within(panel).getByRole('heading', { name: 'Essentials' })).toBeInTheDocument();
    expect(within(panel).queryByRole('heading', { name: 'More' })).toBeNull();

    await user.click(within(panel).getByRole('button', { name: 'airplane' }));
    expect(onSelectIcon).toHaveBeenCalledWith({ type: 'builtin', value: 'airplane' });
  });

  it('embeds bundle glyphs as data URLs instead of per-icon requests', async () => {
    mockIconBundle = new Map([
      ['airplane', '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h24v24H0z"/></svg>'],
    ]);
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    const mask = within(panel)
      .getByRole('button', { name: 'airplane' })
      .querySelector('.nd-page-icon-mask');

    expect(mask?.getAttribute('style')).toContain('data:image/svg+xml');
  });

  it('falls back to per-glyph URLs when the bundle fails', async () => {
    mockIconBundle = null;
    mockIconBundleError = 'Boom';
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    const mask = within(panel)
      .getByRole('button', { name: 'airplane' })
      .querySelector('.nd-page-icon-mask');

    expect(mask?.getAttribute('style')).toContain('/api/v1/icons/airplane');
  });

  it('holds a picked color for the next glyph when no builtin icon is set yet', async () => {
    const user = userEvent.setup();
    const { onSelectIcon } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });

    // Choosing a color alone selects nothing: there is no current icon to
    // recolor, so the choice waits for the next glyph pick.
    await user.click(within(panel).getByRole('button', { name: 'Icon color: Default' }));
    await user.click(within(panel).getByRole('option', { name: /Blue/i }));
    expect(onSelectIcon).not.toHaveBeenCalled();

    await user.click(within(panel).getByRole('button', { name: 'airplane' }));
    expect(onSelectIcon).toHaveBeenCalledWith({
      type: 'builtin',
      value: 'airplane',
      color: 'blue',
    });
  });

  it('resets the picked color when the open picker stops showing a builtin icon', async () => {
    const user = userEvent.setup();
    const { rerenderWithIcon } = renderHeaderWithRerender({
      icon: { type: 'builtin', value: 'airplane', color: 'red' },
    });

    await user.click(screen.getByRole('button', { name: 'Page icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    expect(within(panel).getByRole('button', { name: 'Icon color: Red' })).toBeInTheDocument();

    // A collaborator swaps the icon while the picker stays open: the stale
    // red must not leak into the next glyph pick.
    rerenderWithIcon({ type: 'emoji', value: '🚀' });

    expect(within(panel).getByRole('button', { name: 'Icon color: Default' })).toBeInTheDocument();
  });

  it('reveals the builtin catalog through the sentinel until every icon renders', async () => {
    const user = userEvent.setup();
    const observer = installObserverMock();

    try {
      renderHeader();

      await user.click(screen.getByRole('button', { name: 'Add icon' }));
      const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
      await user.click(within(panel).getByRole('tab', { name: 'Icons' }));

      // Page 1 is a slice of the catalog and the sentinel below it is observed.
      expect(within(panel).getByRole('button', { name: 'airplane' })).toBeInTheDocument();
      expect(within(panel).queryByRole('button', { name: 'icon 98' })).toBeNull();
      expect(observer.observedNode()?.isConnected).toBe(true);

      // Crossing the sentinel reveals page 2 and re-arms for page 3.
      await observer.intersect();
      expect(within(panel).getByRole('button', { name: 'icon 90' })).toBeInTheDocument();
      expect(observer.instances).toHaveLength(2);

      const lastSentinel = observer.observedNode();
      await observer.intersect();

      // All 100 catalog entries render, and the sentinel — now that nothing is
      // left to reveal — leaves the tree instead of sitting there as a spinner.
      expect(within(panel).getByRole('button', { name: 'icon 98' })).toBeInTheDocument();
      expect(lastSentinel?.isConnected).toBe(false);
      expect(observer.instances[1].disconnect).toHaveBeenCalled();
    } finally {
      observer.restore();
    }
  });

  it('starts revealing the catalog when the glyph bundle lands after the panel opens', async () => {
    // The grid holds off until the bundle arrives (per-glyph URLs would fire a
    // request waterfall), so the sentinel mounts *after* the first effects have
    // already run. An observer wired to the render instead of to the element
    // never attached, which parked the picker on "Loading more icons…" for good.
    mockIconBundle = null;
    mockIconBundleLoading = true;
    const user = userEvent.setup();
    const observer = installObserverMock();

    try {
      const { rerenderWithIcon } = renderHeaderWithRerender();

      await user.click(screen.getByRole('button', { name: 'Add icon' }));
      const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
      await user.click(within(panel).getByRole('tab', { name: 'Icons' }));

      expect(within(panel).queryByRole('button', { name: 'airplane' })).toBeNull();
      expect(observer.instances).toHaveLength(0);

      // The bundle lands: the grid and its sentinel mount together.
      mockIconBundle = new Map();
      mockIconBundleLoading = false;
      rerenderWithIcon(undefined);

      expect(within(panel).getByRole('button', { name: 'airplane' })).toBeInTheDocument();
      expect(observer.instances).toHaveLength(1);
      expect(observer.observedNode()?.isConnected).toBe(true);
    } finally {
      observer.restore();
    }
  });

  it('offers a manual "Show more" when the browser cannot observe the sentinel', async () => {
    const OriginalIO = window.IntersectionObserver;
    delete (window as unknown as Record<string, unknown>).IntersectionObserver;

    try {
      const user = userEvent.setup();
      renderHeader();

      await user.click(screen.getByRole('button', { name: 'Add icon' }));
      const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
      await user.click(within(panel).getByRole('tab', { name: 'Icons' }));

      expect(within(panel).queryByRole('button', { name: 'icon 80' })).toBeNull();

      await user.click(within(panel).getByRole('button', { name: 'Show more icons' }));

      expect(within(panel).getByRole('button', { name: 'icon 80' })).toBeInTheDocument();
    } finally {
      if (OriginalIO === undefined) {
        delete (window as unknown as Record<string, unknown>).IntersectionObserver;
      } else {
        window.IntersectionObserver = OriginalIO;
      }
    }
  });

  it('keeps the link tab honest about https URLs', async () => {
    const user = userEvent.setup();
    const { onSelectIcon } = renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    await user.click(within(panel).getByRole('tab', { name: 'Link' }));

    const apply = within(panel).getByRole('button', { name: 'Use image' });
    expect(apply).toBeDisabled();

    await user.type(within(panel).getByLabelText('Image URL'), 'http://insecure.example/i.png');
    expect(apply).toBeDisabled();

    await user.clear(within(panel).getByLabelText('Image URL'));
    await user.type(within(panel).getByLabelText('Image URL'), 'https://cdn.example/i.png');
    expect(apply).toBeEnabled();

    await user.click(apply);
    expect(onSelectIcon).toHaveBeenCalledWith({
      type: 'link',
      value: 'https://cdn.example/i.png',
    });
  });

  it('does not pull focus into the search field when a section is clicked', async () => {
    const user = userEvent.setup();
    renderHeader();

    await user.click(screen.getByRole('button', { name: 'Add icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    await user.click(within(panel).getByRole('tab', { name: 'Icons' }));

    // Clicking a section is a navigation, not an invitation to type: the reader
    // keeps the caret wherever they left it.
    expect(within(panel).getByPlaceholderText('Search icons')).not.toHaveFocus();
  });

  it('leaves the page icon flat on hover', () => {
    renderHeader({ icon: { type: 'emoji', value: '📝' } });

    // The icon is document content that doubles as a button, so shading it would
    // advertise an edit affordance on every pass of the pointer.
    expect(screen.getByRole('button', { name: 'Page icon' }).className).not.toMatch(/hover:bg-/);
  });

  it('replaces "Add icon" with the icon itself once one is set', async () => {
    const user = userEvent.setup();
    const { onRemoveIcon } = renderHeader({ icon: { type: 'emoji', value: '📝' } });

    expect(screen.queryByRole('button', { name: 'Add icon' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Page icon' }));
    const panel = screen.getByRole('dialog', { name: 'Choose a page icon' });
    await user.click(within(panel).getByRole('button', { name: 'Remove' }));

    expect(onRemoveIcon).toHaveBeenCalled();
  });

  it('shows the cover actions on the banner and removes the cover', async () => {
    const user = userEvent.setup();
    const { onRemoveCover } = renderHeader({
      cover: { type: 'link', value: 'https://cdn.example/cover.jpg', position: 0.5 },
    });

    expect(screen.queryByRole('button', { name: 'Add cover' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(onRemoveCover).toHaveBeenCalled();
  });

  it('keeps arrow-key steps local while repositioning and commits once on Enter', async () => {
    const user = userEvent.setup();
    const { onCoverPositionChange } = renderHeader({
      cover: { type: 'link', value: 'https://cdn.example/cover.jpg', position: 0.5 },
    });

    await user.click(screen.getByRole('button', { name: 'Reposition' }));

    const frame = screen.getByRole('application', { name: 'Reposition the cover image' });
    frame.focus();
    await user.keyboard('{ArrowDown}');

    // A held key must not fan out a PATCH per repeat; the step stays local.
    expect(onCoverPositionChange).not.toHaveBeenCalled();

    await user.keyboard('{Enter}');

    expect(onCoverPositionChange).toHaveBeenCalledTimes(1);
    expect(onCoverPositionChange).toHaveBeenCalledWith(0.48);
  });

  it('places "Add icon" and "Add cover" above the title textarea in DOM order', () => {
    renderHeader();

    const addIconBtn = screen.getByRole('button', { name: 'Add icon' });
    const addCoverBtn = screen.getByRole('button', { name: 'Add cover' });
    const titleTextarea = screen.getByPlaceholderText('Untitled');

    // Both buttons precede the title in DOM order
    expect(
      addIconBtn.compareDocumentPosition(titleTextarea) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      addCoverBtn.compareDocumentPosition(titleTextarea) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('keeps a slimmer actions spacer once icon and cover are both set', () => {
    renderHeader({
      icon: { type: 'emoji', value: '🚀' },
      cover: { type: 'link', value: 'https://cdn.example/cover.jpg', position: 0.5 },
    });

    // No buttons left to show, but a reduced spacer stays so the title never jumps.
    expect(screen.queryByRole('button', { name: 'Add icon' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add cover' })).not.toBeInTheDocument();

    const titleTextarea = screen.getByPlaceholderText('Untitled');
    expect(titleTextarea.previousElementSibling?.className).toMatch(/min-h-\[12px\]/);
  });

  it('positions the icon overlapping the cover banner when a cover is present', () => {
    renderHeader({
      icon: { type: 'emoji', value: '🚀' },
      cover: { type: 'link', value: 'https://cdn.example/cover.jpg', position: 0.5 },
    });

    const iconButton = screen.getByRole('button', { name: 'Page icon' });
    const wrapper = iconButton.parentElement;

    expect(wrapper).toHaveClass('-mt-10');
    expect(wrapper).toHaveClass('z-20');
  });

  it('positions the icon in standard flow when no cover is present', () => {
    renderHeader({
      icon: { type: 'emoji', value: '🚀' },
    });

    const iconButton = screen.getByRole('button', { name: 'Page icon' });
    const wrapper = iconButton.parentElement;

    expect(wrapper).not.toHaveClass('-mt-10');
  });

  it('keeps the cover actions inert until the banner is tapped, when nothing hovers', () => {
    mockIsTouchInput = true;
    renderHeader({
      cover: { type: 'link', value: 'https://cdn.example/cover.jpg', position: 0.5 },
    });

    const actions = screen.getByRole('group', { name: 'Cover actions' });
    expect(actions).toHaveClass('opacity-0');
    // Hidden and inert: a tap in that corner must not land on "Remove".
    expect(actions).toHaveClass('pointer-events-none');

    fireEvent.pointerDown(actions.parentElement!);

    expect(actions).toHaveClass('opacity-100');
    expect(actions).not.toHaveClass('pointer-events-none');

    // A tap back on the banner, or anywhere off it, puts them away again.
    fireEvent.pointerDown(actions.parentElement!);
    expect(actions).toHaveClass('opacity-0');

    fireEvent.pointerDown(actions.parentElement!);
    fireEvent.pointerDown(document.body);
    expect(actions).toHaveClass('opacity-0');
  });

  it('shows the cover actions while repositioning without a tap', async () => {
    mockIsTouchInput = true;
    const user = userEvent.setup();
    renderHeader({
      cover: { type: 'link', value: 'https://cdn.example/cover.jpg', position: 0.5 },
    });

    const actions = screen.getByRole('group', { name: 'Cover actions' });
    fireEvent.pointerDown(actions.parentElement!);
    await user.click(screen.getByRole('button', { name: 'Reposition' }));

    expect(actions).toHaveClass('opacity-100');
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
  });

  it('exits reposition mode when clicking "Done"', async () => {
    const user = userEvent.setup();
    renderHeader({
      cover: { type: 'link', value: 'https://cdn.example/cover.jpg', position: 0.5 },
    });

    await user.click(screen.getByRole('button', { name: 'Reposition' }));
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument();
    expect(
      screen.getByRole('application', { name: 'Reposition the cover image' })
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('application')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reposition' })).toBeInTheDocument();
  });
});
