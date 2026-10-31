import * as Y from 'yjs';
import { indexedDBService } from './indexed-db.service';
import {
  createYjsDoc,
  encodeYjsState,
  decodeYjsState,
  createDefaultDocumentMeta,
} from '@/lib/yjs.util';
import type {
  DocumentIcon,
  DocumentMeta,
  DocumentLoadResult,
  StoredDocument,
} from '@/types/document.types';
import type { TreeNode, TreeNodePage, MoveDocumentRequest } from '@/types/tree.types';
import { getApiBaseUrl } from '@/lib/api-url.util';
import { clearLocalDocumentParent, setLocalDocumentParents } from '@/lib/local-tree.util';
import { parseApiEnvelope } from '@/services/api-envelope';
import {
  sanitizeDocumentCover,
  sanitizeDocumentIcon,
  toCoverRequestPayload,
  toIconRequestPayload,
  type CoverRequestPayload,
  type IconRequestPayload,
} from '@/lib/document-icon.util';

const CURRENT_SCHEMA_VERSION = 1;

/**
 * Builds an icon/cover PATCH body. Clearing needs an explicit null payload
 * while omitting a key means "leave unchanged" — a distinction
 * `Partial<DocumentMeta>` (where undefined already means "unchanged") cannot
 * express, hence the `in` checks rather than truthiness.
 */
export function iconCoverPatch(patch: {
  icon?: DocumentMeta['icon'] | null;
  cover?: DocumentMeta['cover'] | null;
}): { icon?: IconRequestPayload; cover?: CoverRequestPayload } {
  const request: { icon?: IconRequestPayload; cover?: CoverRequestPayload } = {};
  if ('icon' in patch) {
    request.icon = toIconRequestPayload(patch.icon ?? null);
  }
  if ('cover' in patch) {
    request.cover = toCoverRequestPayload(patch.cover ?? null);
  }
  return request;
}

interface ApiPage<T> {
  content: T[];
  totalElements: number;
  totalPages: number;
  size: number;
  number: number;
  first: boolean;
  last: boolean;
}

/** Icon and cover sub-objects as they appear on the wire (types are lowercase). */
interface ApiDocumentIcon {
  type?: string | null;
  value?: string | null;
  color?: string | null;
}

interface ApiDocumentCover extends ApiDocumentIcon {
  position?: number | null;
}

interface ApiDocument {
  id: string;
  title: string;
  icon?: ApiDocumentIcon | null;
  cover?: ApiDocumentCover | null;
  yjsState?: string | null;
  parentId?: string | null;
  orderKey?: string | null;
  hasChildren?: boolean;
  hasCollaborators?: boolean;
  accessLevel?: DocumentAccessLevel | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  purgeAt?: string | null;
}

export type DocumentAccessLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER';
export type CollaboratorAccessLevel = DocumentAccessLevel | 'NO_ACCESS';
export type DocumentGeneralAccessMode = 'RESTRICTED' | 'ANYONE_WITH_LINK';

const DOCUMENT_ACCESS_LEVELS: readonly string[] = ['VIEW', 'COMMENT', 'EDIT', 'OWNER'];
const COLLABORATOR_ACCESS_LEVELS: readonly string[] = [
  'VIEW',
  'COMMENT',
  'EDIT',
  'OWNER',
  'NO_ACCESS',
];
const GENERAL_ACCESS_MODES: readonly string[] = ['RESTRICTED', 'ANYONE_WITH_LINK'];

/** True for the four levels the API may report on the document channel. */
export function isValidDocumentAccessLevel(value: unknown): value is DocumentAccessLevel {
  return typeof value === 'string' && DOCUMENT_ACCESS_LEVELS.includes(value);
}

function isValidCollaboratorAccessLevel(value: unknown): value is CollaboratorAccessLevel {
  return typeof value === 'string' && COLLABORATOR_ACCESS_LEVELS.includes(value);
}

function isValidGeneralAccessMode(value: unknown): value is DocumentGeneralAccessMode {
  return typeof value === 'string' && GENERAL_ACCESS_MODES.includes(value);
}

/**
 * Untrusted payloads (share-link reads, breadcrumbs, public children) flow
 * straight into access state that gates editing. A malformed level must never
 * become edit capability: unknown values fall back instead of passing through.
 */
export function sanitizeDocumentAccessLevel(
  value: unknown,
  fallback: DocumentAccessLevel = 'VIEW'
): DocumentAccessLevel {
  return isValidDocumentAccessLevel(value) ? value : fallback;
}

/** Same guard for nullable access fields: unknown values become null (unknown). */
export function sanitizeNullableAccessLevel(value: unknown): DocumentAccessLevel | null {
  return isValidDocumentAccessLevel(value) ? value : null;
}

/** Collaborator rows carry an extra NO_ACCESS breakpoint; unknown values fall back. */
function sanitizeCollaboratorAccessLevel(
  value: unknown,
  fallback: CollaboratorAccessLevel = 'VIEW'
): CollaboratorAccessLevel {
  return isValidCollaboratorAccessLevel(value) ? value : fallback;
}

/** Sharing settings mode; unknown values fall back to RESTRICTED. */
function sanitizeGeneralAccessMode(
  value: unknown,
  fallback: DocumentGeneralAccessMode = 'RESTRICTED'
): DocumentGeneralAccessMode {
  return isValidGeneralAccessMode(value) ? value : fallback;
}

