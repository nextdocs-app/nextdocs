import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import Editor from '../../../components/Editor';
import { useDocument } from '../../../hooks/useDocument.hook';
import { useParams } from 'next/navigation';
import { useCreateBlockNote } from '@blocknote/react';
import * as Y from 'yjs';

// Mock hooks
jest.mock('../../../hooks/useDocument.hook');
jest.mock('../../../hooks/useYjsPersistence.hook');
jest.mock('next/navigation');
jest.mock('../../../hooks/useTheme.hook', () => ({
  useTheme: jest.fn(() => ({ theme: 'system', setTheme: jest.fn(), resolvedTheme: 'light' })),
}));

// Mock BlockNote
jest.mock('@blocknote/react', () => ({
  useCreateBlockNote: jest.fn(() => ({
    document: [{ content: [] }],
    focus: jest.fn(),
  })),
}));

jest.mock('@blocknote/shadcn', () => ({
  BlockNoteView: jest.fn(() => <div data-testid="blocknote-view" />),
}));

describe('Editor Component', () => {
  const mockUpdateMeta = jest.fn();
  const mockYdoc = new Y.Doc();
  const mockMeta = {
    title: 'Untitled',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (useParams as jest.Mock).mockReturnValue({
      id: 'test-doc-id',
    });
    (useDocument as jest.Mock).mockReturnValue({
      ydoc: mockYdoc,
      meta: mockMeta,
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should show loading state after delay', async () => {
    (useDocument as jest.Mock).mockReturnValue({
      ydoc: null,
      meta: null,
      isLoading: true,
      error: null,
    });

    render(<Editor />);

    expect(screen.queryByText(/Loading document.../i)).not.toBeInTheDocument();

    await waitFor(
      () => {
        expect(screen.getByText(/Loading document.../i)).toBeInTheDocument();
      },
      { timeout: 500 }
    );
  });

  it('should show error state', () => {
    (useDocument as jest.Mock).mockReturnValue({
      ydoc: null,
      meta: null,
      isLoading: false,
      error: new Error('Failed to load'),
    });

    render(<Editor />);
    expect(screen.getByText(/Failed to load document: Failed to load/i)).toBeInTheDocument();
  });

  it('should render title input and auto-focus for new documents', () => {
    render(<Editor />);

    const textarea = screen.getByPlaceholderText(/Untitled/i) as HTMLTextAreaElement;
    expect(textarea).toBeInTheDocument();
    expect(textarea.value).toBe(''); // "Untitled" is shown as empty with placeholder
    expect(document.activeElement).toBe(textarea);
  });

  it('should update title on change', () => {
    render(<Editor />);

    const textarea = screen.getByPlaceholderText(/Untitled/i);
    fireEvent.change(textarea, { target: { value: 'New Document Title' } });

    expect(mockUpdateMeta).toHaveBeenCalledWith({ title: 'New Document Title' });
  });

  it('should focus editor when Enter is pressed in title', async () => {
    jest.useFakeTimers();
    const mockFocus = jest.fn();
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [] }],
      focus: mockFocus,
    });

    render(<Editor />);

    const textarea = screen.getByPlaceholderText(/Untitled/i);
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Advance timers for the setTimeout in handleKeyDown
    act(() => {
      jest.advanceTimersByTime(50);
    });

    // Should focus editor
    expect(mockFocus).toHaveBeenCalled();
  });

  it('should show editor if document has content', () => {
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [{ type: 'text', text: 'hello' }] }],
      focus: jest.fn(),
    });

    render(<Editor />);

    // Editor should be visible because it has content even if title is "Untitled"
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
  });

  it('should hide editor for new untitled documents and keep it hidden while typing title', () => {
    const mockFocus = jest.fn();
    (useCreateBlockNote as jest.Mock).mockReturnValue({
      document: [{ content: [] }],
      focus: mockFocus,
    });

    const { rerender } = render(<Editor />);

    // Editor should be hidden initially
    expect(screen.queryByTestId('blocknote-view')).not.toBeInTheDocument();

    // Type a title (re-render with updated meta)
    (useDocument as jest.Mock).mockReturnValue({
      ydoc: mockYdoc,
      meta: { ...mockMeta, title: 'M' },
      isLoading: false,
      error: null,
      updateMeta: mockUpdateMeta,
    });

    rerender(<Editor />);

    // Editor should still be hidden after typing title
    expect(screen.queryByTestId('blocknote-view')).not.toBeInTheDocument();

    // Press Enter
    const textarea = screen.getByPlaceholderText(/Untitled/i);
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Now it should be visible
    expect(screen.getByTestId('blocknote-view')).toBeInTheDocument();
  });
});
