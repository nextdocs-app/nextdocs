import {
  defaultProps,
  type BlockNoteEditor,
  type BlockSchema,
  type InlineContentSchema,
  type StyleSchema,
  type PartialBlock,
} from '@blocknote/core';
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import {
  createReactBlockSpec,
  useComponentsContext,
  type BlockTypeSelectItem,
  type DefaultReactSuggestionItem,
  type IconType,
  type ReactCustomBlockRenderProps,
} from '@blocknote/react';
import { TriangleAlert, CircleAlert, Info, CircleCheck } from '@/icons';
import './Alert.css';

// The types of alerts that users can choose from.
// Styling (icon/background colors, light/dark) lives in Alert.css.
export const alertTypes = [
  {
    title: 'Warning',
    value: 'warning',
    icon: TriangleAlert,
  },
  {
    title: 'Error',
    value: 'error',
    icon: CircleAlert,
  },
  {
    title: 'Info',
    value: 'info',
    icon: Info,
  },
  {
    title: 'Success',
    value: 'success',
    icon: CircleCheck,
  },
] as const;

export type AlertType = (typeof alertTypes)[number]['value'];

export const alertBlockConfig = {
  type: 'alert' as const,
  propSchema: {
    textAlignment: defaultProps?.textAlignment ?? {
      default: 'left' as const,
      values: ['left', 'center', 'right', 'justify'] as const,
    },
    textColor: defaultProps?.textColor ?? {
      default: 'default' as const,
    },
    type: {
      default: 'warning' as const,
      values: ['warning', 'error', 'info', 'success'] as const,
    },
  },
  content: 'inline' as const,
};

export type AlertBlockConfig = typeof alertBlockConfig;

function AlertBlockContent({
  block,
  editor,
  contentRef,
}: ReactCustomBlockRenderProps<AlertBlockConfig>) {
  const currentType = block.props.type;
  const alertType = alertTypes.find((a) => a.value === currentType) ?? alertTypes[0];
  const Icon = alertType.icon;
  const Components = useComponentsContext();
  const isEditable = editor.isEditable;

  const renderIconTrigger = () => (
    <button
      type="button"
      className="alert-icon-wrapper"
      contentEditable={false}
      disabled={!isEditable}
      aria-label={`Alert type: ${alertType.title}. Click to change.`}
      title={isEditable ? `Change alert type (currently ${alertType.title})` : alertType.title}
    >
      <Icon
        className="alert-icon"
        data-alert-icon-type={currentType}
        size={20}
        aria-hidden="true"
      />
    </button>
  );

  return (
    <div className="alert" data-alert-type={currentType}>
      {isEditable && Components?.Generic?.Menu ? (
        <Components.Generic.Menu.Root>
          <Components.Generic.Menu.Trigger>{renderIconTrigger()}</Components.Generic.Menu.Trigger>
          <Components.Generic.Menu.Dropdown className="bn-alert-menu-dropdown">
            <Components.Generic.Menu.Label>Alert Type</Components.Generic.Menu.Label>
            <Components.Generic.Menu.Divider />
            {alertTypes.map((type) => {
              const ItemIcon = type.icon;
              return (
                <Components.Generic.Menu.Item
                  key={type.value}
                  icon={
                    <ItemIcon
                      className="alert-icon"
                      data-alert-icon-type={type.value}
                      size={16}
                      aria-hidden="true"
                    />
                  }
                  checked={currentType === type.value}
                  onClick={() =>
                    editor.updateBlock(block, {
                      type: 'alert',
                      props: { type: type.value },
                    })
                  }
                >
                  {type.title}
                </Components.Generic.Menu.Item>
              );
            })}
          </Components.Generic.Menu.Dropdown>
        </Components.Generic.Menu.Root>
      ) : (
        <div className="alert-icon-wrapper" contentEditable={false}>
          <Icon
            className="alert-icon"
            data-alert-icon-type={currentType}
            size={20}
            aria-hidden="true"
          />
        </div>
      )}
      <div className="inline-content bn-inline-content" ref={contentRef} />
    </div>
  );
}

// The Alert block spec.
export const createAlert = createReactBlockSpec(alertBlockConfig, {
  render: AlertBlockContent,
});

export const AlertIcon: IconType = (props) => <TriangleAlert {...props} />;

// Item for the Formatting Toolbar's BlockTypeSelect.
export const getAlertBlockTypeSelectItem = (): BlockTypeSelectItem => ({
  name: 'Alert',
  type: 'alert',
  icon: AlertIcon,
});

export function getAlertSlashMenuItem<
  BSchema extends BlockSchema = BlockSchema,
  I extends InlineContentSchema = InlineContentSchema,
  S extends StyleSchema = StyleSchema,
>(editor: BlockNoteEditor<BSchema, I, S>): DefaultReactSuggestionItem {
  return {
    title: 'Alert',
    subtext: 'Alert for emphasizing text',
    onItemClick: () =>
      insertOrUpdateBlockForSlashMenu(editor, {
        type: 'alert',
      } as PartialBlock<BSchema, I, S>),
    aliases: [
      'alert',
      'notification',
      'emphasize',
      'warning',
      'error',
      'info',
      'success',
      'callout',
    ],
    group: 'Basic blocks',
    icon: <TriangleAlert size={18} />,
  };
}

// Alias matching official example function name
export const insertAlert = getAlertSlashMenuItem;
