import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps, ReactNode } from 'react';
import { loadFrimousseData } from '@blocknote/core/emoji-data';
import type { FrimousseEmojiData } from '@blocknote/core/emoji-data';
import {
  EMOJI_PICKER_LOCALE,
  EmojiPicker,
  preloadEmojiPicker,
  resolveEmojiData,
} from '../../../components/page/EmojiPicker';

jest.mock('@blocknote/core/emoji-data', () => ({
  loadFrimousseData: jest.fn(),
}));

// Frimousse virtualizes its grid from ResizeObserver measurements, which jsdom
// cannot provide. The wrapper only composes the parts, so stub them and assert
// the contract that keeps the real picker wired up.
jest.mock('frimousse', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  const state: {
    rootProps: Record<string, unknown>;
    activeEmoji?: { emoji: string; label: string };
  } = { rootProps: {} };

  function Root({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) {
    state.rootProps = props;
    return React.createElement('div', { 'data-testid': 'emoji-picker-root' }, children);
  }

  function Search(props: ComponentProps<'input'>) {
    // Frimousse defaults the input to `type="search"`, which is the accessible
    // role the picker relies on.
    return React.createElement('input', { type: 'search', ...props });
  }

  function Viewport({ children }: { children?: ReactNode }) {
    return React.createElement('div', null, children);
  }

  function Loading({ children }: { children?: ReactNode }) {
    return React.createElement('span', null, children);
  }

  function Empty({ children }: { children?: ReactNode }) {
    return React.createElement('span', null, children);
  }

  function List() {
    const select = state.rootProps.onEmojiSelect as
      ((emoji: { emoji: string; label: string }) => void) | undefined;
    return React.createElement(
      'button',
      { type: 'button', onClick: () => select?.({ emoji: '🎉', label: 'Party Popper' }) },
      '🎉 Party Popper'
    );
  }

  function ActiveEmoji({
    children,
  }: {
    children: (props: { emoji?: { emoji: string; label: string } }) => ReactNode;
  }) {
    return React.createElement(React.Fragment, null, children({ emoji: state.activeEmoji }));
  }

  function SkinToneSelector(props: ComponentProps<'button'>) {
    return React.createElement('button', { type: 'button', ...props });
  }

  const skinToneVariations = [
    { skinTone: 'none', emoji: '👋' },
    { skinTone: 'light', emoji: '👋🏻' },
    { skinTone: 'medium-light', emoji: '👋🏼' },
    { skinTone: 'medium', emoji: '👋🏽' },
    { skinTone: 'medium-dark', emoji: '👋🏾' },
    { skinTone: 'dark', emoji: '👋🏿' },
  ];

  function SkinTone({
    children,
  }: {
    children: (props: {
      skinTone: string;
      setSkinTone: (tone: string) => void;
      skinToneVariations: typeof skinToneVariations;
    }) => ReactNode;
  }) {
    const [skinTone, setSkinTone] = React.useState('none');
    return React.createElement(
      React.Fragment,
      null,
      children({ skinTone, setSkinTone, skinToneVariations })
    );
  }

  return {
    __esModule: true,
    EmojiPicker: {
      Root,
      Search,
      Viewport,
      Loading,
      Empty,
      List,
      ActiveEmoji,
      SkinTone,
      SkinToneSelector,
    },
    __mock: state,
  };
});

const frimousseState = (
  jest.requireMock('frimousse') as {
    __mock: {
      rootProps: Record<string, unknown>;
      activeEmoji?: { emoji: string; label: string };
    };
  }
).__mock;

const mockLoadFrimousseData = loadFrimousseData as jest.MockedFunction<typeof loadFrimousseData>;

