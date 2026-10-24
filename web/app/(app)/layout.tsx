import { StoreProvider } from '@/stores/StoreProvider';
import { AppShell } from '@/components/AppShell';
import { ServiceWorkerRegistrar } from '@/components/ServiceWorkerRegistrar';
import '@/styles/app.css';

/**
 * The document application: sidebar, store, offline replay, and the PWA
 * registration all live here. Public routes (offline fallback, auth screens)
 * sit outside this group so they never mount the document store or shell.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <StoreProvider>
      <ServiceWorkerRegistrar />
      <AppShell>{children}</AppShell>
    </StoreProvider>
  );
}
