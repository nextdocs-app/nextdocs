import type { MetadataRoute } from 'next';

// Served at `/manifest.webmanifest` and linked automatically by Next's
// file-based metadata. The values here are what browsers use to decide whether
// the app can be installed and how the installed window is presented.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'NextDocs',
    short_name: 'NextDocs',
    description:
      'An open-source block-based document editor for structured and collaborative writing.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#ffffff',
    theme_color: '#e78f80',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
