import type { Metadata } from 'next';
import { JoinScreen } from '@/components/auth/JoinScreen';

export const metadata: Metadata = {
  title: 'Join · NextDocs',
  robots: { index: false, follow: false },
};

// The invitation token is read from the fragment on the client, so the page
// itself takes no search params and nothing token-shaped reaches the server.
export default function JoinPage() {
  return <JoinScreen />;
}
