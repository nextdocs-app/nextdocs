import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';

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
  // Matches the installed app's window chrome to the brand accent in light
  // mode and to the shell background in dark mode.
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e78f80' },
    { media: '(prefers-color-scheme: dark)', color: '#171615' },
  ],
};

export const metadata: Metadata = {
  title: 'NextDocs',
  description:
    'An open-source block-based document editor for structured and collaborative writing.',
  applicationName: 'NextDocs',
  // iOS reads these instead of the web manifest: without them a home-screen
  // shortcut opens in Safari with browser chrome instead of as a standalone app.
  appleWebApp: {
    capable: true,
    title: 'NextDocs',
    statusBarStyle: 'default',
  },
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
    apple: [
      {
        url: '/icons/apple-touch-icon.png',
        sizes: '180x180',
        type: 'image/png',
      },
    ],
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
        {/* Next emits the standardized `mobile-web-app-capable`; older iOS
            versions still look for the Apple-prefixed variant. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'system';var d=document.documentElement;var dark=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dark)d.classList.add('dark');d.setAttribute('data-theme',t);}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
