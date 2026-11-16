import { describe, expect, it } from '@jest/globals';
import { createRequire } from 'module';
import { realpathSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const requireFromRealtime = createRequire(import.meta.url);
const realtimeDir = dirname(fileURLToPath(import.meta.url));

/** The real path `request` resolves to when imported from `from`. */
function installedPath(request: string, from: string): string {
  return realpathSync(requireFromRealtime.resolve(request, { paths: [from] }));
}

/**
 * Yhub owns the Y.Doc and passes it to the anchor handlers, so every `instanceof`
 * check in `src/anchor.ts` crosses a package boundary. A second copy of `@y/y`
 * (one nested under `realtime/`, one hoisted for `@y/hub`) has the same source
 * but different constructors, so those checks silently stop matching.
 *
 * `@y/hub` decides the Yjs 14 prerelease line this service must run, and the
 * lines renamed the type API (`Y.Node`), so both packages have to resolve to a
 * single installed copy.
 */
describe('@y/y', () => {
  it('is installed once and shared with @y/hub', () => {
    const hubDir = dirname(installedPath('@y/hub/package.json', realtimeDir));
    expect(installedPath('@y/y/package.json', realtimeDir)).toBe(
      installedPath('@y/y/package.json', hubDir)
    );
  });
});
