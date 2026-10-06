import * as Y from 'yjs';
import { indexedDBService } from './indexed-db.service';
import {
  createYjsDoc,
  encodeYjsState,
  decodeYjsState,
  createDefaultDocumentMeta,
} from '@/lib/yjs.util';
import type { DocumentMeta, DocumentLoadResult, StoredDocument } from '@/types/document.types';
import type { TreeNode, TreeNodePage, MoveDocumentRequest } from '@/types/tree.types';
import { getApiBaseUrl } from '@/lib/api-url.util';

const CURRENT_SCHEMA_VERSION = 1;

interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error: string | null;
  message?: string | null;
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

interface ApiDocument {
  id: string;
  title: string;
  icon?: string | null;
  coverImage?: string | null;
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

interface ApiDocumentAccess {
  documentId: string;
  allowed: boolean;
  accessLevel: DocumentAccessLevel | null;
  owner: boolean;
  trashed?: boolean;
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

export interface DocumentAccess {
  documentId: string;
  allowed: boolean;
  accessLevel: DocumentAccessLevel | null;
  owner: boolean;
  /** True when the document is in trash; accessLevel then reflects pre-trash access. */
  trashed?: boolean;
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

export interface DocumentBreadcrumbItem {
  id: string;
  title: string;
  icon?: string | null;
  parentId?: string | null;
  orderKey?: string | null;
  accessLevel?: DocumentAccessLevel | null;
  createdAt?: string | null;
  updatedAt?: string | null;
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
  const seconds = Number.parseInt(value.trim(), 10);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return undefined;
  }
  return seconds * 1000;
}

const MAX_SESSION_REGISTRY_SIZE = 500;

class DocumentService {
  private originByDocId = new Map<string, StoredDocument['origin']>();

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

  private normalizeCloudDocumentTitle(title: string | null | undefined): string {
    const value = title?.trim();
    return value ? value : 'Untitled';
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
      meta: storedDoc.meta,
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
    } catch (error) {
      console.error('Failed to delete document:', error);
      throw error;
    }
  }

  public async documentExists(id: string): Promise<boolean> {
    const doc = await indexedDBService.getDocument(id);
    return doc !== undefined;
  }

  public async getOrCreateDocument(
    id: string,
    title?: string,
    options?: { origin?: StoredDocument['origin'] }
  ): Promise<DocumentLoadResult> {
    const existing = await this.loadDocument(id);

    if (existing) {
      return existing;
    }

    const { ydoc, meta } = await this.createDocument(title);
    await this.saveDocument(
      id,
      ydoc,
      meta,
      options?.origin ? { origin: options.origin } : undefined
    );

    return { ydoc, meta, origin: options?.origin };
  }

  public async getAllDocumentsMeta(): Promise<
    { id: string; meta: DocumentMeta; origin?: StoredDocument['origin'] }[]
  > {
    try {
      const docs = await indexedDBService.getAllDocuments();
      // Share-link mirrors carry someone else's content: they live in the
      // guest Shared section (public endpoints), never in Private listings.
      // Records predating the origin tag have it undefined and count as local.
      return docs
        .filter((doc) => doc.origin !== 'public-link')
        .map((doc) => ({ id: doc.id, meta: doc.meta, origin: doc.origin }));
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
      scope?: 'all' | 'private' | 'shared';
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
      accessLevel: doc.accessLevel ?? null,
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

  public async listRootTreeNodes(accessToken: string, page = 0, size = 50): Promise<TreeNodePage> {
    const pageResult = await this.listCloudDocuments(accessToken, page, size, {
      parentId: 'root',
      scope: 'private',
    });

    return {
      items: pageResult.items.map((item) => ({
        id: item.id,
        title: item.meta.title,
        parentId: item.parentId,
        orderKey: item.orderKey ?? '',
        hasChildren: item.hasChildren ?? false,
        effectiveAccessLevel: item.accessLevel ?? 'OWNER',
        createdAt: item.meta.createdAt,
        updatedAt: item.meta.updatedAt,
      })),
      page: pageResult.page,
      size: pageResult.size,
      totalElements: pageResult.totalElements,
      totalPages: pageResult.totalPages,
      hasMore: pageResult.hasMore,
    };
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

    return {
      items: pageResult.items.map((item) => ({
        id: item.id,
        title: item.meta.title,
        parentId: item.parentId,
        orderKey: item.orderKey ?? '',
        hasChildren: item.hasChildren ?? false,
        effectiveAccessLevel: item.accessLevel ?? null,
        createdAt: item.meta.createdAt,
        updatedAt: item.meta.updatedAt,
      })),
      page: pageResult.page,
      size: pageResult.size,
      totalElements: pageResult.totalElements,
      totalPages: pageResult.totalPages,
      hasMore: pageResult.hasMore,
    };
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

    // We don't need to do emitCloudDocumentsChanged() here. Both tree slices
    // apply the server-returned node + orderKey in moveDocumentThunk.fulfilled,
    // so a global refetch is redundant.
    return {
      id: body.id,
      title: body.title,
      parentId: body.parentId ?? null,
      orderKey: body.orderKey ?? '',
      hasChildren: body.hasChildren ?? false,
      effectiveAccessLevel: body.accessLevel ?? null,
      createdAt: body.createdAt,
      updatedAt: body.updatedAt,
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
      };
    });
  }