function sanitizeDocumentSpace(
  space: ApiDocumentSpace | null | undefined
): DocumentSpaceSummary | null {
  if (!space || typeof space.id !== 'string') {
    return null;
  }
  return {
    id: space.id,
    name: space.name,
    accessMode: space.accessMode === 'PUBLIC' ? 'PUBLIC' : 'CUSTOM',
    everyoneAccessLevel: sanitizeNullableAccessLevel(space.everyoneAccessLevel),
    myAccessLevel: sanitizeNullableAccessLevel(space.myAccessLevel),
    canAdminister: space.canAdminister ?? false,
    archived: space.archived ?? false,
  };
}

interface ApiDocumentAccess {
  documentId: string;
  allowed: boolean;
  accessLevel: DocumentAccessLevel | null;
  owner: boolean;
  trashed?: boolean;
  canManageSharing?: boolean;
  space?: ApiDocumentSpace | null;
}

interface ApiDocumentSpace {
  id: string;
  name: string;
  accessMode: 'PUBLIC' | 'CUSTOM';
  everyoneAccessLevel?: DocumentAccessLevel | null;
  myAccessLevel?: DocumentAccessLevel | null;
  canAdminister?: boolean;
  archived?: boolean;
}

interface ApiCollaborator {
  userId: string;
  email: string;
  displayName: string;
  accessLevel: CollaboratorAccessLevel;
  addedAt: string;
  owner?: boolean;
  inherited?: boolean;
  inheritedFromId?: string | null;
  inheritedFromTitle?: string | null;
  inheritedAccessLevel?: DocumentAccessLevel | null;
  effectiveAccessLevel?: CollaboratorAccessLevel | null;
}

interface ApiBreadcrumbSpace {
  id: string;
  name: string;
  icon?: ApiDocumentIcon | null;
}

interface ApiDocumentBreadcrumbItem extends Omit<DocumentBreadcrumbItem, 'icon' | 'space'> {
  icon?: ApiDocumentIcon | null;
  space?: ApiBreadcrumbSpace | null;
}

interface ApiSharingSettings {
  generalAccessMode: DocumentGeneralAccessMode;
  linkAccessLevel: DocumentAccessLevel;
  hasActiveLink: boolean;
  inherited?: boolean;
  inheritedFromId?: string | null;
  inheritedFromTitle?: string | null;
  linkInheritBlocked?: boolean;
}

export interface CloudDocumentsPage {
  items: {
    id: string;
    meta: DocumentMeta;
    parentId: string | null;
    orderKey?: string | null;
    hasChildren?: boolean;
    hasCollaborators?: boolean;
    accessLevel?: DocumentAccessLevel | null;
  }[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  hasMore: boolean;
}

export interface DocumentSpaceSummary {
  id: string;
  name: string;
  accessMode: 'PUBLIC' | 'CUSTOM';
  everyoneAccessLevel: DocumentAccessLevel | null;
  myAccessLevel: DocumentAccessLevel | null;
  canAdminister: boolean;
  archived: boolean;
}

export interface DocumentAccess {
  documentId: string;
  allowed: boolean;
  accessLevel: DocumentAccessLevel | null;
  owner: boolean;
  /** True when the document is in trash; accessLevel then reflects pre-trash access. */
  trashed?: boolean;
  /** Server-authoritative sharing gate: space administration for space pages. */
  canManageSharing?: boolean;
  /** Space context when the page lives in a space. */
  space?: DocumentSpaceSummary | null;
}

export interface Collaborator {
  userId: string;
  email: string;
  displayName: string;
  accessLevel: CollaboratorAccessLevel;
  addedAt: string;
  owner: boolean;
  inherited?: boolean;
  inheritedFromId?: string | null;
  inheritedFromTitle?: string | null;
  inheritedAccessLevel?: DocumentAccessLevel | null;
  /** What the person can actually do after space/archive resolution. */
  effectiveAccessLevel?: CollaboratorAccessLevel;
}

export interface SharingSettings {
  generalAccessMode: DocumentGeneralAccessMode;
  linkAccessLevel: DocumentAccessLevel;
  hasActiveLink: boolean;
  inherited?: boolean;
  inheritedFromId?: string | null;
  inheritedFromTitle?: string | null;
  /** Own block on link inheritance (general-access NO_ACCESS analogue). */
  linkInheritBlocked?: boolean;
}

export interface DocumentBreadcrumbSpace {
  id: string;
  name: string;
  icon?: DocumentIcon | null;
}

export interface DocumentBreadcrumbItem {
  id: string;
  title: string;
  icon?: DocumentIcon | null;
  parentId?: string | null;
  orderKey?: string | null;
  accessLevel?: DocumentAccessLevel | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  space?: DocumentBreadcrumbSpace | null;
}

export class DocumentServiceApiError extends Error {
  readonly status: number;
  /** Milliseconds from the server Retry-After response header (429s), if present. */
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, retryAfterMs?: number) {
    super(message);
    this.name = 'DocumentServiceApiError';
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (value == null) {
    return undefined;
  }
  // Server only sends delay-seconds (see RateLimitFilter); an HTTP-date falls
  // through to undefined so callers use their default backoff instead of 0.
  const seconds = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds * 1000;
}

const MAX_SESSION_REGISTRY_SIZE = 500;

class DocumentService {
  private originByDocId = new Map<string, StoredDocument['origin']>();

