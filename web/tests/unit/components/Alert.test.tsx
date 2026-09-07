import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  alertTypes,
  createAlert,
  getAlertBlockTypeSelectItem,
  getAlertSlashMenuItem,
  insertAlert,
  AlertIcon,
  type AlertBlockConfig,
} from '@/components/editor/alert';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { useComponentsContext, type ReactCustomBlockRenderProps } from '@blocknote/react';

jest.mock('@blocknote/core', () => ({
  defaultProps: {
    textAlignment: {
      default: 'left',
      values: ['left', 'center', 'right', 'justify'],
    },
    textColor: {
      default: 'default',
    },
  },
}));

jest.mock('@blocknote/core/extensions', () => ({
  insertOrUpdateBlockForSlashMenu: jest.fn(),
}));

jest.mock('@blocknote/react', () => ({
  useComponentsContext: jest.fn(),
  createReactBlockSpec: jest.fn((config, implementation) => () => ({
    type: config.type,
    config,
    implementation,
  })),
}));

type MockSlashEditor = Parameters<typeof getAlertSlashMenuItem>[0];

interface MockBlockSpec {
  type: string;
  config: AlertBlockConfig;
  implementation: {
    render: React.ComponentType<ReactCustomBlockRenderProps<AlertBlockConfig>>;
  };
}

