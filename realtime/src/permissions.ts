import type { DocumentPermissionsV1, OrgPermissionsV1 } from '@y/hub/permissions';

export type AccessLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER';

/**
 * Browser permissions.
 *
 * Only the endpoints a browser actually uses are named. Yhub is deny-by-default,
 * so a future built-in endpoint stays closed until it is added here on purpose.
 * Trash is an API concept and history is not exposed yet, so neither is granted.
 *
 * An unrecognized level returns null: the level arrives in an HTTP response, and a
 * mapping that fell through to the write branch would turn a malformed answer into
 * edit access. Denial is the only safe default.
 */
export function documentPermissions(level: AccessLevel | string): DocumentPermissionsV1 | null {
  if (level === 'VIEW') {
    return {
      type: 'permissions:document:v1',
      ydoc: '-r--',
      awareness: '-r--',
      endpoint: {
        ws: '-r--',
        ydoc: '-r--',
      },
    };
  }

  if (level === 'COMMENT') {
    return {
      type: 'permissions:document:v1',
      ydoc: '-r--',
      awareness: '-ru-',
      endpoint: {
        ws: '-r--',
        ydoc: '-r--',
      },
    };
  }

  if (level === 'EDIT' || level === 'OWNER') {
    return {
      type: 'permissions:document:v1',
      ydoc: '-ru-',
      awareness: '-ru-',
      endpoint: {
        ws: '-ru-',
        ydoc: '-ru-',
      },
    };
  }

  return null;
}

/**
 * The service identity: the API's seed, projection and purge calls.
 *
 * Deletion is the only way to erase content, so it is granted explicitly. No
 * wildcard endpoint and no history grant — the service never reads history, and a
 * wildcard would silently grant any endpoint a later Yhub release adds.
 */
export const adminDocumentPermissions: DocumentPermissionsV1 = {
  type: 'permissions:document:v1',
  ydoc: '-ru-',
  awareness: '-ru-',
  delete: ['soft', 'hard'],
  endpoint: { ws: 'crud', ydoc: 'crud' },
};

/**
 * Org-scoped service permissions: the write-time listing used by the projection
 * job and the batched recheck used after an access change. Both are service-only;
 * a browser's org answer is null.
 */
export const serviceOrgPermissions: OrgPermissionsV1 = {
  type: 'permissions:org:v1',
  endpoint: { updated: '-r--', recheck: 'c---' },
};