  private hierarchyCache: { key: string; promise: Promise<void> } | null = null;

  private hierarchyCacheEpoch = 0;

  private recordOrigin(id: string, origin: StoredDocument['origin']): void {
    if (this.originByDocId.has(id)) {
      this.originByDocId.delete(id);
    } else if (this.originByDocId.size >= MAX_SESSION_REGISTRY_SIZE) {
      const oldestKey = this.originByDocId.keys().next().value;
      if (oldestKey !== undefined) {
        this.originByDocId.delete(oldestKey);
      }
    }
    this.originByDocId.set(id, origin);
  }

  public async loadDocument(id: string): Promise<DocumentLoadResult | null> {
    const storedDoc = await indexedDBService.getDocument(id);

    if (!storedDoc) {
      return null;
    }

    if (storedDoc.origin !== undefined) {
      this.recordOrigin(id, storedDoc.origin);
    }

    const ydoc = decodeYjsState(storedDoc.yjsState);

    return {
      ydoc,
      // IndexedDB may hold icon/cover written before sanitization hardened, so
      // re-validate on read: stale garbage degrades to "no icon/cover" here
      // instead of reaching render.
      meta: {
        ...storedDoc.meta,
        icon: sanitizeDocumentIcon(storedDoc.meta.icon),
        cover: sanitizeDocumentCover(storedDoc.meta.cover),
      },
      origin: storedDoc.origin,
    };
  }

  /**
   * In-memory registry of documents opened through an anonymous share link in
   * this session. Combined with the persisted {@link StoredDocument.origin}
   * tag, it lets background savers (which only see id/ydoc/meta) attribute
   * guest writes to the link instead of the local account.
   */
  private publicLinkSessionIds = new Set<string>();

  public notePublicLinkDocument(id: string): void {
    if (this.publicLinkSessionIds.has(id)) {
      this.publicLinkSessionIds.delete(id);
    } else if (this.publicLinkSessionIds.size >= MAX_SESSION_REGISTRY_SIZE) {
      const oldest = this.publicLinkSessionIds.values().next().value;
      if (oldest !== undefined) {
        this.publicLinkSessionIds.delete(oldest);
      }
    }
    this.publicLinkSessionIds.add(id);
  }

  public isPublicLinkDocument(id: string): boolean {
    return this.publicLinkSessionIds.has(id);
  }

  public clearSessionRegistries(): void {
    this.hierarchyCache = null;
    this.hierarchyCacheEpoch += 1;
    this.originByDocId.clear();
    this.publicLinkSessionIds.clear();
  }

  public async saveDocument(
    id: string,
    ydoc: Y.Doc,
    meta: DocumentMeta,
    options?: { touchUpdatedAt?: boolean; origin?: StoredDocument['origin'] }
  ): Promise<void> {
    try {
      // We store Yjs state as binary for efficient sync and future backend compatibility
      const yjsState = encodeYjsState(ydoc);
      const touchUpdatedAt = options?.touchUpdatedAt ?? true;

      const updatedMeta: DocumentMeta = {
        ...meta,
        updatedAt: touchUpdatedAt ? new Date().toISOString() : meta.updatedAt,
      };

      // Preserve a previously recorded origin (e.g. a share-link mirror being
      // re-saved by a title update) unless the caller explicitly sets one.
      let origin = options?.origin;
      if (origin !== undefined) {
        this.recordOrigin(id, origin);
      } else {
        origin = this.originByDocId.get(id);
      }

      await indexedDBService.saveDocument({
        id,
        meta: updatedMeta,
        yjsState,
        version: CURRENT_SCHEMA_VERSION,
        ...(origin !== undefined ? { origin } : {}),
      });
    } catch (error) {
      console.error('Failed to save document:', error);
      throw error;
    }
  }

  public async createDocument(title?: string): Promise<{ ydoc: Y.Doc; meta: DocumentMeta }> {
    const meta = createDefaultDocumentMeta(title);
    const ydoc = createYjsDoc();

    return { ydoc, meta };
  }

  public async deleteDocument(id: string): Promise<void> {
    this.originByDocId.delete(id);
    this.publicLinkSessionIds.delete(id);
    try {
      await indexedDBService.deleteDocument(id);
      clearLocalDocumentParent(id);
    } catch (error) {
      console.error('Failed to delete document:', error);
      throw error;
    }
  }

  public async documentExists(id: string): Promise<boolean> {
    const doc = await indexedDBService.getDocument(id);
    return doc !== undefined;
  }

  public getCurrentUserId(): string | null {
    return indexedDBService.getUserId();
  }

  public async getAllDocumentsMeta(): Promise<
    { id: string; meta: DocumentMeta; origin?: StoredDocument['origin'] }[]
  > {
    // There is no signed-out private workspace: the guest database only holds
    // share-link mirrors, which never belong in a private listing.
    if (indexedDBService.getUserId() === null) {
      return [];
    }

    try {
      const docs = await indexedDBService.getAllDocuments();
      // Share-link mirrors carry someone else's content: they live in the
      // guest Shared section (public endpoints), never in Private listings.
      // Records predating the origin tag have it undefined and count as local.
      return docs
        .filter((doc) => doc.origin !== 'public-link')
        .map((doc) => ({
          id: doc.id,
          meta: {
            ...doc.meta,
            icon: sanitizeDocumentIcon(doc.meta.icon),
            cover: sanitizeDocumentCover(doc.meta.cover),
          },
          origin: doc.origin,
        }));
    } catch (error) {
      console.error('Failed to get all documents:', error);
      return [];
    }
  }

