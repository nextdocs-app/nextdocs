'use client';

import { Plugin, PluginKey, NodeSelection, Selection } from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';
import { TOUCH_INPUT_QUERY } from '@/hooks/useMediaQuery.hook';
import type { Extension, ExtensionFactoryInstance } from '@blocknote/core';

export const mobileDraggableBlocksPluginKey = new PluginKey<{ isFocused: boolean }>(
  'mobile-draggable-blocks'
);

export type MobileDraggableBlocksOptions = {
  /**
   * Optional custom predicate for touch input. Defaults to checking the
   * `TOUCH_INPUT_QUERY` media query in the browser.
   */
  isTouchInput?: () => boolean;
};

export function isTouchInputActive(customPredicate?: () => boolean): boolean {
  if (typeof customPredicate === 'function') {
    return customPredicate();
  }
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(TOUCH_INPUT_QUERY).matches;
}

type SideMenuExtensionLike = {
  blockDragStart?: (event: DragEvent, block: unknown) => void;
  blockDragEnd?: () => void;
};

export interface MobileDraggableBlocksExtensionInstance extends Extension<
  undefined,
  'mobileDraggableBlocks'
> {
  prosemirrorPlugins: Plugin<{ isFocused: boolean }>[];
}

/**
 * Enables mobile long-press block drag and drop when the editor is not focused.
 *
 * On mobile touch devices, setting `draggable="true"` on blocks while unfocused
 * allows the native browser long-press gesture to lift and reorder blocks without
 * needing mouse-driven side-menu hover handles or extra gutters.
 *
 * When the editor is focused (typing mode), `draggable="true"` is immediately
 * removed so text selection, cursor positioning, and typing are completely unaffected.
 */
