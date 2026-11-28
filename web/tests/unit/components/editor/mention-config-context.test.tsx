import { render, screen } from '@testing-library/react';
import {
  MentionConfigProvider,
  useMentionConfig,
} from '../../../../components/editor/mentions/MentionConfigContext';

function Probe() {
  const config = useMentionConfig();
  if (!config) {
    return <span>no-config</span>;
  }
  return (
    <span>
      {config.documentId}:{config.enabled ? 'enabled' : 'disabled'}:
      {config.getAccessToken() ?? 'guest'}
    </span>
  );
}

describe('MentionConfigContext', () => {
  it('returns null outside the provider so a bare editor binds no menu', () => {
    render(<Probe />);

    expect(screen.getByText('no-config')).toBeInTheDocument();
  });

  it('hands the whole config to a bound editor', () => {
    render(
      <MentionConfigProvider
        value={{ documentId: 'doc-1', enabled: true, getAccessToken: () => 'token-1' }}
      >
        <Probe />
      </MentionConfigProvider>
    );

    expect(screen.getByText('doc-1:enabled:token-1')).toBeInTheDocument();
  });
});
