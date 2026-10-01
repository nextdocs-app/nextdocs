import { render, screen } from '@testing-library/react';
import { Portal } from '@/components/Portal';

describe('Portal', () => {
  it('renders children into document.body after mount', () => {
    render(
      <Portal>
        <div data-testid="portalled-content">Inside Portal</div>
      </Portal>
    );

    const content = screen.getByTestId('portalled-content');
    expect(content).toBeInTheDocument();
    expect(document.body.contains(content)).toBe(true);
  });
});