export function MobileDraggableBlocksExtension(
  options?: MobileDraggableBlocksOptions
): ExtensionFactoryInstance<MobileDraggableBlocksExtensionInstance> {
  return ({ editor }) => {
    return {
      key: 'mobileDraggableBlocks',
      prosemirrorPlugins: [
        new Plugin<{ isFocused: boolean }>({
          key: mobileDraggableBlocksPluginKey,
          state: {
            init: () => ({ isFocused: false }),
            apply: (tr, value) => {
              const meta = tr.getMeta(mobileDraggableBlocksPluginKey);
              if (meta && typeof meta.isFocused === 'boolean') {
                return { isFocused: meta.isFocused };
              }
              return value;
            },
          },
          appendTransaction: (transactions, _oldState, newState) => {
            if (!isTouchInputActive(options?.isTouchInput)) {
              return null;
            }
            const dropTr = transactions.find((tr) => tr.getMeta('uiEvent') === 'drop');
            if (dropTr) {
              let tr = newState.tr;
              if (!newState.selection.empty) {
                tr = tr.setSelection(
                  Selection.near(newState.doc.resolve(newState.selection.to), -1)
                );
              }
              tr = tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: false });
              return tr;
            }
            return null;
          },
          props: {
            handleTextInput: (view) => {
              if (!isTouchInputActive(options?.isTouchInput)) {
                return false;
              }
              const cur = mobileDraggableBlocksPluginKey.getState(view.state);
              if (!cur?.isFocused) {
                return true;
              }
              return false;
            },
            handleKeyDown: (view, event) => {
              if (!isTouchInputActive(options?.isTouchInput)) {
                return false;
              }
              const cur = mobileDraggableBlocksPluginKey.getState(view.state);
              if (!cur?.isFocused && ['Backspace', 'Delete', 'Enter'].includes(event.key)) {
                return true;
              }
              return false;
            },
            handleDOMEvents: {
              focus: (view) => {
                if (!isTouchInputActive(options?.isTouchInput)) {
                  return false;
                }
                const cur = mobileDraggableBlocksPluginKey.getState(view.state);
                if (!cur?.isFocused) {
                  view.dispatch(
                    view.state.tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: true })
                  );
                }
                return false;
              },
              blur: (view) => {
                if (!isTouchInputActive(options?.isTouchInput)) {
                  return false;
                }
                queueMicrotask(() => {
                  if (!view.isDestroyed && !view.hasFocus()) {
                    const active = typeof document !== 'undefined' ? document.activeElement : null;
                    const isToolbarOrPopupActive =
                      (active &&
                        (active.closest('.bn-mobile-formatting-toolbar') ||
                          active.closest(
                            '[role="menu"], [role="listbox"], [data-radix-popper-content-wrapper], .bn-menu-dropdown, .bn-popover'
                          ))) ||
                      (typeof document !== 'undefined' &&
                        Boolean(
                          document.querySelector(
                            '.bn-mobile-formatting-toolbar [aria-expanded="true"], .bn-mobile-formatting-toolbar [data-popup-open]'
                          )
                        ));
                    if (isToolbarOrPopupActive) {
                      return;
                    }
                    const cur = mobileDraggableBlocksPluginKey.getState(view.state);
                    if (cur?.isFocused) {
                      if (typeof window !== 'undefined') {
                        const sel = window.getSelection();
                        if (sel && sel.anchorNode && view.dom.contains(sel.anchorNode)) {
                          sel.removeAllRanges();
                        }
                      }
                      view.dispatch(
                        view.state.tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: false })
                      );
                    }
                  }
                });
                return false;
              },
              click: (view, event) => {
                if (!isTouchInputActive(options?.isTouchInput)) {
                  return false;
                }
                const cur = mobileDraggableBlocksPluginKey.getState(view.state);
                if (!cur?.isFocused) {
                  let tr = view.state.tr.setMeta(mobileDraggableBlocksPluginKey, {
                    isFocused: true,
                  });
                  if (event instanceof MouseEvent) {
                    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY });
                    if (pos) {
                      tr = tr.setSelection(Selection.near(view.state.doc.resolve(pos.pos)));
                    } else {
                      tr = tr.setSelection(Selection.atEnd(view.state.doc));
                    }
                  }
                  view.dispatch(tr);
                  view.focus();
                }
                return false;
              },
              drop: (view) => {
                if (isTouchInputActive(options?.isTouchInput)) {
                  const origFocus = view.focus;
                  view.focus = () => {
                    // Suppress focus on drop in touch mode to prevent keyboard & formatting toolbar blink
                  };
                  const restore = () => {
                    if (view.focus !== origFocus) {
                      view.focus = origFocus;
                    }
                  };
                  queueMicrotask(restore);
                  setTimeout(restore, 50);
                }
                return false;
              },
              dragstart: (view, event) => {
                if (!isTouchInputActive(options?.isTouchInput)) {
                  return false;
                }
                const target = event.target;
                if (!(target instanceof HTMLElement)) {
                  return false;
                }

                const blockOuter = target.closest<HTMLElement>('[data-node-type="blockOuter"]');
                const blockId = blockOuter?.getAttribute('data-id');

                if (blockId) {
                  const block = editor.getBlock(blockId);
                  if (block) {
                    const sideMenu = editor.getExtension('sideMenu') as
                      SideMenuExtensionLike | undefined;
                    if (sideMenu && typeof sideMenu.blockDragStart === 'function') {
                      sideMenu.blockDragStart(event as DragEvent, block);
                      return false;
                    }
                  }
                }

                // Fallback: select the node being dragged so ProseMirror's default handler has the slice
                const docView = (
                  view as unknown as {
                    docView?: {
                      nearestDesc: (
                        target: HTMLElement,
                        flag: boolean
                      ) => { node: { type: { name: string } }; posBefore: number } | null;
                    };
                  }
                ).docView;
                const desc = docView?.nearestDesc(target, true);
                if (desc && desc.node.type.name === 'blockContainer') {
                  view.dispatch(
                    view.state.tr.setSelection(NodeSelection.create(view.state.doc, desc.posBefore))
                  );
                }

                return false;
              },
              dragend: (view) => {
                if (!isTouchInputActive(options?.isTouchInput)) {
                  return false;
                }
                const sideMenu = editor.getExtension('sideMenu') as
                  SideMenuExtensionLike | undefined;
                if (sideMenu && typeof sideMenu.blockDragEnd === 'function') {
                  sideMenu.blockDragEnd();
                } else {
                  editor.blur();
                }
                if (view.hasFocus()) {
                  view.dom.blur();
                }
                if (typeof window !== 'undefined') {
                  const sel = window.getSelection();
                  if (sel && sel.anchorNode && view.dom.contains(sel.anchorNode)) {
                    sel.removeAllRanges();
                  }
                }
                if (
                  !view.state.selection.empty ||
                  mobileDraggableBlocksPluginKey.getState(view.state)?.isFocused
                ) {
                  view.dispatch(
                    view.state.tr
                      .setSelection(
                        Selection.near(view.state.doc.resolve(view.state.selection.to), -1)
                      )
                      .setMeta(mobileDraggableBlocksPluginKey, { isFocused: false })
                  );
                }
                return false;
              },
            },
            decorations: (state) => {
              if (!editor.isEditable) {
                return DecorationSet.empty;
              }

              if (!isTouchInputActive(options?.isTouchInput)) {
                return DecorationSet.empty;
              }

              const pluginState = mobileDraggableBlocksPluginKey.getState(state);
              if (pluginState?.isFocused) {
                return DecorationSet.empty;
              }

              const decos: Decoration[] = [];
              state.doc.descendants((node, pos) => {
                if (node.type.name === 'blockContainer') {
                  decos.push(
                    Decoration.node(pos, pos + node.nodeSize, {
                      draggable: 'true',
                      contenteditable: 'false',
                    })
                  );
                }
                return true;
              });

              return DecorationSet.create(state.doc, decos);
            },
          },
        }),
      ],
    };
  };
}
