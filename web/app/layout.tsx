import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import '@/styles/globals.css';
import { StoreProvider } from '@/stores/StoreProvider';
import Sidebar from '@/components/Sidebar';
import { Suspense } from 'react';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'NextDocs',
  description:
    'An open-source block-based document editor for structured and collaborative writing.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <StoreProvider>
          <div className="flex h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-background text-foreground">
              <div className="max-w-4xl mx-auto py-8 px-4">
                <Suspense>{children}</Suspense>
              </div>
            </main>
          </div>
        </StoreProvider>
      </body>
    </html>
  );
}
