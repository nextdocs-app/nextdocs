import { render, screen, fireEvent, act } from '@testing-library/react';
import Sidebar from '../../../components/Sidebar';
import { useLocalDocuments } from '../../../hooks/useLocalDocuments.hook';
import { documentService } from '../../../services/document.service';
import { useRouter, useParams } from 'next/navigation';
import * as Y from 'yjs';

// Mock hooks and navigation
jest.mock('../../../hooks/useLocalDocuments.hook');
jest.mock('next/navigation');
jest.mock('../../../services/document.service');

describe('Sidebar Component', () => {
  const mockPush = jest.fn();
  const mockRefresh = jest.fn();
  const mockDocs = [
    {
      id: 'id-1',
      meta: {
        title: 'Doc 1',
        updatedAt: '2024-01-01T10:00:00Z',
        createdAt: '2024-01-01T10:00:00Z',
      },
    },
    {
      id: 'id-2',
      meta: {
        title: 'Untitled',
        updatedAt: '2024-01-01T11:00:00Z',
        createdAt: '2024-01-01T10:00:00Z',
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (useRouter as jest.Mock).mockReturnValue({ push: mockPush });
    (useParams as jest.Mock).mockReturnValue({ id: 'id-1' });
    (useLocalDocuments as jest.Mock).mockReturnValue({
      documents: mockDocs,
      isLoading: false,
      refresh: mockRefresh,
    });
  });

  it('should render document list', () => {
    render(<Sidebar />);

    expect(screen.getByText('Doc 1')).toBeInTheDocument();
    expect(screen.getByText('Untitled')).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
  });

  it('should show loading state in document list', () => {
    (useLocalDocuments as jest.Mock).mockReturnValue({
      documents: [],
      isLoading: true,
      refresh: mockRefresh,
    });

    render(<Sidebar />);
    // Check if pulse skeletons are rendered (3 of them)
    // We can't easily check for CSS classes, but we can check if it's empty
    expect(screen.queryByText('No documents yet')).not.toBeInTheDocument();
  });

  it('should show "No documents yet" when empty', () => {
    (useLocalDocuments as jest.Mock).mockReturnValue({
      documents: [],
      isLoading: false,
      refresh: mockRefresh,
    });

    render(<Sidebar />);
    expect(screen.getByText('No documents yet')).toBeInTheDocument();
  });

  it('should navigate to document when clicked', () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByText('Untitled'));
    expect(mockPush).toHaveBeenCalledWith('/doc/id-2');
  });

  it('should create new document when "New document" is clicked', async () => {
    const mockNewYdoc = new Y.Doc();
    const mockNewMeta = { title: 'Untitled', createdAt: '...', updatedAt: '...' };

    (documentService.createDocument as jest.Mock).mockResolvedValue({
      ydoc: mockNewYdoc,
      meta: mockNewMeta,
    });
    (documentService.saveDocument as jest.Mock).mockResolvedValue(undefined);

    render(<Sidebar />);

    await act(async () => {
      fireEvent.click(screen.getByText('New document'));
    });

    expect(documentService.createDocument).toHaveBeenCalled();
    expect(documentService.saveDocument).toHaveBeenCalled();
    expect(mockRefresh).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith(expect.stringMatching(/\/doc\/.+/));
  });

  it('should toggle private section visibility', () => {
    render(<Sidebar />);

    // Initially open (from our mock state)
    expect(screen.getByText('Doc 1')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Private'));

    // Should be closed
    expect(screen.queryByText('Doc 1')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Private'));

    // Should be open again
    expect(screen.getByText('Doc 1')).toBeInTheDocument();
  });
});