  public async getDocumentBreadcrumbs(
    id: string,
    accessToken?: string | null
  ): Promise<DocumentBreadcrumbItem[]> {
    // Breadcrumb chain and guest sidebar need the same path concurrently.
    return this.dedupedGet(`breadcrumbs:${id}:${accessToken ? 'auth' : 'anon'}`, async () => {
      if (accessToken) {
        return await this.fetchApi<DocumentBreadcrumbItem[]>(
          `/api/v1/documents/${encodeURIComponent(id)}/path`,
          {
            method: 'GET',
            accessToken,
          }
        );
      } else {
        return await this.fetchApi<DocumentBreadcrumbItem[]>(
          `/api/v1/documents/${encodeURIComponent(id)}/public/path`,
          {
            method: 'GET',
          }
        );
      }
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
      accessLevel: body.accessLevel,
      owner: body.owner,
      trashed: body.trashed,
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
        accessLevel: body.accessLevel,
        owner: body.owner,
        trashed: body.trashed,
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
      effectiveAccessLevel: doc.accessLevel ?? 'VIEW',
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
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

  /** One collaborator row, from any endpoint that answers with collaborator rows. */
  private toCollaborator(item: ApiCollaborator): Collaborator {
    return {
      userId: item.userId,
      email: item.email,
      displayName: item.displayName,
      accessLevel: item.accessLevel,
      addedAt: item.addedAt,
      owner: item.owner ?? false,
      inherited: item.inherited ?? false,
      inheritedFromId: item.inheritedFromId ?? null,
      inheritedFromTitle: item.inheritedFromTitle ?? null,
      inheritedAccessLevel: item.inheritedAccessLevel ?? null,
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
        method: 'PUT',
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
      generalAccessMode: body.generalAccessMode,
      linkAccessLevel: body.linkAccessLevel,
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
      generalAccessMode: body.generalAccessMode,
      linkAccessLevel: body.linkAccessLevel,
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
    nextSiblingId?: string | null
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
        icon: meta.icon,
        coverImage: meta.coverImage,
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
        icon: updates.icon,
        coverImage: updates.coverImage,
        createdBy: updates.createdBy,
      }),
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

  public async getAllLocalDocuments(): Promise<StoredDocument[]> {
    return indexedDBService.getAllDocuments();
  }

  public async getAllGuestDocuments(): Promise<StoredDocument[]> {
    // Share-link mirrors must never be promoted: creating cloud copies of them
    // would clone someone else's shared content into the new account.
    const docs = await indexedDBService.getAllGuestDocuments();
    return docs.filter((doc) => doc.origin !== 'public-link');
  }

  public async promoteGuestDocumentsToAccount(
    accessToken: string,
    docs: StoredDocument[]
  ): Promise<string[]> {
    const promotedIds = await Promise.all(
      docs.map(async (doc) => {
        const created = await this.createCloudDocument(
          accessToken,
          doc.id,
          this.normalizeCloudDocumentTitle(doc.meta.title),
          decodeYjsState(doc.yjsState),
          doc.meta.createdBy ?? null
        );

        await this.saveDocument(doc.id, created.ydoc, created.meta, {
          touchUpdatedAt: false,
        });

        return doc.id;
      })
    );

    this.emitCloudDocumentsChanged();
    this.emitLocalDocumentsChanged();
    return promotedIds;
  }

  public async deleteLocalDocumentsByIds(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => indexedDBService.deleteDocument(id)));
    this.emitLocalDocumentsChanged();
  }

  public async deleteGuestDocumentsByIds(ids: string[]): Promise<void> {
    await indexedDBService.deleteGuestDocuments(ids);
    this.emitLocalDocumentsChanged();
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

  private toDocumentMeta(doc: ApiDocument): DocumentMeta {
    return {
      title: doc.title || 'Untitled',
      icon: doc.icon ?? undefined,
      coverImage: doc.coverImage ?? undefined,
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

    let body: ApiEnvelope<T> | null = null;
    try {
      body = (await res.json()) as ApiEnvelope<T>;
    } catch {
      body = null;
    }

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