  public async listCloudDocuments(
    accessToken: string,
    page = 0,
    size = 20,
    options?: {
      parentId?: string;
      scope?: 'all' | 'private' | 'shared' | 'space';
      spaceId?: string;
      trashed?: boolean;
      sort?: string;
    }
  ): Promise<CloudDocumentsPage> {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
    });

    if (options?.parentId) {
      params.set('parentId', options.parentId);
    }
    if (options?.scope) {
      params.set('scope', options.scope);
    }
    if (options?.spaceId) {
      params.set('spaceId', options.spaceId);
    }
    if (options?.trashed) {
      params.set('trashed', 'true');
    }
    if (options?.sort) {
      params.set('sort', options.sort);
    }

    const body = await this.fetchApi<ApiPage<ApiDocument>>(
      `/api/v1/documents?${params.toString()}`,
      {
        method: 'GET',
        accessToken,
      }
    );

    const items = body.content.map((doc) => ({
      id: doc.id,
      meta: this.toDocumentMeta(doc),
      parentId: doc.parentId ?? null,
      orderKey: doc.orderKey ?? null,
      hasChildren: doc.hasChildren ?? false,
      hasCollaborators: doc.hasCollaborators ?? false,
      accessLevel: sanitizeNullableAccessLevel(doc.accessLevel),
    }));

