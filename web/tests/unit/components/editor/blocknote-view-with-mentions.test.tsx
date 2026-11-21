import { useContext, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';

jest.mock('@blocknote/core', () => ({
  mergeCSSClasses: (...classes: string[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('@blocknote/react', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  return {
    BlockNoteViewRaw: ({ className, children }: { className?: string; children?: ReactNode }) => (
      <div data-testid="blocknote-view" className={className}>
        {children}
      </div>
    ),
    ComponentsContext: React.createContext(null),
  };
});

jest.mock('@blocknote/shadcn', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const DefaultEditor = () => <div data-testid="default-comment-editor" />;
  return {
    ShadCNComponentsContext: React.createContext(null),
    ShadCNDefaultComponents: { Comments: { Editor: DefaultEditor } },
    components: {
      Comments: { Editor: DefaultEditor },
      SuggestionMenu: { Root: ({ children }: { children?: ReactNode }) => <div>{children}</div> },
    },
  };
});

jest.mock('../../../../components/editor/mentions/MentionableCommentEditor', () => ({
  MentionableCommentEditor: () => <div data-testid="mentionable-comment-editor" />,
}));

import { ComponentsContext } from '@blocknote/react';
import { BlockNoteViewWithMentions } from '../../../../components/editor/mentions/BlockNoteViewWithMentions';
import { useMentionConfig } from '../../../../components/editor/mentions/MentionConfigContext';
import { MentionableCommentEditor } from '../../../../components/editor/mentions/MentionableCommentEditor';

const components = ComponentsContext as unknown as React.Context<{
  Comments: { Editor: unknown };
} | null>;

const config = { documentId: 'doc-9', enabled: true, getAccessToken: () => null };

function ConfigProbe() {
  return <span data-testid="config-probe">{useMentionConfig()?.documentId ?? 'none'}</span>;
}

function ComponentsProbe() {
  const value = useContext(components);
  return (
    <span data-testid="components-probe">
      {value?.Comments.Editor === MentionableCommentEditor ? 'overridden' : 'default'}
    </span>
  );
}

describe('BlockNoteViewWithMentions', () => {
  it('keeps the shadcn class list and exposes the mention config to the tree', () => {
    render(
      <BlockNoteViewWithMentions editor={{} as never} mentionConfig={config} className="extra">
        <ConfigProbe />
      </BlockNoteViewWithMentions>
    );

    const view = screen.getByTestId('blocknote-view');
    expect(view).toHaveClass('bn-shadcn', 'extra');
    expect(screen.getByTestId('config-probe')).toHaveTextContent('doc-9');
  });

  it('adds no class of its own when the caller passes none', () => {
    render(<BlockNoteViewWithMentions editor={{} as never} mentionConfig={config} />);

    expect(screen.getByTestId('blocknote-view').className).toBe('bn-shadcn');
  });

  it('swaps only the comment editor in the component map', () => {
    render(
      <BlockNoteViewWithMentions editor={{} as never} mentionConfig={config} shadCNComponents={{}}>
        <ComponentsProbe />
      </BlockNoteViewWithMentions>
    );

    expect(screen.getByTestId('components-probe')).toHaveTextContent('overridden');
  });
});
