import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import '@/styles/globals.css';
import { StoreProvider } from '@/stores/StoreProvider';
import { AppShell } from '@/components/AppShell';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

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