    return {
      items,
      page: body.number,
      size: body.size,
      totalElements: body.totalElements,
      totalPages: body.totalPages,
      hasMore: !body.last,
    };
  }

  /**
   * The sidebar only fetches roots and expanded branches, so those calls alone
   * leave most cached documents without a parent link for the offline fallback.
   * Pull the flat private listing once per signed-in session and record the
   * complete hierarchy.
   */
  public cachePrivateHierarchy(accessToken: string, cacheKey: string): Promise<void> {
    if (this.hierarchyCache?.key === cacheKey) {
      return this.hierarchyCache.promise;
    }

    const epoch = this.hierarchyCacheEpoch;
    const promise = this.fetchPrivateHierarchy(accessToken, epoch).catch((error) => {
      if (this.hierarchyCache?.promise === promise) {
        this.hierarchyCache = null;
      }
      throw error;
    });
    this.hierarchyCache = { key: cacheKey, promise };
    return promise;
  }

  private async fetchPrivateHierarchy(accessToken: string, epoch: number): Promise<void> {
    const pageSize = 200;
    let page = 0;

    for (;;) {
      const result = await this.listCloudDocuments(accessToken, page, pageSize, {
        scope: 'private',
      });
      // A logout or identity change clears the map; do not repopulate it from
      // a request started under the previous session.
      if (epoch !== this.hierarchyCacheEpoch) {
        return;
      }
      this.cacheParentLinks(result.items);

      if (!result.hasMore || result.items.length === 0) {
        return;
      }
      page += 1;
    }
  }

  /**
   * Sidebar tree nodes for one listing page. The tree listings differ only in the
   * access level they fall back to, so the mapping lives here once.
   */
  private toTreeNodePage(
    pageResult: CloudDocumentsPage,
    accessLevelOf: (item: CloudDocumentsPage['items'][number]) => TreeNode['effectiveAccessLevel']
  ): TreeNodePage {
    const items = pageResult.items.map((item) => ({
      id: item.id,
      title: item.meta.title,
      parentId: item.parentId,
      orderKey: item.orderKey ?? '',
      hasChildren: item.hasChildren ?? false,
      effectiveAccessLevel: accessLevelOf(item),
      createdAt: item.meta.createdAt,
      updatedAt: item.meta.updatedAt,
      // `toDocumentMeta` already sanitized, but re-validate at the tree
      // boundary so a future caller passing unsanitized meta cannot reach render.
      icon: sanitizeDocumentIcon(item.meta.icon) ?? null,
    }));
    this.cacheParentLinks(items);

    return {
      items,
      page: pageResult.page,
      size: pageResult.size,
      totalElements: pageResult.totalElements,
      totalPages: pageResult.totalPages,
      hasMore: pageResult.hasMore,
    };
  }

  public async listRootTreeNodes(accessToken: string, page = 0, size = 50): Promise<TreeNodePage> {
    const pageResult = await this.listCloudDocuments(accessToken, page, size, {
      parentId: 'root',
      scope: 'private',
    });

    return this.toTreeNodePage(pageResult, (item) =>
      sanitizeDocumentAccessLevel(item.accessLevel, 'OWNER')
    );
  }

  public async listChildTreeNodes(
    parentId: string,
    accessToken: string,
    page = 0,
    size = 50
  ): Promise<TreeNodePage> {
    const pageResult = await this.listCloudDocuments(accessToken, page, size, {
      parentId,
    });

    return this.toTreeNodePage(pageResult, (item) => sanitizeNullableAccessLevel(item.accessLevel));
  }

  public async moveDocument(
    documentId: string,
    request: MoveDocumentRequest,
    accessToken: string
  ): Promise<TreeNode> {
    const body = await this.fetchApi<ApiDocument>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/move`,
      {
        method: 'POST',
        accessToken,
        body: JSON.stringify(request),
      }
    );

    // The tree slices apply the server-returned node in moveDocumentThunk;
    // the cached parent link is what keeps the move after an offline reload.
    this.cacheParentLinks([{ id: body.id, parentId: body.parentId ?? null }]);

    // We don't need to do emitCloudDocumentsChanged() here. Both tree slices
    // apply the server-returned node + orderKey in moveDocumentThunk.fulfilled,
    // so a global refetch is redundant.
    return {
      id: body.id,
      title: body.title,
      parentId: body.parentId ?? null,
      orderKey: body.orderKey ?? '',
      hasChildren: body.hasChildren ?? false,
      effectiveAccessLevel: sanitizeNullableAccessLevel(body.accessLevel),
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
      icon: sanitizeDocumentIcon(body.icon) ?? null,
    };
  }

  public async getCloudDocument(
    id: string,
    accessToken: string,
    options?: { includeTrashed?: boolean } | boolean
  ): Promise<DocumentLoadResult> {
    const includeTrashed =
      typeof options === 'boolean' ? options : (options?.includeTrashed ?? false);
    const body = await this.fetchApi<ApiDocument>(
      `/api/v1/documents/${encodeURIComponent(id)}${includeTrashed ? '?includeTrashed=true' : ''}`,
      {
        method: 'GET',
        accessToken,
      }
    );

    const ydoc = body.yjsState
      ? decodeYjsState(this.base64ToUint8Array(body.yjsState))
      : createYjsDoc();
    this.cacheParentLinks([{ id: body.id, parentId: body.parentId ?? null }]);

    return {
      ydoc,
      meta: this.toDocumentMeta(body),
    };
  }

  public async getPublicDocument(id: string): Promise<DocumentLoadResult> {
    return this.dedupedGet(`public-doc:${id}`, async () => {
      const body = await this.fetchApi<ApiDocument>(
        `/api/v1/documents/${encodeURIComponent(id)}/public`,
        {
          method: 'GET',
        }
      );

      const ydoc = body.yjsState
        ? decodeYjsState(this.base64ToUint8Array(body.yjsState))
        : createYjsDoc();

      return {
        ydoc,
        meta: this.toDocumentMeta(body),
        accessLevel: sanitizeNullableAccessLevel(body.accessLevel),
      };
    });
  }

  public async getDocumentBreadcrumbs(
    id: string,
    accessToken?: string | null
  ): Promise<DocumentBreadcrumbItem[]> {
    // Breadcrumb chain and guest sidebar need the same path concurrently.
    return this.dedupedGet(`breadcrumbs:${id}:${accessToken ? 'auth' : 'anon'}`, async () => {
      const items = accessToken
        ? await this.fetchApi<ApiDocumentBreadcrumbItem[]>(
            `/api/v1/documents/${encodeURIComponent(id)}/path`,
            {
              method: 'GET',
              accessToken,
            }
          )
        : await this.fetchApi<ApiDocumentBreadcrumbItem[]>(
            `/api/v1/documents/${encodeURIComponent(id)}/public/path`,
            {
              method: 'GET',
            }
          );

      const crumbs = items.map((item) => ({
        ...item,
        icon: sanitizeDocumentIcon(item.icon) ?? null,
        space: item.space
          ? {
              id: item.space.id,
              name: item.space.name,
              icon: sanitizeDocumentIcon(item.space.icon) ?? null,
            }
          : null,
      }));

      // Private breadcrumbs describe the same hierarchy the offline fallback
      // has to rebuild. Public-link paths must not leak into that map.
      if (accessToken) {
        this.cacheParentLinks(crumbs);
      }

      return crumbs;
    });
  }

  public async getMyAccess(id: string, accessToken: string): Promise<DocumentAccess> {
    const body = await this.fetchApi<ApiDocumentAccess>(
      `/api/v1/documents/${encodeURIComponent(id)}/my-access`,
      {
        method: 'GET',
        accessToken,
      }
    );

    return {
      documentId: body.documentId,
      allowed: body.allowed,
      accessLevel: sanitizeNullableAccessLevel(body.accessLevel),
      owner: body.owner,
      trashed: body.trashed,
      canManageSharing: body.canManageSharing ?? false,
      space: sanitizeDocumentSpace(body.space),
    };
  }

  public async checkAccess(id: string, accessToken?: string | null): Promise<DocumentAccess> {
    return this.dedupedGet(`access-check:${id}:${accessToken ? 'auth' : 'anon'}`, async () => {
      const body = await this.fetchApi<ApiDocumentAccess>(
        `/api/v1/documents/${encodeURIComponent(id)}/access-check`,
        {
          method: 'GET',
          ...(accessToken ? { accessToken } : {}),
        }
      );

      return {
        documentId: body.documentId,
        allowed: body.allowed,
        accessLevel: sanitizeNullableAccessLevel(body.accessLevel),
        owner: body.owner,
        trashed: body.trashed,
        canManageSharing: body.canManageSharing ?? false,
        space: sanitizeDocumentSpace(body.space),
      };
    });
  }

  public async listPublicChildren(parentId: string, page = 0, size = 50): Promise<TreeNodePage> {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
    });
    const body = await this.fetchApi<ApiPage<ApiDocument>>(
      `/api/v1/documents/${encodeURIComponent(parentId)}/public/children?${params.toString()}`,
      {
        method: 'GET',
      }
    );

    const items = body.content.map((doc) => ({
      id: doc.id,
      title: doc.title || 'Untitled',
      parentId: doc.parentId ?? parentId,
      orderKey: doc.orderKey ?? '',
      hasChildren: doc.hasChildren ?? false,
      effectiveAccessLevel: sanitizeDocumentAccessLevel(doc.accessLevel, 'VIEW'),
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      icon: sanitizeDocumentIcon(doc.icon) ?? null,
    }));

    return {
      items,
      page: body.number,
      size: body.size,
      totalElements: body.totalElements,
      totalPages: body.totalPages,
      hasMore: !body.last,
    };
  }

  public async listSharedDocuments(
    accessToken: string,
    page = 0,
    size = 20
  ): Promise<CloudDocumentsPage> {
    return this.listCloudDocuments(accessToken, page, size, {
      scope: 'shared',
    });
  }

  /**
   * Root documents filed into one space, as tree nodes for the sidebar's space
   * groups. The server already drops documents the caller cannot open, so callers
   * render what arrives; nested documents load through `listChildTreeNodes`.
   */
  public async listSpaceRootTreeNodes(
    accessToken: string,
    spaceId: string,
    page = 0,
    size = 100
  ): Promise<TreeNodePage> {
    const pageResult = await this.listCloudDocuments(accessToken, page, size, {
      scope: 'space',
      spaceId,
    });

    return this.toTreeNodePage(pageResult, (item) => sanitizeNullableAccessLevel(item.accessLevel));
  }

  /** One collaborator row, from any endpoint that answers with collaborator rows. */
  private toCollaborator(item: ApiCollaborator): Collaborator {
    return {
      userId: item.userId,
      email: item.email,
      displayName: item.displayName,
      accessLevel: sanitizeCollaboratorAccessLevel(item.accessLevel),
      addedAt: item.addedAt,
      owner: item.owner ?? false,
      inherited: item.inherited ?? false,
      inheritedFromId: item.inheritedFromId ?? null,
      inheritedFromTitle: item.inheritedFromTitle ?? null,
      inheritedAccessLevel: sanitizeNullableAccessLevel(item.inheritedAccessLevel),
      effectiveAccessLevel:
        item.effectiveAccessLevel === undefined
          ? undefined
          : sanitizeCollaboratorAccessLevel(item.effectiveAccessLevel, 'NO_ACCESS'),
    };
  }

  public async listCollaborators(documentId: string, accessToken: string): Promise<Collaborator[]> {
    const body = await this.fetchApi<ApiCollaborator[]>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators`,
      {
        method: 'GET',
        accessToken,
      }
    );

    return body.map((item) => this.toCollaborator(item));
  }

  /**
   * Collaborator mutations answer with the recalculated list, so a caller never
   * has to follow its own write with a list request to see rows that appeared or
   * vanished with it (an added grant can surface an inherited row; a removed
   * override can bring one back).
   */
  public async upsertCollaborator(
    documentId: string,
    payload: { email: string; accessLevel: DocumentAccessLevel },
    accessToken: string
  ): Promise<Collaborator[]> {
    const body = await this.fetchApi<ApiCollaborator[]>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators`,
      {
        method: 'POST',
        accessToken,
        body: JSON.stringify(payload),
      }
    );

    this.emitCloudDocumentsChanged();

    return body.map((item) => this.toCollaborator(item));
  }

  public async updateCollaboratorAccess(
    documentId: string,
    userId: string,
    accessLevel: CollaboratorAccessLevel,
    accessToken: string
  ): Promise<Collaborator[]> {
    const body = await this.fetchApi<ApiCollaborator[]>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators/${encodeURIComponent(userId)}`,
      {
        // PATCH, not PUT: the body updates one field and leaves the rest alone.
        method: 'PATCH',
        accessToken,
        body: JSON.stringify({ accessLevel }),
      }
    );

    this.emitCloudDocumentsChanged();

    return body.map((item) => this.toCollaborator(item));
  }

  public async removeCollaborator(
    documentId: string,
    userId: string,
    accessToken: string
  ): Promise<Collaborator[]> {
    const body = await this.fetchApi<ApiCollaborator[]>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        accessToken,
      }
    );

    this.emitCloudDocumentsChanged();

    return body.map((item) => this.toCollaborator(item));
  }

  public async leaveSharedDocument(documentId: string, accessToken: string): Promise<void> {
    await this.fetchApi<void>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators/me`,
      {
        method: 'DELETE',
        accessToken,
        allowEmptyData: true,
      }
    );

    this.emitCloudDocumentsChanged();
  }

  public async getSharingSettings(
    documentId: string,
    accessToken: string
  ): Promise<SharingSettings> {
    const body = await this.fetchApi<ApiSharingSettings>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/sharing`,
      {
        method: 'GET',
        accessToken,
      }
    );

    return {
      generalAccessMode: sanitizeGeneralAccessMode(body.generalAccessMode),
      linkAccessLevel: sanitizeDocumentAccessLevel(body.linkAccessLevel),
      hasActiveLink: body.hasActiveLink,
      inherited: body.inherited ?? false,
      inheritedFromId: body.inheritedFromId ?? null,
      inheritedFromTitle: body.inheritedFromTitle ?? null,
      linkInheritBlocked: body.linkInheritBlocked ?? false,
    };
  }

  public async updateSharingSettings(
    documentId: string,
    payload: {
      generalAccessMode: DocumentGeneralAccessMode;
      linkAccessLevel?: DocumentAccessLevel;
      linkInheritBlocked?: boolean;
    },
    accessToken: string
  ): Promise<SharingSettings> {
    const body = await this.fetchApi<ApiSharingSettings>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/sharing`,
      {
        method: 'PATCH',
        accessToken,
        body: JSON.stringify(payload),
      }
    );

    return {
      generalAccessMode: sanitizeGeneralAccessMode(body.generalAccessMode),
      linkAccessLevel: sanitizeDocumentAccessLevel(body.linkAccessLevel),
      hasActiveLink: body.hasActiveLink,
      inherited: body.inherited ?? false,
      inheritedFromId: body.inheritedFromId ?? null,
      inheritedFromTitle: body.inheritedFromTitle ?? null,
      linkInheritBlocked: body.linkInheritBlocked ?? false,
    };
  }

  public async createCloudDocument(
    accessToken: string,
    id: string,
    title = 'Untitled',
    ydoc?: Y.Doc,
    createdBy?: string | null,
    parentId?: string | null,
    prevSiblingId?: string | null,
    nextSiblingId?: string | null,
    spaceId?: string | null
  ): Promise<{ id: string; ydoc: Y.Doc; meta: DocumentMeta }> {
    const documentYDoc = ydoc ?? createYjsDoc();
    const payload = {
      id,
      title,
      yjsState: this.uint8ArrayToBase64(encodeYjsState(documentYDoc)),
      createdBy: createdBy ?? 'NextDocs User',
      parentId: parentId ?? null,
      prevSiblingId: prevSiblingId ?? null,
      nextSiblingId: nextSiblingId ?? null,
      spaceId: spaceId ?? null,
    };

    const body = await this.fetchApi<ApiDocument>('/api/v1/documents', {
      method: 'POST',
      accessToken,
      body: JSON.stringify(payload),
    });

    if (body.id !== id) {
      throw new Error(
        `createCloudDocument: server returned ID "${body.id}" for requested ID "${id}".`
      );
    }

    // Record the hierarchy the server accepted: a replay that retries at the
    // root must also forget the parent link the local copy still carries.
    this.cacheParentLinks([{ id: body.id, parentId: body.parentId ?? parentId ?? null }]);

    return {
      id: body.id,
      ydoc: documentYDoc,
      meta: this.toDocumentMeta(body),
    };
  }

  public async saveCloudDocument(
    id: string,
    ydoc: Y.Doc,
    meta: DocumentMeta,
    accessToken: string
  ): Promise<void> {
    await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      accessToken,
      body: JSON.stringify({
        title: meta.title,
        // Omitted (undefined) when the page has none: the API treats an absent
        // icon/cover as "leave unchanged", which is what a content save means.
        icon: meta.icon,
        cover: meta.cover,
        yjsState: this.uint8ArrayToBase64(encodeYjsState(ydoc)),
        createdBy: meta.createdBy,
      }),
    });
  }

  public async savePublicDocument(id: string, ydoc: Y.Doc, meta: DocumentMeta): Promise<void> {
    await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}/public`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: meta.title,
        yjsState: this.uint8ArrayToBase64(encodeYjsState(ydoc)),
      }),
    });
  }

  public async updateCloudMetadata(
    id: string,
    updates: Partial<DocumentMeta>,
    accessToken: string
  ): Promise<void> {
    // Defense-in-depth: never send a blank title. Blank titles fall back to
    // Untitled on the API; normalizing here keeps direct callers consistent
    // with useDocument.updateMeta.
    const title =
      updates.title !== undefined && updates.title.trim() === '' ? 'Untitled' : updates.title;
    await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      accessToken,
      body: JSON.stringify({
        title,
        createdBy: updates.createdBy,
      }),
    });
  }

  /**
   * Writes just the page icon and/or cover. They live in their own request
   * shape ({@link DocumentIconRequest} / {@link DocumentCoverRequest}) because
   * clearing needs an explicit null payload, which a `Partial<DocumentMeta>`
   * (where undefined already means "unchanged") cannot express.
   */
  public async updateCloudIconCover(
    id: string,
    patch: { icon?: IconRequestPayload; cover?: CoverRequestPayload },
    accessToken: string
  ): Promise<void> {
    await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      accessToken,
      body: JSON.stringify(patch),
    });
  }

  /** Guest-side twin of {@link updateCloudIconCover}; needs an edit-level share link. */
  public async updatePublicIconCover(
    id: string,
    patch: { icon?: IconRequestPayload; cover?: CoverRequestPayload }
  ): Promise<void> {
    await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}/public`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
  }

  public async updatePublicMetadata(id: string, updates: Partial<DocumentMeta>): Promise<void> {
    // Same blank-title guard as the cloud path: guest saves must not persist a
    // title the API would fall back to Untitled, or the guest's cache would
    // disagree with both the server and the reducer.
    const title =
      updates.title !== undefined && updates.title.trim() === '' ? 'Untitled' : updates.title;
    await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}/public`, {
      method: 'PATCH',
      body: JSON.stringify({
        title,
      }),
    });
  }

  public async moveCloudDocumentToTrash(id: string, accessToken: string): Promise<void> {
    await this.fetchApi<void>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      accessToken,
      allowEmptyData: true,
    });

    this.emitCloudDocumentsChanged();
  }

  public async restoreCloudDocumentFromTrash(id: string, accessToken: string): Promise<void> {
    await this.fetchApi<void>(`/api/v1/documents/${encodeURIComponent(id)}/restore`, {
      method: 'POST',
      accessToken,
      allowEmptyData: true,
    });

    try {
      if (await this.documentExists(id)) {
        await this.updateMetadata(id, { deletedAt: undefined, purgeAt: undefined });
      }
    } catch (err) {
      console.warn('Failed to update local metadata during restore:', err);
    }

    this.emitCloudDocumentsChanged();
  }

  public async deleteCloudDocumentPermanently(id: string, accessToken: string): Promise<void> {
    await this.fetchApi<void>(`/api/v1/documents/${encodeURIComponent(id)}?permanent=true`, {
      method: 'DELETE',
      accessToken,
      allowEmptyData: true,
    });

    this.emitCloudDocumentsChanged();
  }

  public emitLocalDocumentsChanged(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('local-documents-changed'));
    }
  }

  public emitCloudDocumentsChanged(): void {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('cloud-documents-changed'));
    }
  }

  public async updateMetadata(id: string, updates: Partial<DocumentMeta>): Promise<void> {
    try {
      const storedDoc = await indexedDBService.getDocument(id);

      if (!storedDoc) {
        throw new Error('Document not found');
      }

      const updatedMeta: DocumentMeta = {
        ...storedDoc.meta,
        ...updates,
        updatedAt: new Date().toISOString(),
      };

      await indexedDBService.saveDocument({
        ...storedDoc,
        meta: updatedMeta,
      });
    } catch (error) {
      console.error('Failed to update metadata:', error);
      throw error;
    }
  }

  private uint8ArrayToBase64(value: Uint8Array): string {
    let binary = '';
    const chunkSize = 0x8000;

    for (let i = 0; i < value.length; i += chunkSize) {
      const chunk = value.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    return btoa(binary);
  }

  private base64ToUint8Array(value: string): Uint8Array {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }

    return bytes;
  }

  /**
   * The API is the only source of hierarchy for cloud documents, while
   * IndexedDB stores no parent links. Remember the cloud relationships so an
   * offline reload can rebuild the sidebar tree instead of rooting every
   * cached subpage.
   */
  private cacheParentLinks(nodes: readonly { id: string; parentId?: string | null }[]): void {
    if (nodes.length === 0) {
      return;
    }

    setLocalDocumentParents(
      nodes.map((node) => ({ id: node.id, parentId: node.parentId ?? null }))
    );
  }

  private toDocumentMeta(doc: ApiDocument): DocumentMeta {
    return {
      title: doc.title || 'Untitled',
      // Sanitizers drop malformed values: an unrenderable icon must read as
      // "no icon" rather than reach an `<img src>` or a CSS mask URL.
      icon: sanitizeDocumentIcon(doc.icon),
      cover: sanitizeDocumentCover(doc.cover),
      createdBy: doc.createdBy ?? undefined,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
      deletedAt: doc.deletedAt ?? undefined,
      purgeAt: doc.purgeAt ?? undefined,
    };
  }

  private async fetchApi<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      accessToken?: string;
      body?: string;
      allowEmptyData: true;
    }
  ): Promise<T | undefined>;
  private async fetchApi<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      accessToken?: string;
      body?: string;
      allowEmptyData?: false | undefined;
    }
  ): Promise<T>;
  private async fetchApi<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
      accessToken?: string;
      body?: string;
      allowEmptyData?: boolean;
    }
  ): Promise<T | undefined> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (options.accessToken) {
      headers.Authorization = `Bearer ${options.accessToken}`;
    }

    const res = await fetch(`${getApiBaseUrl()}${path}`, {
      method: options.method,
      credentials: 'include',
      headers,
      body: options.body,
    });

    if (options.allowEmptyData && res.ok && res.status === 204) {
      return undefined;
    }

    const body = await parseApiEnvelope<T>(res);

    if (!res.ok || !body?.success || body.data == null) {
      throw new DocumentServiceApiError(
        body?.message || body?.error || `Request failed: ${options.method} ${path}`,
        res.status,
        parseRetryAfterMs(
          typeof res.headers?.get === 'function' ? res.headers.get('Retry-After') : null
        )
      );
    }

    return body.data;
  }

  /**
   * Coalesces concurrent identical GETs (React StrictMode double-mounts, two
   * hooks needing the same breadcrumbs/access check on one page open) into a
   * single network request. Only in-flight requests are shared — settled
   * results are never cached, so access revocation is always observed fresh.
   */
  private inflightGets = new Map<string, Promise<unknown>>();

  private dedupedGet<T>(key: string, run: () => Promise<T>): Promise<T> {
    const existing = this.inflightGets.get(key);
    if (existing) {
      return existing as Promise<T>;
    }
    const pending = run().finally(() => {
      if (this.inflightGets.get(key) === pending) {
        this.inflightGets.delete(key);
      }
    });
    this.inflightGets.set(key, pending);
    return pending;
  }
}

export const documentService = new DocumentService();
