import { act, render, screen } from '@testing-library/react';
import { getColspan, getNodeById, getRowspan } from '@blocknote/core';
import { useBlockNoteEditor, useExtensionState } from '@blocknote/react';
import {
  CustomTableHandlesController,
  getVisibleHorizontalSpan,
  isCellWithinWrapper,
} from '../../../components/editor/TableHandlesController';

const mockTableHandleProps: Record<string, { hideOtherElements: (hide: boolean) => void }> = {};
let mockUnfreezeHandles: jest.Mock;

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
    TableHandle: ({
      orientation,
      hideOtherElements,
    }: {
      orientation?: string;
      hideOtherElements?: (hide: boolean) => void;
    }) => {
      if (orientation && hideOtherElements) {
        mockTableHandleProps[orientation] = { hideOtherElements };
      }

      return <div data-testid={`table-handle-${orientation}`} />;
    },
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
    for (const key of Object.keys(mockTableHandleProps)) {
      delete mockTableHandleProps[key];
    }
    mockUnfreezeHandles = jest.fn();
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
      getExtension: () => ({
        hideHandlesIfNotFrozen: jest.fn(),
        unfreezeHandles: mockUnfreezeHandles,
      }),
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

  it('clips the column anchor to the visible wrapper', () => {
    expect(getVisibleHorizontalSpan({ left: 40, right: 120 }, { left: 60, right: 200 })).toEqual({
      left: 60,
      width: 60,
    });
    expect(getVisibleHorizontalSpan({ left: 10, right: 40 }, { left: 60, right: 200 })).toEqual({
      left: 60,
      width: 0,
    });
    expect(getVisibleHorizontalSpan({ left: 150, right: 260 }, { left: 60, right: 200 })).toEqual({
      left: 150,
      width: 50,
    });
  });

  it('unfreezes the table handles when an open column menu unmounts', () => {
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

    const { unmount } = render(<CustomTableHandlesController />);

    act(() => mockTableHandleProps.column.hideOtherElements(true));
    unmount();

    expect(mockUnfreezeHandles).toHaveBeenCalledTimes(1);
  });

  it('keeps a freeze owned by another handle when the column handle unmounts', () => {
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

    // Opening the row menu hides (and unmounts) the column handle.
    act(() => mockTableHandleProps.row.hideOtherElements(true));

    expect(screen.queryByTestId('table-handle-column')).toBeNull();
    expect(mockUnfreezeHandles).not.toHaveBeenCalled();
  });

  it('releases the column menu state once the cell scrolls out of the wrapper', () => {
    const wrapper = document.createElement('div');
    wrapper.className = 'tableWrapper';
    const table = document.createElement('div');
    const cell = document.createElement('div');
    wrapper.append(table);
    table.append(cell);
    document.body.append(wrapper);

    let cellLeft = 80;
    const rect = (left: number, right: number) =>
      ({ left, right, top: 0, bottom: 20, width: right - left, height: 20 }) as DOMRect;
    cell.getBoundingClientRect = () => rect(cellLeft, cellLeft + 40);
    table.getBoundingClientRect = () => rect(60, 200);
    wrapper.getBoundingClientRect = () => rect(60, 200);

    (useBlockNoteEditor as jest.Mock).mockReturnValue({
      settings: { tables: { splitCells: true } },
      prosemirrorState: { doc: { resolve: () => ({ posAtIndex: () => 0 }) } },
      prosemirrorView: {
        domAtPos: jest
          .fn()
          .mockReturnValueOnce({ node: table })
          .mockReturnValueOnce({ node: cell })
          .mockReturnValue({ node: table }),
      },
      getExtension: () => ({
        hideHandlesIfNotFrozen: jest.fn(),
        unfreezeHandles: mockUnfreezeHandles,
      }),
    });
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

    act(() => mockTableHandleProps.column.hideOtherElements(true));

    expect(screen.queryByTestId('table-handle-row')).toBeNull();

    cellLeft = -100;
    act(() => {
      wrapper.dispatchEvent(new Event('scroll'));
    });

    expect(screen.queryByTestId('table-handle-column')).toBeNull();
    expect(screen.getByTestId('table-handle-row')).toBeDefined();
    expect(mockUnfreezeHandles).toHaveBeenCalledTimes(1);

    wrapper.remove();
  });
});
