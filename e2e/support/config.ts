export const WEB_URL = process.env.E2E_WEB_URL ?? 'http://localhost:3000';
export const API_URL = process.env.E2E_API_URL ?? 'http://localhost:8080';
export const REALTIME_URL = process.env.E2E_REALTIME_URL ?? 'http://localhost:1234';

/**
 * The single seeded account every suite reuses. On a fresh E2E database the
 * first registration bootstraps the workspace, so this account owns it.
 *
 * Credentials are test fixtures, not secrets: they only ever exist in the
 * disposable `nextdocs_e2e` database.
 */
export const OWNER = {
  email: 'e2e-owner@nextdocs.test',
  displayName: 'E2E Owner',
  password: 'E2ePassword!23',
} as const;

/**
 * A second workspace member, invited through the real workspace invite flow.
 * Document-level access is granted per test (VIEW/COMMENT/EDIT).
 */
export const MEMBER = {
  email: 'e2e-member@nextdocs.test',
  displayName: 'E2E Member',
  password: 'E2ePassword!23',
} as const;

export type E2eAccount = typeof OWNER | typeof MEMBER;
