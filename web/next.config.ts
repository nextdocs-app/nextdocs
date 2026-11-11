import type { NextConfig } from 'next';
import { PHASE_TEST } from 'next/constants';

// BlockNote 0.57 ships every package as ESM. Next's bundler consumes ESM
// directly, but Jest runs on CommonJS and its `require()` cannot load these
// `dist` files. `next/jest` loads this config with PHASE_TEST and only
// transforms dependencies listed in `transpilePackages`; Jest's own
// transformIgnorePatterns cannot re-include node_modules. Keeping the list
// test-scoped means production does not recompile packages it already bundles
// correctly.
const blockNotePackages = [
  '@blocknote/code-block',
  '@blocknote/core',
  '@blocknote/diagram-block',
  '@blocknote/math-block',
  '@blocknote/react',
  '@blocknote/shadcn',
  '@blocknote/xl-multi-column',
];

const nextConfig = (phase: string): NextConfig => ({
  output: 'standalone',
  ...(phase === PHASE_TEST ? { transpilePackages: blockNotePackages } : {}),
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
});

export default nextConfig;
