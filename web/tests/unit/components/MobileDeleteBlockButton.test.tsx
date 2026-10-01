import { fireEvent, render, screen } from '@testing-library/react';
import { useBlockNoteEditor } from '@blocknote/react';
import { MobileDeleteBlockButton } from '../../../components/editor/MobileDeleteBlockButton';

jest.mock('@blocknote/react', () => ({
  useBlockNoteEditor: jest.fn(),
  useDictionary: jest.fn(() => ({ drag_handle: { delete_menuitem: 'Delete' } })),
  useComponentsContext: jest.fn(() => ({
    FormattingToolbar: {
      Button: ({ label, onClick }: { label?: string; onClick?: () => void }) => (
        <button type="button" aria-label={label} onClick={onClick} />
      ),
    },
  })),
}));

function stubEditor(currentBlock: { id: string }) {
  const editor = {
    getTextCursorPosition: jest.fn(() => ({ block: currentBlock })),
    removeBlocks: jest.fn(),
    focus: jest.fn(),
  };
  (useBlockNoteEditor as jest.Mock).mockReturnValue(editor);

  return editor;
}

function clickDeleteBlock() {
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('MobileDeleteBlockButton', () => {
  it('removes the block the text cursor sits in', () => {
    const editor = stubEditor({ id: 'block-2' });

    render(<MobileDeleteBlockButton />);
    clickDeleteBlock();

    expect(editor.removeBlocks).toHaveBeenCalledWith(['block-2']);
    expect(editor.removeBlocks).toHaveBeenCalledTimes(1);
  });

  it('refocuses the editor so the keyboard and the docked bar stay up', () => {
    const editor = stubEditor({ id: 'block-2' });

    render(<MobileDeleteBlockButton />);
    clickDeleteBlock();

    expect(editor.focus).toHaveBeenCalledTimes(1);
  });

  it('reads the cursor position before the block is gone', () => {
    const editor = stubEditor({ id: 'block-2' });

    render(<MobileDeleteBlockButton />);
    clickDeleteBlock();

    // Reading it afterwards would name the block BlockNote moved the cursor to,
    // not the one the user was editing.
    expect(editor.getTextCursorPosition.mock.invocationCallOrder[0]).toBeLessThan(
      editor.removeBlocks.mock.invocationCallOrder[0]
    );
    expect(editor.removeBlocks.mock.invocationCallOrder[0]).toBeLessThan(
      editor.focus.mock.invocationCallOrder[0]
    );
  });
});
