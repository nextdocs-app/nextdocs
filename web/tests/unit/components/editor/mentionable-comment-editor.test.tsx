import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

jest.mock('@blocknote/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    useBlockNoteContext: () => null,
    SuggestionMenuController: ({ triggerCharacter }: { triggerCharacter: string }) => (
      <div data-testid="suggestion-menu" data-trigger={triggerCharacter} />
    ),
    FormattingToolbarController: () => <div data-testid="formatting-toolbar" />,
    FormattingToolbar: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    getFormattingToolbarItems: () => [],
  };
});

jest.mock('@blocknote/shadcn', () => ({
  BlockNoteView: ({ children, editable }: { children?: React.ReactNode; editable?: boolean }) => (
    <div data-testid="comment-editor" data-editable={String(editable)}>
      {children}
    </div>
  ),
}));

jest.mock('../../../../components/editor/mentions/mention-menu', () => {
  const getItems = jest.fn(async () => []);
  return { createMentionMenuItems: jest.fn(() => getItems) };
});

import { MentionableCommentEditor as MentionableCommentEditorBase } from '../../../../components/editor/mentions/MentionableCommentEditor';
import {
  MentionConfigProvider,
  type MentionConfig,
} from '../../../../components/editor/mentions/MentionConfigContext';
import { createMentionMenuItems } from '../../../../components/editor/mentions/mention-menu';

const MentionableCommentEditor = MentionableCommentEditorBase as unknown as (props: {
  editor: unknown;
  editable?: boolean;
}) => React.ReactElement;

const editor = { document: {} };
const config: MentionConfig = { documentId: 'doc-1', enabled: true, getAccessToken: () => 'token' };

function withConfig(children: ReactNode) {
  return <MentionConfigProvider value={config}>{children}</MentionConfigProvider>;
}

describe('MentionableCommentEditor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the shadcn comment editor and binds the @ menu to this composer', () => {
    render(withConfig(<MentionableCommentEditor editor={editor} editable />));

    expect(screen.getByTestId('comment-editor')).toHaveAttribute('data-editable', 'true');
    // The stock comment toolbar still renders inside that view.
    expect(screen.getByTestId('formatting-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('suggestion-menu')).toHaveAttribute('data-trigger', '@');
    expect(createMentionMenuItems).toHaveBeenCalledWith(editor, config);
  });

  it('leaves a read-only body without a menu', () => {
    render(withConfig(<MentionableCommentEditor editor={editor} editable={false} />));

    expect(screen.getByTestId('comment-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-menu')).toBeNull();
  });

  it('leaves guests and VIEW-only readers without a menu', () => {
    render(
      <MentionConfigProvider value={{ ...config, enabled: false }}>
        <MentionableCommentEditor editor={editor} editable />
      </MentionConfigProvider>
    );

    expect(screen.queryByTestId('suggestion-menu')).toBeNull();
  });

  it('renders a comment editor that was given no mention config at all', () => {
    render(<MentionableCommentEditor editor={editor} editable />);

    expect(screen.getByTestId('comment-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('suggestion-menu')).toBeNull();
  });
});