describe('Alert Block', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('alertTypes', () => {
    it('contains warning, error, info, and success types with icons', () => {
      const typeValues = alertTypes.map((t) => t.value);
      expect(typeValues).toEqual(['warning', 'error', 'info', 'success']);

      for (const type of alertTypes) {
        expect(type.title).toBeTruthy();
        expect(type.value).toBeTruthy();
        expect(type.icon).toBeDefined();
      }
    });
  });

  describe('getAlertBlockTypeSelectItem', () => {
    it('returns valid item for formatting toolbar BlockTypeSelect', () => {
      const item = getAlertBlockTypeSelectItem();
      expect(item.name).toBe('Alert');
      expect(item.type).toBe('alert');
      expect(typeof item.icon).toBe('function');

      const { container } = render(<item.icon />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('renders AlertIcon directly', () => {
      const { container } = render(<AlertIcon size={24} />);
      expect(container.querySelector('svg')).toBeInTheDocument();
    });
  });

  describe('getAlertSlashMenuItem', () => {
    it('returns slash menu item with title, aliases, and group', () => {
      const mockEditor = {} as MockSlashEditor;
      const item = getAlertSlashMenuItem(mockEditor);

      expect(item.title).toBe('Alert');
      expect(item.subtext).toBe('Alert for emphasizing text');
      expect(item.group).toBe('Basic blocks');
      expect(item.aliases).toContain('alert');
      expect(item.aliases).toContain('warning');
      expect(item.aliases).toContain('error');
      expect(item.aliases).toContain('info');
      expect(item.aliases).toContain('success');
      expect(item.aliases).toContain('callout');
      expect(React.isValidElement(item.icon)).toBe(true);
    });

    it('calls insertOrUpdateBlockForSlashMenu when clicked', () => {
      const mockEditor = { id: 'test-editor' } as unknown as MockSlashEditor;
      const item = getAlertSlashMenuItem(mockEditor);

      item.onItemClick();
      expect(insertOrUpdateBlockForSlashMenu).toHaveBeenCalledWith(mockEditor, {
        type: 'alert',
      });
    });

    it('exports insertAlert as alias to getAlertSlashMenuItem', () => {
      expect(insertAlert).toBe(getAlertSlashMenuItem);
    });
  });

  describe('createAlert block spec and render', () => {
    const spec = createAlert() as unknown as MockBlockSpec;

    it('creates alert block spec with proper propSchema and content', () => {
      expect(spec.type).toBe('alert');
      expect(spec.config.content).toBe('inline');
      expect(spec.config.propSchema.type.default).toBe('warning');
      expect(spec.config.propSchema.type.values).toEqual(['warning', 'error', 'info', 'success']);
    });

    it('renders warning alert by default when components context is available', () => {
      const mockUpdateBlock = jest.fn();
      const mockEditor = {
        isEditable: true,
        updateBlock: mockUpdateBlock,
      } as unknown as ReactCustomBlockRenderProps<AlertBlockConfig>['editor'];

      const mockComponents = {
        Generic: {
          Menu: {
            Root: ({ children }: { children?: React.ReactNode }) => (
              <div data-testid="mock-menu">{children}</div>
            ),
            Trigger: ({ children }: { children?: React.ReactNode }) => (
              <div data-testid="mock-trigger">{children}</div>
            ),
            Dropdown: ({ children }: { children?: React.ReactNode }) => (
              <div data-testid="mock-dropdown">{children}</div>
            ),
            Label: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
            Divider: () => <hr />,
            Item: ({
              children,
              onClick,
              icon,
            }: {
              children?: React.ReactNode;
              onClick?: () => void;
              icon?: React.ReactNode;
            }) => (
              <button data-testid={`menu-item-${String(children)}`} onClick={onClick}>
                {icon}
                {children}
              </button>
            ),
          },
        },
      };

      (useComponentsContext as jest.Mock).mockReturnValue(mockComponents);

      const AlertRender = spec.implementation.render;
      const contentRef = jest.fn();

      const { container } = render(
        <AlertRender
          block={
            {
              id: 'alert-1',
              type: 'alert',
              props: { type: 'warning', textAlignment: 'left', textColor: 'default' },
              content: [],
              children: [],
            } as unknown as ReactCustomBlockRenderProps<AlertBlockConfig>['block']
          }
          editor={mockEditor}
          contentRef={contentRef}
        />
      );

      const alertEl = container.querySelector('.alert');
      expect(alertEl).toHaveAttribute('data-alert-type', 'warning');
      expect(screen.getByTestId('mock-menu')).toBeInTheDocument();
      expect(screen.getByTestId('mock-trigger')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /alert type: warning/i })).toBeInTheDocument();

      // Click an item in the menu to change type
      const errorItem = screen.getByTestId('menu-item-Error');
      fireEvent.click(errorItem);

      expect(mockUpdateBlock).toHaveBeenCalledWith(expect.objectContaining({ id: 'alert-1' }), {
        type: 'alert',
        props: { type: 'error' },
      });
    });

    it('renders correctly for error, info, and success types', () => {
      (useComponentsContext as jest.Mock).mockReturnValue(null);
      const AlertRender = spec.implementation.render;
      const mockEditor = {
        isEditable: true,
      } as unknown as ReactCustomBlockRenderProps<AlertBlockConfig>['editor'];

      for (const type of ['error', 'info', 'success'] as const) {
        const { container } = render(
          <AlertRender
            block={
              {
                id: `alert-${type}`,
                type: 'alert',
                props: { type, textAlignment: 'left', textColor: 'default' },
                content: [],
                children: [],
              } as unknown as ReactCustomBlockRenderProps<AlertBlockConfig>['block']
            }
            editor={mockEditor}
            contentRef={jest.fn()}
          />
        );

        const alertEl = container.querySelector('.alert');
        expect(alertEl).toHaveAttribute('data-alert-type', type);
        const icon = container.querySelector('.alert-icon');
        expect(icon).toHaveAttribute('data-alert-icon-type', type);
      }
    });

    it('renders in read-only mode without menu trigger button', () => {
      const mockComponents = {
        Generic: {
          Menu: {
            Root: () => <div data-testid="mock-menu" />,
          },
        },
      };
      (useComponentsContext as jest.Mock).mockReturnValue(mockComponents);

      const AlertRender = spec.implementation.render;
      const mockEditor = {
        isEditable: false,
      } as unknown as ReactCustomBlockRenderProps<AlertBlockConfig>['editor'];

      const { container } = render(
        <AlertRender
          block={
            {
              id: 'alert-readonly',
              type: 'alert',
              props: { type: 'info', textAlignment: 'left', textColor: 'default' },
              content: [],
              children: [],
            } as unknown as ReactCustomBlockRenderProps<AlertBlockConfig>['block']
          }
          editor={mockEditor}
          contentRef={jest.fn()}
        />
      );

      // In read-only mode, menu root should not be rendered
      expect(screen.queryByTestId('mock-menu')).toBeNull();
      // Should have non-interactive icon wrapper
      const wrapper = container.querySelector('.alert-icon-wrapper');
      expect(wrapper?.tagName.toLowerCase()).toBe('div');
      expect(container.querySelector('.alert')).toHaveAttribute('data-alert-type', 'info');
    });
  });
});
