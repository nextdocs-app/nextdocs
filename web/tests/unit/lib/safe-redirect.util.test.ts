import { safeRedirectPath } from '../../../lib/safe-redirect.util';

it.each([
  ['/doc/abc', '/doc/abc'],
  ['/doc/abc?share=1#block', '/doc/abc?share=1#block'],
  ['/', '/'],
])('keeps same-origin path %s', (raw, expected) => {
  expect(safeRedirectPath(raw)).toBe(expected);
});

it.each([
  ['https://evil.example/phish'],
  ['//evil.example/phish'],
  ['/\\evil.example/phish'],
  ['javascript:alert(1)'],
  ['doc/abc'],
  [''],
  [null],
  [undefined],
])('falls back for unsafe value %s', (raw) => {
  expect(safeRedirectPath(raw)).toBe('/');
});

it('uses a caller-supplied fallback', () => {
  expect(safeRedirectPath('//evil.example', '/login')).toBe('/login');
});
