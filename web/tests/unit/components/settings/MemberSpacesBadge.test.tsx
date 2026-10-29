import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemberSpacesBadge } from '../../../../components/settings/workspace/MemberSpacesBadge';
import type { WorkspaceMemberSpaceSummary } from '../../../../types/workspace.types';

const spaces: WorkspaceMemberSpaceSummary[] = [
  { id: 's1', name: 'Design', accessLevel: 'OWNER' },
  { id: 's2', name: 'Docs', accessLevel: 'EDIT' },
];

describe('MemberSpacesBadge', () => {
  it('renders nothing when space memberships are undisclosed', () => {
    const { container } = render(<MemberSpacesBadge memberName="Alice" />);
    expect(container).toBeEmptyDOMElement();

    const { container: nullContainer } = render(
      <MemberSpacesBadge spaces={null} memberName="Alice" />
    );
    expect(nullContainer).toBeEmptyDOMElement();
  });

  it('renders None only when the member really belongs to no space', () => {
    render(<MemberSpacesBadge spaces={[]} memberName="Alice" />);

    expect(screen.getByText('None')).toBeInTheDocument();
  });

  it('opens an anchored popover listing each space and its access level', async () => {
    const user = userEvent.setup();
    render(<MemberSpacesBadge spaces={spaces} memberName="Alice" />);

    const button = screen.getByRole('button', { name: '2 spaces for Alice' });
    await user.click(button);

    // Fixed coordinates from the trigger: the popover must not take part in layout.
    expect(screen.getByRole('dialog', { name: 'Spaces for Alice' })).toHaveStyle({
      position: 'fixed',
    });
    expect(screen.getByText('Assigned Spaces')).toBeInTheDocument();
    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Docs')).toBeInTheDocument();
    expect(screen.getByText('Can edit')).toBeInTheDocument();
  });

  it('dismisses the popover on Escape', async () => {
    const user = userEvent.setup();
    render(<MemberSpacesBadge spaces={spaces} memberName="Alice" />);

    await user.click(screen.getByRole('button', { name: '2 spaces for Alice' }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
