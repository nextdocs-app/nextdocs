import { render, screen } from '@testing-library/react';
import { getColspan, getNodeById, getRowspan } from '@blocknote/core';
import { useBlockNoteEditor, useExtensionState } from '@blocknote/react';
import {
  CustomTableHandlesController,
  isCellWithinWrapper,
} from '../../../components/editor/TableHandlesController';

jest.mock('@blocknote/core', () => ({
  isTableCell: jest.fn((cell) => Boolean(cell && typeof cell === 'object')),
  getColspan: jest.fn(() => 1),
  getRowspan: jest.fn(() => 1),
  getNodeById: jest.fn(),
}));

jest.mock('@blocknote/core/extensions', () => ({
  TableHandlesExtension: { key: 'tableHandles' },
}));

jest.mock('@blocknote/react', () => {
  const Container = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;

  return {
    useBlockNoteEditor: jest.fn(),
    useExtensionState: jest.fn(),
    useComponentsContext: jest.fn(() => ({
      Generic: { Menu: { Dropdown: Container } },
    })),
    PortalElementOverride: Container,
    GenericPopover: Container,
    TableHandle: ({ orientation }: { orientation?: string }) => (
      <div data-testid={`table-handle-${orientation}`} />
    ),
    ExtendButton: ({ orientation }: { orientation?: string }) => (
      <div data-testid={`extend-button-${orientation}`} />
    ),
    TableCellButton: ({ tableCellMenu: Menu }: { tableCellMenu?: React.FC }) => (
      <div data-testid="table-cell-handle">{Menu ? <Menu /> : null}</div>
    ),
    SplitButton: () => <button data-testid="split-cell">Split cell</button>,
  };
});

describe('CustomTableHandlesController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getColspan as jest.Mock).mockReturnValue(1);
    (getRowspan as jest.Mock).mockReturnValue(1);
    (getNodeById as jest.Mock).mockReturnValue({ posBeforeNode: 0 });
    (useBlockNoteEditor as jest.Mock).mockReturnValue({
      settings: { tables: { splitCells: true } },
      prosemirrorState: {
        doc: { resolve: () => ({ posAtIndex: () => 0 }) },
      },
      prosemirrorView: {
        domAtPos: jest
          .fn()
          .mockReturnValueOnce({ node: document.createElement('div') })
          .mockReturnValueOnce({ node: document.createElement('div') }),
      },
      getExtension: () => ({ hideHandlesIfNotFrozen: jest.fn() }),
    });
  });

  it('renders nothing while no table is hovered', () => {
    (useExtensionState as jest.Mock).mockReturnValue(undefined);

    const { container } = render(<CustomTableHandlesController />);

    expect(container.innerHTML).toBe('');
  });

  it('renders the split-only cell handle for a merged cell', () => {
    (getRowspan as jest.Mock).mockReturnValue(2);
    (useExtensionState as jest.Mock).mockReturnValue({
      show: true,
      rowIndex: 0,
      colIndex: 0,
      showAddOrRemoveRowsButton: false,
      showAddOrRemoveColumnsButton: false,
      block: {
        id: 'table-1',
        content: {
          rows: [{ cells: [{ type: 'tableCell', props: {}, content: [] }] }],
        },
      },
    });

    render(<CustomTableHandlesController />);

    expect(screen.getByTestId('table-handle-row')).toBeDefined();
    expect(screen.getByTestId('table-handle-column')).toBeDefined();
    expect(screen.getByTestId('table-cell-handle')).toBeDefined();
    expect(screen.getByTestId('split-cell')).toBeDefined();
  });

  it('does not render the cell handle for an unmerged cell', () => {
    (useExtensionState as jest.Mock).mockReturnValue({
      show: true,
      rowIndex: 0,
      colIndex: 0,
      showAddOrRemoveRowsButton: false,
      showAddOrRemoveColumnsButton: false,
      block: {
        id: 'table-1',
        content: {
          rows: [{ cells: [{ type: 'tableCell', props: {}, content: [] }] }],
        },
      },
    });

    render(<CustomTableHandlesController />);

    expect(screen.queryByTestId('table-cell-handle')).toBeNull();
  });

  it('keeps the cell handle visible only while it overlaps the wrapper', () => {
    expect(isCellWithinWrapper({ left: 0, right: 10 }, { left: 5, right: 20 })).toBe(true);
    expect(isCellWithinWrapper({ left: 0, right: 4 }, { left: 5, right: 20 })).toBe(false);
    expect(isCellWithinWrapper({ left: 25, right: 30 }, { left: 5, right: 20 })).toBe(false);
  });
});