const emojiData: FrimousseEmojiData = {
  locale: 'en',
  emojis: [
    {
      emoji: '🎉',
      category: 0,
      version: 3,
      label: 'Party Popper',
      tags: ['party', 'tada'],
    },
  ],
  categories: [{ index: 0, label: 'Activities' }],
  skinTones: {
    light: 'Light',
    'medium-light': 'Medium light',
    medium: 'Medium',
    'medium-dark': 'Medium dark',
    dark: 'Dark',
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadFrimousseData.mockReset();
  mockLoadFrimousseData.mockResolvedValue(emojiData);
  frimousseState.rootProps = {};
  frimousseState.activeEmoji = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('EmojiPicker', () => {
  it('passes the English locale and shared resolver to Frimousse', () => {
    render(<EmojiPicker onEmojiSelect={jest.fn()} />);

    expect(frimousseState.rootProps).toMatchObject({
      locale: EMOJI_PICKER_LOCALE,
      columns: 10,
      resolveEmojiData,
    });
  });

  it('lets the caller pick another locale', () => {
    render(<EmojiPicker onEmojiSelect={jest.fn()} locale="fr" />);

    expect(frimousseState.rootProps.locale).toBe('fr');
  });

  it('renders the search, status messages and footer controls', () => {
    render(<EmojiPicker onEmojiSelect={jest.fn()} />);

    expect(screen.getByRole('searchbox', { name: 'Search emoji' })).toHaveAttribute(
      'placeholder',
      'Search emoji'
    );
    expect(screen.getByText('Loading emoji…')).toBeInTheDocument();
    expect(screen.getByText('No emoji found.')).toBeInTheDocument();
    expect(screen.getByText('Search or select an emoji…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change skin tone' })).toBeInTheDocument();
  });

  it('focuses the search field only when autoFocus is set', () => {
    const { unmount } = render(<EmojiPicker onEmojiSelect={jest.fn()} />);
    expect(screen.getByRole('searchbox')).not.toHaveFocus();

    unmount();

    render(<EmojiPicker onEmojiSelect={jest.fn()} autoFocus />);
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('forwards the selected emoji as a string', async () => {
    const user = userEvent.setup();
    const onEmojiSelect = jest.fn();
    render(<EmojiPicker onEmojiSelect={onEmojiSelect} />);

    await user.click(screen.getByRole('button', { name: '🎉 Party Popper' }));

    expect(onEmojiSelect).toHaveBeenCalledWith('🎉');
  });

  it('shows the active emoji in the footer', () => {
    frimousseState.activeEmoji = { emoji: '🎉', label: 'Party Popper' };
    render(<EmojiPicker onEmojiSelect={jest.fn()} />);

    expect(screen.getByText('Party Popper')).toBeInTheDocument();
  });

  it('opens the skin tone picker on demand and applies the chosen tone', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onEmojiSelect={jest.fn()} />);

    const trigger = screen.getByRole('button', { name: 'Change skin tone' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('group', { name: 'Skin tone' })).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const group = screen.getByRole('group', { name: 'Skin tone' });
    expect(within(group).getAllByRole('button')).toHaveLength(6);
    expect(within(group).getByRole('button', { name: 'Default skin tone' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );

    await user.click(screen.getByRole('button', { name: 'Medium dark skin tone' }));

    expect(screen.queryByRole('group', { name: 'Skin tone' })).not.toBeInTheDocument();
    expect(trigger).toHaveTextContent('👋🏾');
  });

  it('closes the skin tone picker on Escape', async () => {
    const user = userEvent.setup();
    render(<EmojiPicker onEmojiSelect={jest.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Change skin tone' }));
    expect(screen.getByRole('group', { name: 'Skin tone' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('group', { name: 'Skin tone' })).not.toBeInTheDocument();
  });
});

describe('resolveEmojiData', () => {
  it('loads the requested locale', async () => {
    await expect(resolveEmojiData('en', {})).resolves.toBe(emojiData);
    expect(mockLoadFrimousseData).toHaveBeenCalledWith('en');
  });

  it('does not load data for an already aborted request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(resolveEmojiData('en', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(mockLoadFrimousseData).not.toHaveBeenCalled();
  });

  it('discards data that arrives after the request was aborted', async () => {
    const controller = new AbortController();
    mockLoadFrimousseData.mockImplementation(async () => {
      controller.abort();
      return emojiData;
    });

    await expect(resolveEmojiData('en', { signal: controller.signal })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});

describe('preloadEmojiPicker', () => {
  it('warms the default locale', () => {
    preloadEmojiPicker();

    expect(mockLoadFrimousseData).toHaveBeenCalledWith('en');
  });

  it('warms an explicit locale', () => {
    preloadEmojiPicker('fr');

    expect(mockLoadFrimousseData).toHaveBeenCalledWith('fr');
  });

  it('leaves a failed preload to the picker', async () => {
    const error = new Error('offline');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockLoadFrimousseData.mockRejectedValue(error);

    preloadEmojiPicker();

    await waitFor(() =>
      expect(warn).toHaveBeenCalledWith('Failed to preload the emoji picker:', error)
    );
  });
});
