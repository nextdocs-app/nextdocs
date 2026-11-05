import { createRef } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Badge } from '@/components/Badge';

describe('Badge', () => {
  it('renders as a span by default with muted styling', () => {
    render(<Badge>Static text</Badge>);

    const badge = screen.getByText('Static text');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveClass('bg-muted', 'text-muted-foreground', 'border-border');
  });

  it('renders primary styling when variant="primary"', () => {
    render(<Badge variant="primary">Owner</Badge>);

    const badge = screen.getByText('Owner');
    expect(badge.tagName).toBe('SPAN');
    expect(badge).toHaveClass('bg-primary/10', 'text-primary', 'border-primary/20');
  });

  it('renders as a button when onClick is provided and handles click', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();

    render(
      <Badge onClick={handleClick} title="Click to view">
        Overrides Parent
      </Badge>
    );

    const button = screen.getByRole('button', { name: 'Overrides Parent' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('title', 'Click to view');

    await user.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('respects disabled prop when rendered as a button', async () => {
    const user = userEvent.setup();
    const handleClick = jest.fn();

    render(
      <Badge onClick={handleClick} disabled>
        Disabled
      </Badge>
    );

    const button = screen.getByRole('button', { name: 'Disabled' });
    expect(button).toBeDisabled();

    await user.click(button);
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('merges custom className', () => {
    render(<Badge className="max-w-[140px] truncate">Truncated</Badge>);

    const badge = screen.getByText('Truncated');
    expect(badge).toHaveClass('max-w-[140px]', 'truncate');
  });

  it('forwards ref to button and span elements', () => {
    const spanRef = createRef<HTMLElement>();
    const buttonRef = createRef<HTMLElement>();

    const { rerender } = render(<Badge ref={spanRef}>Span ref</Badge>);
    expect(spanRef.current).toBeInstanceOf(HTMLSpanElement);

    rerender(
      <Badge ref={buttonRef} onClick={() => {}}>
        Button ref
      </Badge>
    );
    expect(buttonRef.current).toBeInstanceOf(HTMLButtonElement);
  });
});
