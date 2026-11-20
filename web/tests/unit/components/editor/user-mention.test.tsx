import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';

// The spec factory only wires config + implementation together; the editor is not
// needed to exercise the three things this inline content owns.
jest.mock('@blocknote/react', () => ({
  createReactInlineContentSpec: (config: object, implementation: object) => ({
    ...config,
    ...implementation,
  }),
}));

import { UserMention } from '../../../../components/editor/mentions/UserMention';

type MentionProps = { inlineContent: { props: { userId: string; label: string } } };

const spec = UserMention as unknown as {
  type: string;
  render: (props: MentionProps) => ReactElement;
  toExternalHTML: (props: MentionProps) => ReactElement;
  parse: (element: HTMLElement) => { userId: string; label: string } | undefined;
};

function mention(userId: string, label: string): MentionProps {
  return { inlineContent: { props: { userId, label } } };
}

describe('UserMention inline content', () => {
  it('registers the mention type with its two props', () => {
    expect(spec.type).toBe('mention');
  });

  it('renders the identity and the display snapshot as a chip', () => {
    const { container } = render(spec.render(mention('user-1', 'Alice')));

    const chip = container.querySelector('[data-nd-mention-user-id="user-1"]');
    expect(chip).not.toBeNull();
    expect(chip).toHaveTextContent('@Alice');
    expect(chip).toHaveAttribute('title', 'Mentioned Alice');
    expect(chip?.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });

  it('still renders a chip when the snapshot is missing', () => {
    const { container } = render(spec.render(mention('user-1', '')));

    expect(container.querySelector('[data-nd-mention-user-id="user-1"]')).toHaveTextContent(
      '@Unknown'
    );
    expect(screen.getByTitle('Mentioned user')).toBeInTheDocument();
  });

  it('serializes to external HTML with only the user id and label', () => {
    const { container } = render(spec.toExternalHTML(mention('user-1', 'Alice')));

    const exported = container.querySelector('[data-nd-mention]');
    expect(exported).toHaveAttribute('data-nd-mention', 'user-1');
    expect(exported).toHaveTextContent('@Alice');
  });

  it('serializes a missing snapshot as an unknown person', () => {
    const { container } = render(spec.toExternalHTML(mention('user-1', '')));

    expect(container.querySelector('[data-nd-mention]')).toHaveTextContent('@Unknown');
  });

  it('parses a serialized mention back into its props', () => {
    const span = document.createElement('span');
    span.setAttribute('data-nd-mention', 'user-1');
    span.textContent = '@Alice';

    expect(spec.parse(span)).toEqual({ userId: 'user-1', label: 'Alice' });

    const live = document.createElement('span');
    live.setAttribute('data-nd-mention-user-id', 'user-2');
    live.textContent = '@Bob';

    expect(spec.parse(live)).toEqual({ userId: 'user-2', label: 'Bob' });
  });

  it('parses a mention whose element has no text content', () => {
    const empty = {
      tagName: 'SPAN',
      getAttribute: (name: string) => (name === 'data-nd-mention' ? 'user-3' : null),
      textContent: null,
    } as unknown as HTMLElement;

    expect(spec.parse(empty)).toEqual({ userId: 'user-3', label: '' });
  });

  it('ignores anything that is not a tagged span', () => {
    const foreign = document.createElement('div');
    foreign.setAttribute('data-nd-mention', 'user-1');

    const untagged = document.createElement('span');
    untagged.textContent = '@Nobody';

    expect(spec.parse(foreign)).toBeUndefined();
    expect(spec.parse(untagged)).toBeUndefined();
  });
});
