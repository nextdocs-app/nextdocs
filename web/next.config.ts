import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // NOTE: Disabled because BlockNote's Yjs UndoManager / ProseMirror view is
  // torn down during React StrictMode's double-mount (dev only), which breaks
  // undo/redo. We can't find any other workarounds that is not complex.
  //
  // TODO: Maybe we can add a flag to `./nd` (e.g. `./nd dev web --strict`) to
  // turn StrictMode on/off via env when running locally.
  reactStrictMode: false,
  // Allow phone/tablet testing over LAN. Each `*` matches one hostname
  // label, so 192.168.*.* covers 192.168.1.7 without edits per DHCP change.
  allowedDevOrigins: [
    '192.168.*.*',
    '10.*.*.*',
    ...Array.from({ length: 16 }, (_, i) => `172.${i + 16}.*.*`),
  ],
};

export default nextConfig;
