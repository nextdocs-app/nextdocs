import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';
import { StoreProvider } from '@/stores/StoreProvider';
import { AppShell } from '@/components/AppShell';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
  display: 'swap',
});

// The editor is a touch surface, so the viewport must not be locked to the
// initial scale (`maximumScale`/`userScalable` stay open for pinch-zoom).
//
// `interactiveWidget: 'resizes-content'` shrinks the layout viewport when the
// on-screen keyboard opens, so the shell's `h-dvh` follows the keyboard and the
// caret is never left underneath it. It also makes BlockNote's keyboard-offset
// calculation self-cancelling: layout and visual viewport shrink by the same
// amount, so its docked formatting bar lands exactly on the keyboard's top edge
// with no gap. Browsers that ignore `interactive-widget` (and Chrome, where
// BlockNote opts into the VirtualKeyboard API's `overlaysContent`) keep working
// off BlockNote's own measurement.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  interactiveWidget: 'resizes-content',
};

export const metadata: Metadata = {
  title: 'NextDocs',
  description:
    'An open-source block-based document editor for structured and collaborative writing.',
  icons: {
    icon: [
      {
        url: '/nextdocs-icon.svg',
        type: 'image/svg+xml',
      },
      {
        url: '/nextdocs-favicon.ico',
        sizes: 'any',
      },
    ],
    shortcut: '/nextdocs-icon.svg',
    apple: '/nextdocs-icon.png',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'system';var d=document.documentElement;var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)d.classList.add('dark');d.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <StoreProvider>
          <AppShell>{children}</AppShell>
        </StoreProvider>
      </body>
    </html>
  );
}
