import { fireEvent, render, screen } from '@testing-library/react';
import { useBlockNoteEditor, useExtension } from '@blocknote/react';
import { MobileAddBlockButton } from '../../../components/editor/MobileAddBlockButton';

jest.mock('@blocknote/core/extensions', () => ({
  SuggestionMenu: { key: 'suggestionMenu' },
}));

jest.mock('@blocknote/react', () => ({
  useBlockNoteEditor: jest.fn(),
  useExtension: jest.fn(),
  useDictionary: jest.fn(() => ({ side_menu: { add_block_label: 'Add block' } })),
  useComponentsContext: jest.fn(() => ({
    FormattingToolbar: {
      Button: ({ label, onClick }: { label?: string; onClick?: () => void }) => (
        <button type="button" aria-label={label} onClick={onClick} />
      ),
    },
  })),
}));

const openSuggestionMenu = jest.fn();
const suggestionMenuPluginKey = { key: 'suggestionMenuPluginKey' };

function stubSuggestionMenuExtension(prosemirrorPlugins: unknown[] | undefined) {
  (useExtension as jest.Mock).mockReturnValue({
    openSuggestionMenu,
    prosemirrorPlugins,
  });
}

function stubEditor(block: { id: string; content?: unknown[] }) {
  const tr = {
    scrollIntoView: jest.fn(),
    setMeta: jest.fn(),
  };
  // `tr.scrollIntoView().setMeta(...)` chaining, as ProseMirror's Transaction
  // allows.
  tr.scrollIntoView.mockReturnValue(tr);
  tr.setMeta.mockReturnValue(tr);
  const editor = {
    domElement: document.createElement('div'),
    getTextCursorPosition: jest.fn(() => ({ block })),
    setTextCursorPosition: jest.fn(),
    insertBlocks: jest.fn(() => [{ id: 'inserted' }]),
    transact: jest.fn((fn: (tr: unknown) => void) => fn(tr)),
    blur: jest.fn(),
  };
  (useBlockNoteEditor as jest.Mock).mockReturnValue(editor);

  return { editor, tr };
}

function clickAddBlock() {
  fireEvent.click(screen.getByRole('button', { name: 'Add block' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  stubSuggestionMenuExtension([{ spec: { key: suggestionMenuPluginKey } }]);
});

describe('MobileAddBlockButton', () => {
  it('opens the slash menu on an empty block without inserting anything', () => {
    const block = { id: 'block-1', content: [] };
    const { editor, tr } = stubEditor(block);

    render(<MobileAddBlockButton />);
    clickAddBlock();

    expect(editor.setTextCursorPosition).toHaveBeenCalledWith(block);
    expect(editor.insertBlocks).not.toHaveBeenCalled();
    expect(tr.setMeta).toHaveBeenCalledWith(suggestionMenuPluginKey, {
      triggerCharacter: '/',
      deleteTriggerCharacter: false,
      ignoreQueryLength: false,
    });
  });

  it('adds an empty paragraph below a block that already has content', () => {
    const block = { id: 'block-1', content: [{ type: 'text', text: 'Hello' }] };
    const { editor } = stubEditor(block);

    render(<MobileAddBlockButton />);
    clickAddBlock();

    expect(editor.insertBlocks).toHaveBeenCalledWith([{ type: 'paragraph' }], block, 'after');
    expect(editor.setTextCursorPosition).toHaveBeenCalledWith({ id: 'inserted' });
  });

  it('drops editor focus before the menu opens so the menu gets the keyboard’s space', () => {
    const { editor, tr } = stubEditor({ id: 'block-1', content: [] });

    render(<MobileAddBlockButton />);
    clickAddBlock();

    expect(editor.blur).toHaveBeenCalledTimes(1);
    expect(tr.setMeta).toHaveBeenCalled();
    // A blur after the menu exists closes it: the suggestion plugin drops its
    // state for any transaction carrying tiptap's `blur` meta.
    expect(editor.blur.mock.invocationCallOrder[0]).toBeLessThan(
      editor.transact.mock.invocationCallOrder[0]
    );
    // The public opener focuses the editor again, which brings the keyboard
    // back — so it must not be the path taken here.
    expect(openSuggestionMenu).not.toHaveBeenCalled();
  });

  it('falls back to the public opener when the plugin is not exposed', () => {
    stubSuggestionMenuExtension(undefined);
    stubEditor({ id: 'block-1', content: [] });

    render(<MobileAddBlockButton />);
    clickAddBlock();

    expect(openSuggestionMenu).toHaveBeenCalledWith('/');
  });
});
