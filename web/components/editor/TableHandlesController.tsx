'use client';

// Forked from @blocknote/react 0.57.0:
//   src/components/TableHandles/TableHandlesController.tsx
//
// Deliberate deltas:
// - Row/column handles are pinned to the table wrapper's visible edge so a
//   horizontally scrolled table cannot push them into the sidebar.
// - Column-handle visibility follows the wrapper's scroll position instead of
//   the stale rect captured when the extension state last changed.
// - The cell handle is kept, but its menu contains only SplitButton so the
//   cell background/text-color menu cannot duplicate the toolbar picker.
//
// Upstream is MPL-2.0; keep this notice with the copied code.

import {
  type BlockSchema,
  type DefaultInlineContentSchema,
  type DefaultStyleSchema,
  getColspan,
  getNodeById,
  getRowspan,
  type InlineContentSchema,
  isTableCell,
  type StyleSchema,
} from '@blocknote/core';
import { TableHandlesExtension } from '@blocknote/core/extensions';
import { autoUpdate, offset, type ReferenceElement, size } from '@floating-ui/react';
import {
  ExtendButton,
  type ExtendButtonProps,
  GenericPopover,
  type GenericPopoverReference,
  PortalElementOverride,
  SplitButton,
  TableCellButton,
  TableHandle,
  type TableHandleProps,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
} from '@blocknote/react';
import { type FC, useCallback, useLayoutEffect, useMemo, useState } from 'react';

const SplitOnlyCellMenu = () => {
  const Components = useComponentsContext()!;

  return (
    <Components.Generic.Menu.Dropdown className="bn-menu-dropdown bn-table-handle-menu">
      <SplitButton />
    </Components.Generic.Menu.Dropdown>
  );
};

/** True while the cell still overlaps the visible table wrapper. */
export function isCellWithinWrapper(
  cellRect: Pick<DOMRect, 'left' | 'right'>,
  wrapperRect: Pick<DOMRect, 'left' | 'right'>
): boolean {
  return cellRect.right >= wrapperRect.left && cellRect.left <= wrapperRect.right;
}

type TableReferences = {
  tableReference?: GenericPopoverReference;
  cellReference?: GenericPopoverReference;
  rowReference?: GenericPopoverReference;
  columnReference?: GenericPopoverReference;
  cellElement?: HTMLElement;
  wrapperElement?: HTMLElement;
};

export const CustomTableHandlesController = <
  I extends InlineContentSchema = DefaultInlineContentSchema,
  S extends StyleSchema = DefaultStyleSchema,
