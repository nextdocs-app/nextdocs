import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Offline · NextDocs',
};

// Pre-cached by `public/sw.js` and served when a navigation cannot reach the
// network and the requested page is not in the runtime cache.
export default function OfflinePage() {
  return (
    <main className="flex min-h-[70dvh] items-center justify-center px-6 py-16">
      <div className="w-full max-w-md text-center">
        <h1 className="text-2xl font-semibold text-foreground">You&apos;re offline</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          This page hasn&apos;t been cached yet. Reconnect to load it, or open a document you
          already have saved on this device.
        </p>
        {/* A full page load is the only navigation guaranteed to work offline;
            client-side routing would need an RSC request. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/"
          className="mt-6 inline-flex items-center justify-center rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90"
        >
          Open NextDocs
        </a>
      </div>
    </main>
  );
}
