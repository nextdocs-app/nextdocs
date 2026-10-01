import { fireEvent, render, screen } from '@testing-library/react';
import { useBlockNoteEditor } from '@blocknote/react';
import { MobileBlurEditorButton } from '../../../components/editor/MobileBlurEditorButton';

jest.mock('@blocknote/react', () => ({
  useBlockNoteEditor: jest.fn(),
  useComponentsContext: jest.fn(() => ({
    Generic: {
      Toolbar: {
        Button: ({ label, onClick }: { label?: string; onClick?: () => void }) => (
          <button type="button" aria-label={label} onClick={onClick} />
        ),
      },
    },
  })),
}));

const blur = jest.fn();

function stubEditor() {
  (useBlockNoteEditor as jest.Mock).mockReturnValue({ blur });
}

function clickDismiss() {
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss keyboard' }));
}

beforeEach(() => {
  jest.clearAllMocks();
  stubEditor();
});

describe('MobileBlurEditorButton', () => {
  it('blurs the editor, which is what drops the caret and the keyboard', () => {
    render(<MobileBlurEditorButton />);
    clickDismiss();

    expect(blur).toHaveBeenCalledTimes(1);
  });

  it('gives up its own focus first, or the bar would stay up over no caret', () => {
    render(<MobileBlurEditorButton />);
    const button = screen.getByRole('button', { name: 'Dismiss keyboard' });
    button.focus();
    expect(document.activeElement).toBe(button);

    fireEvent.click(button);

    // Focus left the button; the controller reads no focus inside the bar and
    // hides it, which is the point of the button.
    expect(document.activeElement).not.toBe(button);
  });
});
