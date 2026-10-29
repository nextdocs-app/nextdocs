import { render, screen } from '@testing-library/react';
import {
  WorkspaceIconTile,
  workspaceIconTileStyle,
} from '../../../../components/workspace/WorkspaceIconTile';

describe('workspaceIconTileStyle', () => {
  const placeholder = {
    className: 'bg-[var(--nd-placeholder-bg)] text-[var(--nd-placeholder-fg)]',
  };

  it('uses the neutral placeholder surface when there is no icon or it is an emoji', () => {
    expect(workspaceIconTileStyle(null)).toEqual(placeholder);
    expect(workspaceIconTileStyle(undefined)).toEqual(placeholder);
    expect(workspaceIconTileStyle({ type: 'emoji', value: '🚀' })).toEqual(placeholder);
  });

  it('uses the neutral placeholder surface for a builtin icon without an accent color', () => {
    expect(workspaceIconTileStyle({ type: 'builtin', value: 'rocket' })).toEqual(placeholder);
    expect(workspaceIconTileStyle({ type: 'builtin', value: 'rocket', color: 'default' })).toEqual(
      placeholder
    );
  });

  it('tints a colored builtin icon from its own accent color', () => {
    expect(workspaceIconTileStyle({ type: 'builtin', value: 'rocket', color: 'red' })).toEqual({
      className: '',
      style: {
        backgroundColor: 'color-mix(in srgb, var(--nd-icon-color-red) 18%, transparent)',
        color: 'var(--nd-icon-color-red)',
      },
    });
  });

  it('leaves media tiles transparent so the image is the tile', () => {
    expect(workspaceIconTileStyle({ type: 'upload', value: 'att-1' })).toEqual({ className: '' });
    expect(workspaceIconTileStyle({ type: 'link', value: 'https://x/y.png' })).toEqual({
      className: '',
    });
  });
});

describe('WorkspaceIconTile', () => {
  it('renders the placeholder mark when there is no icon', () => {
    const { container } = render(<WorkspaceIconTile icon={null} size={40} />);

    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  it('insets a builtin glyph inside the tile', () => {
    const { container } = render(
      <WorkspaceIconTile icon={{ type: 'builtin', value: 'rocket', color: 'red' }} size={40} />
    );

    expect(container.querySelector('.nd-page-icon-mask')).toHaveStyle({
      width: '24px',
      height: '24px',
    });
  });

  it('renders an emoji at the emoji ratio', () => {
    render(<WorkspaceIconTile icon={{ type: 'emoji', value: '🚀' }} size={25} />);

    expect(screen.getByText('🚀')).toHaveStyle({ width: '16px', height: '16px' });
  });
});
