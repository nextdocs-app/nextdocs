import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MobileFormattingToolbarController } from '../../../components/editor/MobileFormattingToolbar';

// The controller only reaches for `FormattingToolbar` as the default, so a stub
// is enough: what matters is that whatever it renders stays mounted and live.
// The toolbar hooks are stubbed for the dismiss button, which renders beside
// the bar when `dismissButton` is set. `useVirtualKeyboard` is stubbed as a
// call recorder: the real hook publishes `--bn-vv-*` as a layout effect, which
// is what pins `.bn-mobile-formatting-toolbar` to the visual viewport in
// BlockNote 0.55+ — the test only needs to prove the controller mounts it.
jest.mock('@blocknote/react', () => ({
  FormattingToolbar: () => <div data-testid="default-formatting-toolbar" />,
  useBlockNoteEditor: jest.fn(() => ({ blur: jest.fn() })),
  useVirtualKeyboard: jest.fn(() => false),
  UIModeContext: {
    Provider: ({ children }: { children: ReactNode }) => <>{children}</>,
  },
  useComponentsContext: jest.fn(() => ({
    Generic: {
      Toolbar: {
        Button: ({ label }: { label?: string }) => (
          <button type="button" data-test="mobileBlurEditorButton" aria-label={label} />
        ),
      },
    },
  })),
}));

const LAYOUT_HEIGHT = 768;
const KEYBOARD_HEIGHT = 320;

/**
 * jsdom has no Visual Viewport API, and the hook measures the keyboard as the
 * gap between the layout viewport and it.
 */
class FakeVisualViewport extends EventTarget {
  height = LAYOUT_HEIGHT;
  offsetTop = 0;
}

function stubLayout(viewportHeight = LAYOUT_HEIGHT) {
  const viewport = new FakeVisualViewport();
  viewport.height = viewportHeight;

  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: viewport,
  });
  Object.defineProperty(document.documentElement, 'clientHeight', {
    configurable: true,
    get: () => LAYOUT_HEIGHT,
  });

  return viewport;
}

/** Stands in for the editor's focus state, which only the controller reads. */
function stubEditor(focused = true) {
  const state = { focused };

  return {
    editor: { isFocused: () => state.focused },
    setEditorFocused: (next: boolean) => {
      state.focused = next;
    },
  };
}

function focusEditable() {
  const editor = document.createElement('textarea');
  document.body.appendChild(editor);
  editor.focus();
  return editor;
}

/** Re-renders triggered by layout events have to be flushed before asserting. */
function emitViewportChange(viewport: EventTarget) {
  act(() => {
    viewport.dispatchEvent(new Event('resize'));
  });
}

/**
 * The controller settles focus in a microtask so that the `focusout` and the
 * `focusin` of a single focus change are both observed before it decides.
 */
async function settleFocus() {
  await act(async () => {});
}

function getBar() {
  return document.querySelector('.bn-mobile-formatting-toolbar') as HTMLElement;
}

function getBoldButton() {
  // The bar is hidden from the accessibility tree while it has no cursor.
  return screen.getByRole('button', { name: 'Bold', hidden: true });
}

function stubToolbar(onClick: () => void) {
  return function Toolbar() {
    return (
      <button type="button" onClick={onClick}>
        Bold
      </button>
    );
  };
}

/**
 * An open dropdown of the bar's own, as Base UI leaves it in the DOM: the
 * trigger carries `aria-expanded` (`Select`, the block type) or `data-popup-open`
 * (`Menu`, the colours), and the popup itself is portalled out of the bar.
 */
function getTrigger() {
  // Not `getByRole`: the bar is only reachable through the DOM while hidden.
  return getBar().querySelector('button') as HTMLButtonElement;
}

function markPopupOpen(attribute: 'aria-expanded' | 'data-popup-open') {
  return act(async () => {
    getTrigger().setAttribute(attribute, attribute === 'aria-expanded' ? 'true' : '');
  });
}

function markPopupClosed() {
  return act(async () => {
    getTrigger().removeAttribute('aria-expanded');
    getTrigger().removeAttribute('data-popup-open');
  });
}

/** A focusable stand-in for a portalled popup item, owner of no focus ring. */
function focusableOutside() {
  const outside = document.createElement('div');
  outside.tabIndex = 0;
  document.body.appendChild(outside);
  return outside;
}

afterEach(() => {
  // Focus and both stubs outlive a single test: jsdom keeps one document, and
  // the properties below are redefined per test.
  (document.activeElement as HTMLElement | null)?.blur?.();
  delete (window as { visualViewport?: unknown }).visualViewport;
  delete (document.documentElement as { clientHeight?: unknown }).clientHeight;
});