>(props: {
  tableHandle?: FC<TableHandleProps>;
  extendButton?: FC<ExtendButtonProps>;
  portalElement?: HTMLElement;
}) => {
  const editor = useBlockNoteEditor<BlockSchema, I, S>();

  const [onlyShownElement, setOnlyShownElement] = useState<
    | 'rowTableHandle'
    | 'columnTableHandle'
    | 'tableCellHandle'
    | 'extendRowsButton'
    | 'extendColumnsButton'
    | undefined
  >();

  const state = useExtensionState(TableHandlesExtension);

  const references = useMemo<TableReferences>(() => {
    if (!state) {
      return {};
    }

    const nodePosInfo = getNodeById(state.block.id, editor.prosemirrorState.doc);
    if (!nodePosInfo) {
      return {};
    }

    const tableBeforePos = nodePosInfo.posBeforeNode + 1;
    const tableNode = editor.prosemirrorView.domAtPos(tableBeforePos + 1).node;
    if (!(tableNode instanceof HTMLElement)) {
      return {};
    }

    const tableWrapper = tableNode.closest<HTMLElement>('.tableWrapper');
    const getWrapperRect = () =>
      tableWrapper ? tableWrapper.getBoundingClientRect() : tableNode.getBoundingClientRect();

    const result: TableReferences = {
      tableReference: {
        element: tableNode,
        getBoundingClientRect: () => {
          const tableRect = tableNode.getBoundingClientRect();
          const wrapperRect = getWrapperRect();
          const visibleLeft = Math.max(tableRect.left, wrapperRect.left);
          const visibleRight = Math.min(tableRect.right, wrapperRect.right);
          const visibleWidth = Math.max(0, visibleRight - visibleLeft);

          return new DOMRect(visibleLeft, tableRect.top, visibleWidth, tableRect.height);
        },
      },
    };

    if (state.rowIndex === undefined || state.colIndex === undefined) {
      return result;
    }

    const rowBeforePos = editor.prosemirrorState.doc
      .resolve(tableBeforePos + 1)
      .posAtIndex(state.rowIndex);
    const cellBeforePos = editor.prosemirrorState.doc
      .resolve(rowBeforePos + 1)
      .posAtIndex(state.colIndex);

    const cellNode = editor.prosemirrorView.domAtPos(cellBeforePos + 1).node;
    if (!(cellNode instanceof HTMLElement)) {
      return result;
    }

    result.cellElement = cellNode;
    result.wrapperElement = tableWrapper ?? undefined;
    result.cellReference = { element: cellNode };

    result.rowReference = {
      element: tableNode,
      getBoundingClientRect: () => {
        const tableRect = tableNode.getBoundingClientRect();
        const currentWrapperRect = getWrapperRect();
        const currentCellRect = cellNode.getBoundingClientRect();

        // Pin the handle's X origin to the visible table wrapper boundary in the
        // editor gutter so horizontal scrolling never displaces it into the sidebar.
        const pinnedLeft = Math.max(tableRect.left, currentWrapperRect.left);

        return new DOMRect(
          pinnedLeft,
          state.draggingState && state.draggingState.draggedCellOrientation === 'row'
            ? state.draggingState.mousePos - currentCellRect.height / 2
            : currentCellRect.top,
          tableRect.width,
          currentCellRect.height
        );
      },
    };

    result.columnReference = {
      element: tableNode,
      getBoundingClientRect: () => {
        const tableRect = tableNode.getBoundingClientRect();
        const currentCellRect = cellNode.getBoundingClientRect();

        return new DOMRect(
          state.draggingState && state.draggingState.draggedCellOrientation === 'col'
            ? state.draggingState.mousePos - currentCellRect.width / 2
            : currentCellRect.left,
          tableRect.top,
          currentCellRect.width,
          tableRect.height
        );
      },
    };

    return result;
  }, [editor, state]);

  // The extension state only changes when the pointer moves over the table.
  // Watch the wrapper instead so a horizontally scrolled-out cell hides its
  // column handle immediately.
  const [isCellVisible, setIsCellVisible] = useState(true);
  useLayoutEffect(() => {
    const cell = references.cellElement;
    const wrapper = references.wrapperElement;

    if (!cell || !wrapper) {
      return;
    }

    const updateVisibility = () => {
      setIsCellVisible(
        isCellWithinWrapper(cell.getBoundingClientRect(), wrapper.getBoundingClientRect())
      );
    };

    updateVisibility();
    wrapper.addEventListener('scroll', updateVisibility, { passive: true });
    window.addEventListener('resize', updateVisibility);

    let observer: ResizeObserver | undefined;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(updateVisibility);
      observer.observe(wrapper);
      observer.observe(cell);
    }

    return () => {
      wrapper.removeEventListener('scroll', updateVisibility);
      window.removeEventListener('resize', updateVisibility);
      observer?.disconnect();
    };
  }, [references.cellElement, references.wrapperElement]);

  const whileElementsMounted = useCallback(
    (reference: ReferenceElement, floating: HTMLElement) => {
      let initialized = false;
      return autoUpdate(
        reference,
        floating,
        () => {
          if (!initialized) {
            initialized = true;
            return;
          }
          editor.getExtension(TableHandlesExtension)?.hideHandlesIfNotFrozen();
        },
        {
          ancestorScroll: true,
          ancestorResize: false,
          elementResize: false,
          layoutShift: false,
        }
      );
    },
    [editor]
  );

  const cellToSplit =
    state?.rowIndex !== undefined && state?.colIndex !== undefined
      ? state.block.content.rows[state.rowIndex]?.cells?.[state.colIndex]
      : undefined;
  const canSplitCell = Boolean(
    cellToSplit &&
    isTableCell(cellToSplit) &&
    editor.settings.tables.splitCells &&
    (getRowspan(cellToSplit) > 1 || getColspan(cellToSplit) > 1)
  );

  const floatingUIOptions = useMemo(() => {
    if (!state) {
      return undefined;
    }

    return {
      rowTableHandle: {
        useFloatingOptions: {
          open:
            state.show &&
            state.rowIndex !== undefined &&
            (!onlyShownElement || onlyShownElement === 'rowTableHandle'),
          placement: 'left' as const,
          middleware: [offset(-10)],
          whileElementsMounted,
        },
        focusManagerProps: {
          disabled: true,
        },
        elementProps: {
          style: {
            zIndex: 10,
          },
        },
      },
      columnTableHandle: {
        useFloatingOptions: {
          open:
            state.show &&
            state.colIndex !== undefined &&
            isCellVisible &&
            (!onlyShownElement || onlyShownElement === 'columnTableHandle'),
          placement: 'top' as const,
          middleware: [offset(-12)],
          whileElementsMounted,
        },
        focusManagerProps: {
          disabled: true,
        },
        elementProps: {
          style: {
            zIndex: 10,
          },
        },
      },
      tableCellHandle: {
        useFloatingOptions: {
          open:
            state.show &&
            canSplitCell &&
            (!onlyShownElement || onlyShownElement === 'tableCellHandle'),
          placement: 'top-end' as const,
          middleware: [offset({ mainAxis: -15, crossAxis: -1 })],
          whileElementsMounted,
        },
        focusManagerProps: {
          disabled: true,
        },
        elementProps: {
          style: {
            zIndex: 10,
          },
        },
      },
      extendRowsButton: {
        useFloatingOptions: {
          open:
            state.show &&
            state.showAddOrRemoveRowsButton &&
            (!onlyShownElement || onlyShownElement === 'extendRowsButton'),
          placement: 'bottom' as const,
          whileElementsMounted,
          middleware: [
            size({
              apply({ rects, elements }) {
                Object.assign(elements.floating.style, {
                  width: `${rects.reference.width}px`,
                });
              },
            }),
          ],
        },
        focusManagerProps: {
          disabled: true,
        },
        elementProps: {
          style: {
            zIndex: 10,
          },
        },
      },
      extendColumnsButton: {
        useFloatingOptions: {
          open:
            state.show &&
            state.showAddOrRemoveColumnsButton &&
            (!onlyShownElement || onlyShownElement === 'extendColumnsButton'),
          placement: 'right' as const,
          whileElementsMounted,
          middleware: [
            size({
              apply({ rects, elements }) {
                Object.assign(elements.floating.style, {
                  height: `${rects.reference.height}px`,
                });
              },
            }),
          ],
        },
        focusManagerProps: {
          disabled: true,
        },
        elementProps: {
          style: {
            zIndex: 10,
          },
        },
      },
    };
  }, [state, onlyShownElement, canSplitCell, isCellVisible, whileElementsMounted]);

  if (!state) {
    return null;
  }

  const TableHandleComponent = props.tableHandle || TableHandle;
  const ExtendButtonComponent = props.extendButton || ExtendButton;

  return (
    <PortalElementOverride target={props.portalElement}>
      <GenericPopover reference={references?.rowReference} {...floatingUIOptions?.rowTableHandle}>
        {state.show &&
          state.rowIndex !== undefined &&
          (!onlyShownElement || onlyShownElement === 'rowTableHandle') && (
            <TableHandleComponent
              orientation="row"
              hideOtherElements={(hide) => setOnlyShownElement(hide ? 'rowTableHandle' : undefined)}
            />
          )}
      </GenericPopover>
      <GenericPopover
        reference={references?.columnReference}
        {...floatingUIOptions?.columnTableHandle}
      >
        {state.show &&
          state.colIndex !== undefined &&
          isCellVisible &&
          (!onlyShownElement || onlyShownElement === 'columnTableHandle') && (
            <TableHandleComponent
              orientation="column"
              hideOtherElements={(hide) =>
                setOnlyShownElement(hide ? 'columnTableHandle' : undefined)
              }
            />
          )}
      </GenericPopover>
      <GenericPopover reference={references?.cellReference} {...floatingUIOptions?.tableCellHandle}>
        {state.show &&
          canSplitCell &&
          (!onlyShownElement || onlyShownElement === 'tableCellHandle') && (
            <TableCellButton
              tableCellMenu={SplitOnlyCellMenu}
              hideOtherElements={(hide) =>
                setOnlyShownElement(hide ? 'tableCellHandle' : undefined)
              }
            />
          )}
      </GenericPopover>
      <GenericPopover
        reference={references?.tableReference}
        {...floatingUIOptions?.extendRowsButton}
      >
        {state.show &&
          state.showAddOrRemoveRowsButton &&
          (!onlyShownElement || onlyShownElement === 'extendRowsButton') && (
            <ExtendButtonComponent
              orientation="addOrRemoveRows"
              hideOtherElements={(hide) =>
                setOnlyShownElement(hide ? 'extendRowsButton' : undefined)
              }
            />
          )}
      </GenericPopover>
      <GenericPopover
        reference={references?.tableReference}
        {...floatingUIOptions?.extendColumnsButton}
      >
        {state.show &&
          state.showAddOrRemoveColumnsButton &&
          (!onlyShownElement || onlyShownElement === 'extendColumnsButton') && (
            <ExtendButtonComponent
              orientation="addOrRemoveColumns"
              hideOtherElements={(hide) =>
                setOnlyShownElement(hide ? 'extendColumnsButton' : undefined)
              }
            />
          )}
      </GenericPopover>
    </PortalElementOverride>
  );
};
