import type { DocumentPermissionsV1, OrgPermissionsV1 } from '@y/hub/permissions';

export type AccessLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER';

/**
 * Browser permissions.
 *
 * Only the endpoints a browser actually uses are named. Yhub is deny-by-default,
 * so a future built-in endpoint stays closed until it is added here on purpose.
 * Trash is an API concept, but version history is Yhub's own activity log: every
 * reader may list it and load a historical snapshot. Only EDIT/OWNER may restore
 * (rollback) or annotate versions, because those write the Y.Doc. The `anchor`
 * endpoint is the one deliberate Y.Doc mutation for COMMENT users: the service
 * inserts a trusted comment mark, never a client-supplied update.
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
      // Awareness is ephemeral presence, not content: a reader who may watch the
      // document may also say "I am here", or their avatar could never appear in
      // the toolbar's viewer group. Nothing they write reaches the Y.Doc.
      awareness: '-ru-',
      // `from: 0` grants the whole recorded history; named versions are read-only.
      // No rollback: restoring is a document write, which a viewer cannot perform.
      history: { from: 0, version: '-r--' },
      endpoint: {
        ws: '-r--',
        ydoc: '-r--',
        // Built-in Yhub history reads: the activity timeline, a historical Y.Doc
        // snapshot (changeset), and the named-version annotations.
        activity: '-r--',
        changeset: '-r--',
        version: '-r--',
      },
    };
  }

  if (level === 'COMMENT') {
    return {
      type: 'permissions:document:v1',
      ydoc: '-r--',
      awareness: '-ru-',
      // Commenters may inspect history but not save versions or roll the document
      // back: both mutate the Y.Doc, which COMMENT deliberately cannot write.
      history: { from: 0, version: '-r--' },
      endpoint: {
        ws: '-r--',
        ydoc: '-r--',
        activity: '-r--',
        changeset: '-r--',
        version: '-r--',
        // COMMENT never writes the Y.Doc; it only asks the server to insert the
        // mark for a thread it may comment on. `d` is granted for orphan cleanup:
        // the handler removes an anchor only after the API says the thread is gone.
        anchor: 'c--d',
      },
    };
  }

  if (level === 'EDIT' || level === 'OWNER') {
    return {
      type: 'permissions:document:v1',
      ydoc: '-ru-',
      awareness: '-ru-',
      // Restoring is Yhub's rollback: it rewrites the live Y.Doc with the content
      // of an older activity window, comment anchors included. Named versions are
      // Yhub annotations over the same timeline, so the full mask is safe here.
      history: { from: 0, rollback: true, version: 'crud' },
      endpoint: {
        ws: '-ru-',
        ydoc: '-ru-',
        activity: '-r--',
        changeset: '-r--',
        version: 'crud',
        rollback: 'c---',
        anchor: 'c--d',
      },
    };
  }

  return null;
}

/**
 * The service identity: the API's seed, content read and purge calls.
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
 * Org-scoped service permissions: the batched recheck used after an access change, and
 * the batched content reindex used by the search crawl. Service-only; a browser's org
 * answer is null.
 */
export const serviceOrgPermissions: OrgPermissionsV1 = {
  type: 'permissions:org:v1',
  endpoint: { recheck: 'c---', 'search-reindex': 'c---' },
};
