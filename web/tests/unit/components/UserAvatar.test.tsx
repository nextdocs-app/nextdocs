import { fireEvent, render } from '@testing-library/react';
import { UserAvatar } from '@/components/UserAvatar';
import { AVATAR_TEXT_COLOR, getAvatarBackground } from '@/lib/avatar.util';
import { getApiBaseUrl } from '@/lib/api-url.util';

describe('UserAvatar', () => {
  it('paints the hashed background with two blended letter layers', () => {
    const { container } = render(<UserAvatar seed="user-1" name="Ada Lovelace" />);

    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('viewBox', '0 0 100 100');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.querySelector('rect')).toHaveAttribute('fill', getAvatarBackground('user-1'));

    const layers = Array.from(container.querySelectorAll('text'));
    expect(layers).toHaveLength(2);
    for (const layer of layers) {
      expect(layer).toHaveTextContent('AL');
      expect(layer).toHaveAttribute('fill', AVATAR_TEXT_COLOR);
      // Browsers fall back to the font stack in `font-family`, so only the
      // leading system entry is contractual.
      expect(layer.getAttribute('font-family')).toMatch(/^system-ui/);
    }

    const [blendLayer, opacityLayer] = Array.from(container.querySelectorAll('g'));
    expect((blendLayer as SVGElement).style.mixBlendMode).toBe('overlay');
    expect(opacityLayer).toHaveAttribute('opacity', '0.5');
  });

  it('prefers a profile photo when the user has one', () => {
    const { container } = render(
      <UserAvatar seed="user-1" name="Ada" src="https://example.test/ada.png" />
    );

    expect(container.querySelector('svg')).toBeNull();
    const image = container.querySelector('img');
    expect(image).toHaveAttribute('src', 'https://example.test/ada.png');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('resolves an uploaded photo path against the API origin', () => {
    const { container } = render(
      <UserAvatar seed="user-1" name="Ada" src="/api/v1/users/user-1/avatar?v=abc123" />
    );

    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      `${getApiBaseUrl()}/api/v1/users/user-1/avatar?v=abc123`
    );
  });

  it('falls back to initials when the photo no longer loads', () => {
    const { container } = render(
      <UserAvatar seed="user-1" name="Ada Lovelace" src="/api/v1/users/user-1/avatar?v=gone" />
    );

    fireEvent.error(container.querySelector('img')!);

    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.querySelector('text')).toHaveTextContent('AL');
  });

  it('retries a replaced photo after an earlier one failed', () => {
    const { container, rerender } = render(
      <UserAvatar seed="user-1" name="Ada" src="/api/v1/users/user-1/avatar?v=gone" />
    );
    fireEvent.error(container.querySelector('img')!);

    rerender(<UserAvatar seed="user-1" name="Ada" src="/api/v1/users/user-1/avatar?v=new" />);

    expect(container.querySelector('img')).not.toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });

  it('exposes the label as a tooltip when one is given', () => {
    const { container, rerender } = render(
      <UserAvatar seed="user-1" name="Ada" title="Ada Lovelace" />
    );

    expect(container.querySelector('svg title')).toHaveTextContent('Ada Lovelace');

    // The photo branch has no SVG to hang a title on, so the wrapper carries it.
    rerender(
      <UserAvatar seed="user-1" name="Ada" src="https://x.test/a.png" title="Ada Lovelace" />
    );
    expect(container.querySelector('span')).toHaveAttribute('title', 'Ada Lovelace');
  });

  it('sizes itself from the size prop', () => {
    const { container } = render(<UserAvatar seed="user-1" name="Ada" size="lg" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveStyle({ width: '48px', height: '48px' });
  });

  it('keeps caller classes for layout tweaks', () => {
    const { container } = render(
      <UserAvatar seed="user-1" name="Ada" size="sm" className="ring-1" />
    );

    expect(container.querySelector('svg')).toHaveClass('ring-1');
  });
});
