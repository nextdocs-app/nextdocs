import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IconColorMenu } from '../../../components/page/IconColorMenu';

describe('IconColorMenu', () => {
  it('announces the selected color and forwards a new choice', async () => {
    const user = userEvent.setup();
    const onSelect = jest.fn();
    render(
      <IconColorMenu
        selectedColor="default"
        isOpen
        menuRef={{ current: null }}
        onToggle={jest.fn()}
        onSelect={onSelect}
      />
    );

    expect(screen.getByRole('button', { name: 'Icon color: Default' })).toBeInTheDocument();

    await user.click(screen.getByRole('option', { name: /Blue/i }));
    expect(onSelect).toHaveBeenCalledWith('blue');
  });

  it('marks the active color as selected', () => {
    render(
      <IconColorMenu
        selectedColor="red"
        isOpen
        menuRef={{ current: null }}
        onToggle={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    expect(screen.getByRole('option', { name: /Red/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('shows swatches only, as two rows of five', () => {
    render(
      <IconColorMenu
        selectedColor="default"
        isOpen
        menuRef={{ current: null }}
        onToggle={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(10);

    // Explicit 1.5rem tracks: the menu is absolutely positioned inside the
    // 34px trigger, so `grid-cols-5` (1fr tracks) would resolve against that
    // width and let the 24px swatches spill out of the panel.
    expect(screen.getByRole('listbox')).toHaveClass('grid-cols-[repeat(5,1.5rem)]');

    // Names are gone from the layout, so they have to survive on the option.
    for (const option of options) {
      expect(option).toBeEmptyDOMElement();
      expect(option).toHaveAccessibleName();
    }
    expect(screen.queryByText('Blue')).toBeNull();
  });

  it('sets the selection outline off the swatch so the choice reads at a glance', () => {
    render(
      <IconColorMenu
        selectedColor="blue"
        isOpen
        menuRef={{ current: null }}
        onToggle={jest.fn()}
        onSelect={jest.fn()}
      />
    );

    // A flush ring reads as part of the dot; the offset leaves the gap that
    // marks it as the chosen colour.
    expect(screen.getByRole('option', { name: 'Blue' })).toHaveClass(
      'outline-offset-2',
      '[outline:2px_solid_var(--nd-brand)]'
    );

    // The other swatches keep the flush hover ring, so the two states cannot
    // be mistaken for each other.
    const other = screen.getByRole('option', { name: 'Red' });
    expect(other.className).not.toContain('--nd-brand');
    expect(other).toHaveClass('hover:ring-2');
  });
});
