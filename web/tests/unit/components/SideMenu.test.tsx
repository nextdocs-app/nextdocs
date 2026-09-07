import React from 'react';
import { render } from '@testing-library/react';
import { CustomSideMenu, SIDE_MENU_FLOATING_OPTIONS } from '@/components/editor/SideMenu';
import { useExtensionState } from '@blocknote/react';

jest.mock('@blocknote/react', () => ({
  useExtensionState: jest.fn(),
  AddBlockButton: () => <button data-testid="add-block-button">Add</button>,
  DragHandleButton: () => <button data-testid="drag-handle-button">Drag</button>,
}));

jest.mock('@blocknote/core/extensions', () => ({
  SideMenuExtension: {},
}));

describe('CustomSideMenu', () => {
  const mockUseExtensionState = useExtensionState as jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders heading attributes with data-block-type and data-level', () => {
    mockUseExtensionState.mockImplementation((_ext, options) => {
      const state = {
        block: {
          id: 'heading-1',
          type: 'heading',
          props: { level: 1 },
        },
      };
      return options?.selector ? options.selector(state) : state;
    });

    const { container } = render(<CustomSideMenu />);
    const menu = container.querySelector('.bn-side-menu');

    expect(menu).not.toBeNull();
    expect(menu).toHaveAttribute('data-block-type', 'heading');
    expect(menu).toHaveAttribute('data-level', '1');
    expect(container.querySelector('[data-testid="add-block-button"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="drag-handle-button"]')).toBeInTheDocument();
  });

  it('renders paragraph attributes without data-level', () => {
    mockUseExtensionState.mockImplementation((_ext, options) => {
      const state = {
        block: {
          id: 'p-1',
          type: 'paragraph',
          props: {},
        },
      };
      return options?.selector ? options.selector(state) : state;
    });

    const { container } = render(<CustomSideMenu />);
    const menu = container.querySelector('.bn-side-menu');

    expect(menu).not.toBeNull();
    expect(menu).toHaveAttribute('data-block-type', 'paragraph');
    expect(menu).not.toHaveAttribute('data-level');
  });

  it('renders codeBlock, checkListItem, and table block types', () => {
    const types = ['codeBlock', 'checkListItem', 'table', 'divider', 'alert'];

    for (const type of types) {
      mockUseExtensionState.mockImplementation((_ext, options) => {
        const state = {
          block: {
            id: `${type}-1`,
            type,
            props: {},
          },
        };
        return options?.selector ? options.selector(state) : state;
      });

      const { container } = render(<CustomSideMenu />);
      const menu = container.querySelector('.bn-side-menu');

      expect(menu).toHaveAttribute('data-block-type', type);
    }
  });

  it('renders children when provided instead of default buttons', () => {
    mockUseExtensionState.mockImplementation((_ext, options) => {
      const state = {
        block: {
          id: 'p-1',
          type: 'paragraph',
          props: {},
        },
      };
      return options?.selector ? options.selector(state) : state;
    });

    const { getByTestId, queryByTestId } = render(
      <CustomSideMenu>
        <span data-testid="custom-child">Custom</span>
      </CustomSideMenu>
    );

    expect(getByTestId('custom-child')).toBeInTheDocument();
    expect(queryByTestId('add-block-button')).not.toBeInTheDocument();
    expect(queryByTestId('drag-handle-button')).not.toBeInTheDocument();
  });

  it('provides SIDE_MENU_FLOATING_OPTIONS with cleared middleware', () => {
    expect(SIDE_MENU_FLOATING_OPTIONS.useFloatingOptions.middleware).toEqual([]);
  });
});
