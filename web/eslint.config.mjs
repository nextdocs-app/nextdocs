import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    settings: {
      // Fix for ESLint 10+: eslint-plugin-react uses context.getFilename() (legacy API)
      // which was removed in ESLint 10 flat config. Declaring the version explicitly
      // prevents the plugin from trying to auto-detect it and failing.
      react: { version: '19' },
    },
  },
  {
    // eslint-config-next 16.4 enables the React Compiler rules. The compiler is
    // not part of this app's build yet, and its latest-ref/imperative-editor
    // patterns trip them; keep those diagnostics advisory until the migration
    // instead of blocking dependency updates on a behavioral refactor.
    rules: {
      'react-hooks/immutability': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // web ships on @y/y. These imports would load a second, incompatible Yjs
    // and silently break syncing, so make them a lint error instead of a review note.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'yjs', message: 'Use @y/y in web.' },
            { name: '@blocknote/core/yjs', message: 'Use @blocknote/core/y.' },
            { name: 'y-websocket', message: 'Use @y/websocket.' },
            { name: 'y-prosemirror', message: 'Use @y/prosemirror.' },
            { name: 'y-monaco', message: 'y-monaco does not support @y/y.' },
          ],
          patterns: [{ group: ['y-protocols', 'y-protocols/*'], message: 'Use @y/protocols.' }],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    '.next/**',
    'out/**',
    'build/**',
    'next-env.d.ts',
  ]),
]);

export default eslintConfig;
