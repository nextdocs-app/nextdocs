import { Schema } from 'prosemirror-model';
import { EditorState, NodeSelection } from 'prosemirror-state';
import { EditorView, DecorationSet, Decoration } from 'prosemirror-view';
import {
  MobileDraggableBlocksExtension,
  mobileDraggableBlocksPluginKey,
  isTouchInputActive,
} from '@/components/editor/mobileDraggableBlocks';
import type { BlockNoteEditor } from '@blocknote/core';

type BlockDecoration = Decoration & { type: { attrs: Record<string, string> } };

describe('MobileDraggableBlocksExtension', () => {
  const schema = new Schema({
    nodes: {
      doc: { content: 'blockContainer+' },
      blockContainer: {
        content: 'paragraph',
        toDOM() {
          return [
            'div',
            { class: 'bn-block-outer', 'data-node-type': 'blockOuter', 'data-id': 'b1' },
            ['div', { class: 'bn-block', 'data-node-type': 'blockContainer', 'data-id': 'b1' }, 0],
          ];
        },
        parseDOM: [{ tag: 'div.bn-block-outer', contentElement: 'div.bn-block' }],
      },
      paragraph: {
        content: 'text*',
        toDOM() {
          return ['p', 0];
        },
        parseDOM: [{ tag: 'p' }],
      },
      text: { inline: true },
    },
  });

  const createDoc = () =>
    schema.nodes.doc.create(null, [
      schema.nodes.blockContainer.create(
        null,
        schema.nodes.paragraph.create(null, schema.text('First block'))
      ),
      schema.nodes.blockContainer.create(
        null,
        schema.nodes.paragraph.create(null, schema.text('Second block'))
      ),
    ]);

  let mockEditor: Partial<BlockNoteEditor>;
  let mockSideMenu: { blockDragStart: jest.Mock; blockDragEnd: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    mockSideMenu = {
      blockDragStart: jest.fn(),
      blockDragEnd: jest.fn(),
    };
    mockEditor = {
      isEditable: true,
      getBlock: jest.fn(
        (id: string) =>
          ({ id, type: 'paragraph', props: {}, content: [] }) as unknown as ReturnType<
            BlockNoteEditor['getBlock']
          >
      ),
      getExtension: jest.fn((ext: unknown) => {
        if (ext === 'sideMenu') return mockSideMenu;
        return undefined;
      }) as unknown as BlockNoteEditor['getExtension'],
      blur: jest.fn(),
      focus: jest.fn(),
    };
  });

  it('creates an extension with mobileDraggableBlocks key and a prosemirror plugin', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });

    expect(extension.key).toBe('mobileDraggableBlocks');
    expect(extension.prosemirrorPlugins).toHaveLength(1);
    expect(extension.prosemirrorPlugins[0].spec.key).toBe(mobileDraggableBlocksPluginKey);
  });

  it('does not decorate blocks when not on touch input', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => false,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const state = EditorState.create({ doc: createDoc(), plugins: [plugin] });
    const decorations = plugin.props.decorations?.call(plugin, state);

    expect((decorations as DecorationSet)?.find()).toHaveLength(0);
  });

  it('decorates all blockContainers with draggable="true" when unfocused on touch', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const state = EditorState.create({ doc: createDoc(), plugins: [plugin] });
    const decorations = plugin.props.decorations?.call(plugin, state);

    const found = (decorations as DecorationSet)?.find();
    expect(found).toHaveLength(2);
    expect((found?.[0] as BlockDecoration).type.attrs).toEqual({
      draggable: 'true',
      contenteditable: 'false',
    });
    expect((found?.[1] as BlockDecoration).type.attrs).toEqual({
      draggable: 'true',
      contenteditable: 'false',
    });
  });

  it('does not decorate blocks when editor is read-only', () => {
    mockEditor.isEditable = false;
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const state = EditorState.create({ doc: createDoc(), plugins: [plugin] });
    const decorations = plugin.props.decorations?.call(plugin, state);

    expect((decorations as DecorationSet)?.find()).toHaveLength(0);
  });

  it('removes draggable decorations when isFocused is set to true', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    let state = EditorState.create({ doc: createDoc(), plugins: [plugin] });
    expect((plugin.props.decorations?.call(plugin, state) as DecorationSet)?.find()).toHaveLength(
      2
    );

    // Transition to focused
    state = state.apply(state.tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: true }));
    expect((plugin.props.decorations?.call(plugin, state) as DecorationSet)?.find()).toHaveLength(
      0
    );

    // Transition back to unfocused
    state = state.apply(state.tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: false }));
    expect((plugin.props.decorations?.call(plugin, state) as DecorationSet)?.find()).toHaveLength(
      2
    );
  });

  it('handles focus, blur, and click DOM events with accurate tap coordinates', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    // Test focus handler
    const focusHandler = plugin.props.handleDOMEvents?.focus;
    expect(focusHandler).toBeDefined();
    focusHandler?.call(plugin, view, new FocusEvent('focus'));
    expect(mobileDraggableBlocksPluginKey.getState(view.state)?.isFocused).toBe(true);

    // Reset focused state to false
    view.dispatch(view.state.tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: false }));
    expect(mobileDraggableBlocksPluginKey.getState(view.state)?.isFocused).toBe(false);

    // Test click handler when unfocused: resolves tapped coordinates and focuses
    const clickHandler = plugin.props.handleDOMEvents?.click;
    expect(clickHandler).toBeDefined();
    jest.spyOn(view, 'posAtCoords').mockReturnValue({ pos: 2, inside: 1 });
    const focusSpy = jest.spyOn(view, 'focus');
    const mouseEvent = new MouseEvent('click', { clientX: 50, clientY: 100 });

    clickHandler?.call(plugin, view, mouseEvent as unknown as PointerEvent);

    expect(focusSpy).toHaveBeenCalled();
    expect(mobileDraggableBlocksPluginKey.getState(view.state)?.isFocused).toBe(true);
    expect(view.state.selection.from).toBe(2);

    view.destroy();
    document.body.removeChild(container);
  });

  it('delegates dragstart to SideMenuExtension.blockDragStart when available', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    const dragstartHandler = plugin.props.handleDOMEvents?.dragstart;
    expect(dragstartHandler).toBeDefined();

    const targetEl = container.querySelector('.bn-block-outer') as HTMLElement;
    expect(targetEl).not.toBeNull();

    const fakeDragEvent = {
      target: targetEl,
      dataTransfer: {
        setData: jest.fn(),
        clearData: jest.fn(),
        setDragImage: jest.fn(),
      },
    } as unknown as DragEvent;

    dragstartHandler?.call(plugin, view, fakeDragEvent);

    expect(mockEditor.getBlock).toHaveBeenCalledWith('b1');
    expect(mockSideMenu.blockDragStart).toHaveBeenCalledWith(
      fakeDragEvent,
      expect.objectContaining({ id: 'b1' })
    );

    view.destroy();
    document.body.removeChild(container);
  });

  it('selects the node on dragstart if SideMenuExtension is not present', () => {
    mockEditor.getExtension = jest.fn(
      () => undefined
    ) as unknown as BlockNoteEditor['getExtension'];

    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    const dragstartHandler = plugin.props.handleDOMEvents?.dragstart;
    const targetEl = container.querySelector('.bn-block-outer') as HTMLElement;

    const fakeDragEvent = {
      target: targetEl,
    } as unknown as DragEvent;

    dragstartHandler?.call(plugin, view, fakeDragEvent);

    expect(view.state.selection instanceof NodeSelection).toBe(true);

    view.destroy();
    document.body.removeChild(container);
  });

  it('delegates dragend to SideMenuExtension.blockDragEnd and blurs editor', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    const dragendHandler = plugin.props.handleDOMEvents?.dragend;
    expect(dragendHandler).toBeDefined();

    const removeAllRanges = jest.fn();
    jest.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode: view.dom,
      removeAllRanges,
    } as unknown as Selection);

    dragendHandler?.call(plugin, view, new Event('dragend') as unknown as DragEvent);
    expect(mockSideMenu.blockDragEnd).toHaveBeenCalled();
    expect(removeAllRanges).toHaveBeenCalled();

    view.destroy();
    document.body.removeChild(container);
  });

  it('clears DOM selection ranges when blurring to unfocused state', async () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    // Start in focused state
    view.dispatch(view.state.tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: true }));
    expect(mobileDraggableBlocksPluginKey.getState(view.state)?.isFocused).toBe(true);

    const removeAllRanges = jest.fn();
    jest.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode: view.dom,
      removeAllRanges,
    } as unknown as Selection);
    jest.spyOn(view, 'hasFocus').mockReturnValue(false);

    const blurHandler = plugin.props.handleDOMEvents?.blur;
    expect(blurHandler).toBeDefined();

    blurHandler?.call(plugin, view, new FocusEvent('blur'));

    // Wait for microtask in blur handler
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(removeAllRanges).toHaveBeenCalled();
    expect(mobileDraggableBlocksPluginKey.getState(view.state)?.isFocused).toBe(false);

    view.destroy();
    document.body.removeChild(container);
  });

  it('collapses selection and sets isFocused to false upon drop transaction via appendTransaction', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    // Simulate ProseMirror's drop transaction (wide selection + uiEvent: 'drop')
    const dropTr = view.state.tr
      .setSelection(NodeSelection.create(view.state.doc, 0))
      .setMeta('uiEvent', 'drop');

    view.dispatch(dropTr);

    expect(view.state.selection.empty).toBe(true);
    expect(view.state.selection.from).toBe(13); // collapsed to end of dropped block's inline text
    expect(mobileDraggableBlocksPluginKey.getState(view.state)?.isFocused).toBe(false);

    view.destroy();
    document.body.removeChild(container);
  });

  it('suppresses view.focus during drop in touch mode and restores it afterwards', async () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    const focusMock = jest.fn();
    view.focus = focusMock;

    const dropHandler = plugin.props.handleDOMEvents?.drop;
    expect(dropHandler).toBeDefined();

    dropHandler?.call(plugin, view, new Event('drop') as unknown as DragEvent);

    // view.focus is now stubbed during the synchronous drop duration
    view.focus();
    expect(focusMock).not.toHaveBeenCalled();

    // Wait for microtask / timeout to restore view.focus
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(view.focus).toBe(focusMock);
    view.focus();
    expect(focusMock).toHaveBeenCalledTimes(1);

    view.destroy();
    document.body.removeChild(container);
  });

  it('blocks text input and destructive keys when unfocused on touch, but allows them when focused', () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => true,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    // When unfocused on touch: handleTextInput should return true (blocked)
    expect(plugin.props.handleTextInput?.call(plugin, view, 0, 0, 'a', () => view.state.tr)).toBe(
      true
    );
    expect(
      plugin.props.handleKeyDown?.call(
        plugin,
        view,
        new KeyboardEvent('keydown', { key: 'Backspace' })
      )
    ).toBe(true);
    expect(
      plugin.props.handleKeyDown?.call(plugin, view, new KeyboardEvent('keydown', { key: 'Enter' }))
    ).toBe(true);

    // Transition to focused
    view.dispatch(view.state.tr.setMeta(mobileDraggableBlocksPluginKey, { isFocused: true }));

    // When focused: handleTextInput and handleKeyDown should return false (allowed)
    expect(plugin.props.handleTextInput?.call(plugin, view, 0, 0, 'a', () => view.state.tr)).toBe(
      false
    );
    expect(
      plugin.props.handleKeyDown?.call(
        plugin,
        view,
        new KeyboardEvent('keydown', { key: 'Backspace' })
      )
    ).toBe(false);

    view.destroy();
    document.body.removeChild(container);
  });

  it('remains completely inert on desktop (when touch input is false)', async () => {
    const extensionFactory = MobileDraggableBlocksExtension({
      isTouchInput: () => false,
    });
    const extension = extensionFactory({ editor: mockEditor as BlockNoteEditor });
    const plugin = extension.prosemirrorPlugins[0];

    const container = document.createElement('div');
    document.body.appendChild(container);

    const view = new EditorView(container, {
      state: EditorState.create({ doc: createDoc(), plugins: [plugin] }),
    });

    // 1. dragstart should be ignored on desktop so native text selection dragging is preserved
    const targetEl = container.querySelector('.bn-block-outer') as HTMLElement;
    const fakeDragEvent = { target: targetEl } as unknown as DragEvent;
    const dragResult = plugin.props.handleDOMEvents?.dragstart?.call(plugin, view, fakeDragEvent);
    expect(dragResult).toBe(false);
    expect(mockSideMenu.blockDragStart).not.toHaveBeenCalled();

    // 2. blur should not clear selection ranges or dispatch on desktop
    const removeAllRanges = jest.fn();
    jest.spyOn(window, 'getSelection').mockReturnValue({
      anchorNode: view.dom,
      removeAllRanges,
    } as unknown as Selection);
    jest.spyOn(view, 'hasFocus').mockReturnValue(false);

    const blurResult = plugin.props.handleDOMEvents?.blur?.call(
      plugin,
      view,
      new FocusEvent('blur')
    );
    expect(blurResult).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(removeAllRanges).not.toHaveBeenCalled();

    // 3. click should not hijack selection on desktop
    const clickResult = plugin.props.handleDOMEvents?.click?.call(
      plugin,
      view,
      new MouseEvent('click', { clientX: 10, clientY: 10 }) as unknown as PointerEvent
    );
    expect(clickResult).toBe(false);

    view.destroy();
    document.body.removeChild(container);
  });

  describe('isTouchInputActive', () => {
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it('uses customPredicate when provided', () => {
      expect(isTouchInputActive(() => true)).toBe(true);
      expect(isTouchInputActive(() => false)).toBe(false);
    });

    it('falls back to matchMedia when available', () => {
      window.matchMedia = jest.fn().mockImplementation((query) => ({
        matches: query.includes('pointer: coarse'),
      }));

      expect(isTouchInputActive()).toBe(true);
    });

    it('returns false when matchMedia is not available', () => {
      delete (window as { matchMedia?: unknown }).matchMedia;
      expect(isTouchInputActive()).toBe(false);
    });
  });
});