describe('MobileFormattingToolbarController', () => {
  it('lets BlockNote position the bar from the visual viewport instead of an inline bottom', async () => {
    const { useVirtualKeyboard } = await import('@blocknote/react');
    stubLayout();
    const { editor } = stubEditor();

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );

    expect(getBar().contains(getBoldButton())).toBe(true);
    // BlockNote 0.55 pins `.bn-mobile-formatting-toolbar` with
    // `translate(var(--bn-vv-*)...)`; an inline `bottom` loses to its `top: 0`
    // while leaving that off-screen transform in place, which is what hid the
    // bar above the viewport after the upgrade.
    expect(getBar().style.bottom).toBe('');
    expect(useVirtualKeyboard).toHaveBeenCalled();
  });

  it('falls back to BlockNote’s toolbar when no custom one is given', () => {
    stubLayout();
    const { editor } = stubEditor();

    render(<MobileFormattingToolbarController editor={editor} />);

    expect(screen.getByTestId('default-formatting-toolbar')).toBeInTheDocument();
  });

  it('renders the dismiss button beside the scrolling row, not inside it', () => {
    stubLayout();
    const { editor } = stubEditor();

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
        dismissButton
      />
    );

    const bar = getBar();
    const dismiss = document.querySelector('[data-test="mobileBlurEditorButton"]') as HTMLElement;

    expect(dismiss).toBeInTheDocument();
    // A sibling of the scrolling row is what keeps it fixed at the right edge
    // while the buttons scroll; inside the row it would move with scroll.
    expect(bar.firstElementChild!.contains(dismiss)).toBe(false);
    expect(bar.lastElementChild).toBe(dismiss);
  });

  it('renders no dismiss button unless asked', () => {
    stubLayout();
    const { editor } = stubEditor();

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );

    expect(document.querySelector('[data-test="mobileBlurEditorButton"]')).toBeNull();
  });

  it('keeps the same toolbar DOM across re-renders so its buttons stay live', () => {
    stubLayout();
    const { editor } = stubEditor();
    const onClick = jest.fn();
    const Toolbar = stubToolbar(onClick);

    const { rerender } = render(
      <MobileFormattingToolbarController editor={editor} formattingToolbar={Toolbar} />
    );
    const button = getBoldButton();

    // Stands in for any parent render (document meta, presence, comments): the
    // upstream controller swaps the bar for a static HTML snapshot here, which
    // silently detaches every handler inside it.
    rerender(<MobileFormattingToolbarController editor={editor} formattingToolbar={Toolbar} />);

    expect(getBoldButton()).toBe(button);
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('keeps the bar positioned by the viewport while the keyboard opens and closes', async () => {
    const { useVirtualKeyboard } = await import('@blocknote/react');
    const viewport = stubLayout();
    const editor = focusEditable();
    const { editor: editorStub } = stubEditor();

    render(
      <MobileFormattingToolbarController
        editor={editorStub}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );

    // Keyboard tracking lives in BlockNote's visual-viewport vars now, not in
    // an inline offset: viewport changes must never write one back.
    viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT;
    emitViewportChange(viewport);
    expect(getBar().style.bottom).toBe('');

    viewport.height = LAYOUT_HEIGHT;
    emitViewportChange(viewport);
    expect(getBar().style.bottom).toBe('');
    expect(useVirtualKeyboard).toHaveBeenCalled();
    editor.remove();
  });

  it('never writes an inline bottom for a viewport gap without editing', () => {
    // Focus survives between tests in jsdom's single document.
    (document.activeElement as HTMLElement | null)?.blur?.();
    const viewport = stubLayout();
    const { editor } = stubEditor();

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );

    viewport.height = LAYOUT_HEIGHT - KEYBOARD_HEIGHT;
    emitViewportChange(viewport);

    expect(getBar().style.bottom).toBe('');
  });

  it('stays hidden until the editor takes the cursor', async () => {
    stubLayout();
    const { editor, setEditorFocused } = stubEditor(false);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );

    expect(getBar().style.visibility).toBe('hidden');
    expect(getBar().getAttribute('aria-hidden')).toBe('true');

    setEditorFocused(true);
    await act(async () => {
      fireEvent.focusIn(document.body);
    });
    await settleFocus();

    expect(getBar().style.visibility).toBe('');
    expect(getBar().getAttribute('aria-hidden')).toBe('false');
  });

  it('hides the bar again once focus leaves the editor and the bar', async () => {
    stubLayout();
    const { editor, setEditorFocused } = stubEditor(true);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );
    await settleFocus();
    expect(getBar().style.visibility).toBe('');

    // Tapping the document title, a comment field, or anywhere else on the page.
    const outside = focusEditable();
    setEditorFocused(false);
    await act(async () => {
      fireEvent.focusOut(getBar());
      fireEvent.focusIn(outside);
    });
    await settleFocus();

    expect(getBar().style.visibility).toBe('hidden');
    outside.remove();
  });

  it('stays up while a finger is down on it so the tap is not swallowed', async () => {
    stubLayout();
    const { editor, setEditorFocused } = stubEditor(true);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );
    await settleFocus();
    expect(getBar().style.visibility).toBe('');

    // A browser that blurs the contenteditable to the page rather than focusing
    // the button (iOS): the bar must outlive the press, or the click lands on
    // whatever ends up behind it.
    setEditorFocused(false);
    await act(async () => {
      fireEvent.pointerDown(getBar());
      fireEvent.focusOut(getBar());
    });
    await settleFocus();

    expect(getBar().style.visibility).toBe('');

    await act(async () => {
      fireEvent.click(getBar());
    });

    expect(getBar().style.visibility).toBe('hidden');
  });

  it('clears the gesture and hides when a press on the bar is released without a click (drag-off)', async () => {
    stubLayout();
    const { editor, setEditorFocused } = stubEditor(true);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );
    await settleFocus();
    expect(getBar().style.visibility).toBe('');

    // Editor blurs, finger is down on the bar
    setEditorFocused(false);
    await act(async () => {
      fireEvent.pointerDown(getBar());
      fireEvent.focusOut(getBar());
    });
    await settleFocus();
    expect(getBar().style.visibility).toBe('');

    // Finger is dragged off and released on window without a click dispatched to the bar
    await act(async () => {
      window.dispatchEvent(new Event('pointerup'));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(getBar().style.visibility).toBe('hidden');
  });

  it('clears the gesture and hides on lostpointercapture', async () => {
    stubLayout();
    const { editor, setEditorFocused } = stubEditor(true);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );
    await settleFocus();
    expect(getBar().style.visibility).toBe('');

    setEditorFocused(false);
    await act(async () => {
      fireEvent.pointerDown(getBar());
      fireEvent.focusOut(getBar());
    });
    await settleFocus();
    expect(getBar().style.visibility).toBe('');

    await act(async () => {
      fireEvent.lostPointerCapture(getBar());
    });

    expect(getBar().style.visibility).toBe('hidden');
  });

  it('stays up while focus sits on one of its own buttons', async () => {
    stubLayout();
    const { editor, setEditorFocused } = stubEditor(true);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );
    await settleFocus();

    // Tapping a button moves focus out of the contenteditable on some mobile
    // browsers; hiding the bar here would pull the button out from under the tap.
    const button = getBoldButton();
    setEditorFocused(false);
    await act(async () => {
      button.focus();
      fireEvent.focusOut(document.body);
      fireEvent.focusIn(button);
    });
    await settleFocus();

    expect(getBar().style.visibility).toBe('');
  });

  it('stays up while one of its own dropdowns is open, with no cursor anywhere', async () => {
    stubLayout();
    const { editor } = stubEditor(false);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );
    await settleFocus();

    // Opening a popup moves focus into the portalled popup (block type) or keeps
    // it on the trigger (colours); either way the editor has no cursor, which is
    // what used to hide the bar out from under its own menu.
    await markPopupOpen('aria-expanded');
    await settleFocus();
    expect(getBar().style.visibility).toBe('');

    await markPopupClosed();
    await settleFocus();
    expect(getBar().style.visibility).toBe('hidden');
  });

  it('does not flicker when touches inside an open dropdown move focus', async () => {
    stubLayout();
    const { editor, setEditorFocused } = stubEditor(true);

    render(
      <MobileFormattingToolbarController
        editor={editor}
        formattingToolbar={stubToolbar(jest.fn())}
      />
    );
    await settleFocus();

    const trigger = getTrigger();
    const popupItem = focusableOutside();
    setEditorFocused(false);
    await markPopupOpen('data-popup-open');
    await settleFocus();

    // Every touch inside the menu moves focus once: into the item that was
    // touched, and back onto the button that opened it. Each of those on its own
    // reads as "the cursor left the editor", so the bar used to blink.
    for (const target of [popupItem, trigger, popupItem]) {
      await act(async () => {
        target.focus();
      });
      await settleFocus();
      expect(getBar().style.visibility).toBe('');
    }

    // Picking an item closes the menu and hands focus back to the editor.
    await markPopupClosed();
    await settleFocus();
    expect(getBar().style.visibility).toBe('hidden');
    popupItem.remove();
  });
});
