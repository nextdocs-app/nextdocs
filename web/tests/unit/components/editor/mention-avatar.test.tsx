import { render } from '@testing-library/react';
import { MentionAvatar } from '../../../../components/editor/mentions/MentionAvatar';

describe('MentionAvatar', () => {
  it('renders the initials avatar as a data URL with the caller sizing', () => {
    const { container } = render(
      <MentionAvatar userId="user-1" label="Alice" className="size-5" />
    );

    const image = container.querySelector('img');
    expect(image).not.toBeNull();
    expect(image?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
    expect(image).toHaveClass('size-5', 'rounded-full');
    // Decorative: the chip already carries the name as text.
    expect(image).toHaveAttribute('aria-hidden', 'true');
    expect(image).toHaveAttribute('alt', '');
  });

  it('falls back to the user id when a chip has no label snapshot', () => {
    const { container } = render(<MentionAvatar userId="user-1" label="" />);

    expect(container.querySelector('img')?.getAttribute('src')).toMatch(/^data:image\/svg\+xml/);
  });
});
