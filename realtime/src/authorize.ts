import { apiError } from '@y/hub';
import type { GlobalPermissionsV1 } from '@y/hub/permissions';
import type { AccessVerdict, UserAuthInfo } from './auth.js';
import {
  adminDocumentPermissions,
  documentPermissions,
  serviceOrgPermissions,
} from './permissions.js';

/**
 * The slice of a Yhub request the auth callbacks read. Narrow on purpose: the decision
 * table is worth testing without constructing a Fastify request.
 */
export type AuthRequest = {
  getHeader(name: string): string | null | undefined;
  getQuery(name: string): string | null | undefined;
};

export interface AuthDeps {
  org: string;
  uuidRegex: RegExp;
  jwtSecret: string;
  isService: (authHeader: string | undefined) => boolean;
  verifyToken: (token: string, secret: string) => { sub: string } | null;
  checkAccess: (docid: string, token?: string | null) => Promise<AccessVerdict | null>;
  onAuthorized: (docid: string) => void;
}

/**
 * Builds the deny-by-default Yhub auth callbacks. Extracting them keeps the decisions
 * (who is the service, which token wins, what a document/organization verdict is)
 * testable without starting a server.
 */
export function buildAuthCallbacks(deps: AuthDeps) {
  return {
    async authenticate(req: AuthRequest): Promise<UserAuthInfo> {
      const authHeader = req.getHeader('authorization') ?? undefined;
      const queryToken = req.getQuery('token')?.trim() ?? undefined;

      // The service identity is server-to-server only. A query token is a URL a
      // browser can be tricked into opening, so it is never accepted as the service
      // credential — even if it holds the right value.
      if (deps.isService(authHeader)) {
        return { userid: 'service', isService: true };
      }

      // The HTTP auth scheme is case-insensitive, and a proxy may normalize it.
      const headerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
      const token = headerToken || queryToken || '';

      if (!token) {
        return { userid: 'anonymous' };
      }

      const payload = deps.verifyToken(token, deps.jwtSecret);
      if (!payload) {
        throw apiError(401, 'Invalid or expired token');
      }

      return { userid: payload.sub, token };
    },

    authorize: {
      async document(
        { org, docid, branch }: { org: string; docid: string; branch: string },
        user: UserAuthInfo | null
      ) {
        if (user?.isService) {
          return adminDocumentPermissions;
        }

        if (org !== deps.org || branch !== 'main' || !deps.uuidRegex.test(docid)) {
          return null;
        }

        const access = await deps.checkAccess(docid, user?.token);
        // An allowed verdict without a level cannot grant anything; the API always
        // sends one for an admitted document, so this only rejects a malformed reply.
        if (!access || !access.allowed || access.trashed || !access.accessLevel) {
          return null;
        }

        deps.onAuthorized(docid);
        return documentPermissions(access.accessLevel);
      },

      async org({ org }: { org: string }, user: UserAuthInfo | null) {
        if (!user?.isService || org !== deps.org) {
          return null;
        }
        return serviceOrgPermissions;
      },

      async global(): Promise<GlobalPermissionsV1> {
        return {
          type: 'permissions:global:v1',
          endpoint: { health: '-r--', ping: '-r--' },
        };
      },
    },
  };
}
