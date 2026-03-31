import * as Y from 'yjs';
import { indexedDBService } from './indexed-db.service';
import {
  createYjsDoc,
  encodeYjsState,
  decodeYjsState,
  createDefaultDocumentMeta,
} from '@/lib/yjs.util';
import type { DocumentMeta, DocumentLoadResult, StoredDocument } from '@/types/document.types';

const CURRENT_SCHEMA_VERSION = 1;
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080';

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

interface BulkImportResponse {
  imported: {
    localId: string;
    documentId: string;
    title: string;
  }[];
}

interface ApiDocument {
  id: string;
  title: string;
  icon?: string | null;
  coverImage?: string | null;
  yjsState?: string | null;
  createdBy?: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  purgeAt?: string | null;
}

export type DocumentAccessLevel = 'VIEW' | 'COMMENT' | 'EDIT' | 'OWNER';
export type DocumentGeneralAccessMode = 'RESTRICTED' | 'ANYONE_WITH_LINK';

interface ApiDocumentAccess {
  documentId: string;
  allowed: boolean;
  accessLevel: DocumentAccessLevel | null;
  owner: boolean;
}

interface ApiCollaborator {
  userId: string;
  email: string;
  displayName: string;
  accessLevel: DocumentAccessLevel;
  addedAt: string;
}

interface ApiSharingSettings {
  generalAccessMode: DocumentGeneralAccessMode;
  linkAccessLevel: DocumentAccessLevel;
  hasActiveLink: boolean;
}

export interface CloudDocumentsPage {
  items: { id: string; meta: DocumentMeta }[];
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
}

export interface Collaborator {
  userId: string;
  email: string;
  displayName: string;
  accessLevel: DocumentAccessLevel;
  addedAt: string;
}

export interface SharingSettings {
  generalAccessMode: DocumentGeneralAccessMode;
  linkAccessLevel: DocumentAccessLevel;
  hasActiveLink: boolean;
}

export class DocumentServiceApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'DocumentServiceApiError';
    this.status = status;
  }
}

class DocumentService {
  public async loadDocument(id: string): Promise<DocumentLoadResult | null> {
    const storedDoc = await indexedDBService.getDocument(id);

    if (!storedDoc) {
      return null;
    }

    const ydoc = decodeYjsState(storedDoc.yjsState);

    return {
      ydoc,
      meta: storedDoc.meta,
    };
  }

  public async saveDocument(id: string, ydoc: Y.Doc, meta: DocumentMeta): Promise<void> {
    try {
      // We store Yjs state as binary for efficient sync and future backend compatibility
      const yjsState = encodeYjsState(ydoc);

      const updatedMeta: DocumentMeta = {
        ...meta,
        updatedAt: new Date().toISOString(),
      };

      await indexedDBService.saveDocument({
        id,
        meta: updatedMeta,
        yjsState,
        version: CURRENT_SCHEMA_VERSION,
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

  public async getOrCreateDocument(id: string, title?: string): Promise<DocumentLoadResult> {
    const existing = await this.loadDocument(id);

    if (existing) {
      return existing;
    }

    const { ydoc, meta } = await this.createDocument(title);
    await this.saveDocument(id, ydoc, meta);

    return { ydoc, meta };
  }

  public async getAllDocumentsMeta(): Promise<{ id: string; meta: DocumentMeta }[]> {
    try {
      const docs = await indexedDBService.getAllDocuments();
      return docs.map((doc) => ({ id: doc.id, meta: doc.meta }));
    } catch (error) {
      console.error('Failed to get all documents:', error);
      return [];
    }
  }

  public async listCloudDocuments(
    accessToken: string,
    page = 0,
    size = 20,
    options?: { trashed?: boolean }
  ): Promise<CloudDocumentsPage> {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
    });

    if (options?.trashed) {
      params.set('trashed', 'true');
    }

    const body = await this.fetchApi<ApiPage<ApiDocument>>(
      `/api/v1/documents?${params.toString()}`,
      {
        method: 'GET',
        accessToken,
      }
    );

    const items = body.content.map((doc) => ({ id: doc.id, meta: this.toDocumentMeta(doc) }));

    return {
      items,
      page: body.number,
      size: body.size,
      totalElements: body.totalElements,
      totalPages: body.totalPages,
      hasMore: !body.last,
    };
  }

  public async getCloudDocument(id: string, accessToken: string): Promise<DocumentLoadResult> {
    const body = await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      method: 'GET',
      accessToken,
    });

    const ydoc = body.yjsState
      ? decodeYjsState(this.base64ToUint8Array(body.yjsState))
      : createYjsDoc();

    return {
      ydoc,
      meta: this.toDocumentMeta(body),
    };
  }

  public async getPublicDocument(id: string): Promise<DocumentLoadResult> {
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
    };
  }

  public async listSharedDocuments(
    accessToken: string,
    page = 0,
    size = 20
  ): Promise<CloudDocumentsPage> {
    const params = new URLSearchParams({
      page: String(page),
      size: String(size),
    });

    const body = await this.fetchApi<ApiPage<ApiDocument>>(
      `/api/v1/documents/shared-with-me?${params.toString()}`,
      {
        method: 'GET',
        accessToken,
      }
    );

    const items = body.content.map((doc) => ({ id: doc.id, meta: this.toDocumentMeta(doc) }));

    return {
      items,
      page: body.number,
      size: body.size,
      totalElements: body.totalElements,
      totalPages: body.totalPages,
      hasMore: !body.last,
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

    return body.map((item) => ({
      userId: item.userId,
      email: item.email,
      displayName: item.displayName,
      accessLevel: item.accessLevel,
      addedAt: item.addedAt,
    }));
  }

  public async upsertCollaborator(
    documentId: string,
    payload: { email: string; accessLevel: DocumentAccessLevel },
    accessToken: string
  ): Promise<Collaborator> {
    const body = await this.fetchApi<ApiCollaborator>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators`,
      {
        method: 'POST',
        accessToken,
        body: JSON.stringify(payload),
      }
    );

    this.emitCloudDocumentsChanged();

    return {
      userId: body.userId,
      email: body.email,
      displayName: body.displayName,
      accessLevel: body.accessLevel,
      addedAt: body.addedAt,
    };
  }

  public async updateCollaboratorAccess(
    documentId: string,
    userId: string,
    accessLevel: DocumentAccessLevel,
    accessToken: string
  ): Promise<Collaborator> {
    const body = await this.fetchApi<ApiCollaborator>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators/${encodeURIComponent(userId)}`,
      {
        method: 'PATCH',
        accessToken,
        body: JSON.stringify({ accessLevel }),
      }
    );

    this.emitCloudDocumentsChanged();

    return {
      userId: body.userId,
      email: body.email,
      displayName: body.displayName,
      accessLevel: body.accessLevel,
      addedAt: body.addedAt,
    };
  }

  public async removeCollaborator(
    documentId: string,
    userId: string,
    accessToken: string
  ): Promise<void> {
    await this.fetchApi<void>(
      `/api/v1/documents/${encodeURIComponent(documentId)}/collaborators/${encodeURIComponent(userId)}`,
      {
        method: 'DELETE',
        accessToken,
        allowEmptyData: true,
      }
    );

    this.emitCloudDocumentsChanged();
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
    };
  }

  public async updateSharingSettings(
    documentId: string,
    payload: {
      generalAccessMode: DocumentGeneralAccessMode;
      linkAccessLevel?: DocumentAccessLevel;
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
    };
  }

  public async createCloudDocument(
    accessToken: string,
    title = 'Untitled',
    sourceLocalId?: string
  ): Promise<{ id: string; ydoc: Y.Doc; meta: DocumentMeta }> {
    const ydoc = createYjsDoc();
    const payload = {
      title,
      yjsState: this.uint8ArrayToBase64(encodeYjsState(ydoc)),
      icon: null,
      coverImage: null,
      createdBy: 'NextDocs User',
      sourceLocalId,
    };

    const body = await this.fetchApi<ApiDocument>('/api/v1/documents', {
      method: 'POST',
      accessToken,
      body: JSON.stringify(payload),
    });

    return {
      id: body.id,
      ydoc,
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

  public async updateCloudMetadata(
    id: string,
    updates: Partial<DocumentMeta>,
    accessToken: string
  ): Promise<void> {
    await this.fetchApi<ApiDocument>(`/api/v1/documents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      accessToken,
      body: JSON.stringify({
        title: updates.title,
        icon: updates.icon,
        coverImage: updates.coverImage,
        createdBy: updates.createdBy,
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

  public async bulkImportLocalDocuments(
    accessToken: string,
    docs: StoredDocument[]
  ): Promise<BulkImportResponse> {
    const payload = {
      docs: docs.map((doc) => ({
        localId: doc.id,
        title: doc.meta.title,
        icon: doc.meta.icon,
        coverImage: doc.meta.coverImage,
        yjsState: this.uint8ArrayToBase64(doc.yjsState),
        createdBy: doc.meta.createdBy,
      })),
    };

    const body = await this.fetchApi<BulkImportResponse>('/api/v1/documents/bulk-import', {
      method: 'POST',
      accessToken,
      body: JSON.stringify(payload),
    });

    this.emitCloudDocumentsChanged();

    return body;
  }

  public async deleteLocalDocumentsByIds(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => indexedDBService.deleteDocument(id)));
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
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      accessToken?: string;
      body?: string;
      allowEmptyData: true;
    }
  ): Promise<T | undefined>;
  private async fetchApi<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
      accessToken?: string;
      body?: string;
      allowEmptyData?: false | undefined;
    }
  ): Promise<T>;
  private async fetchApi<T>(
    path: string,
    options: {
      method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

    const res = await fetch(`${API_BASE}${path}`, {
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
        body?.error ?? `Request failed: ${options.method} ${path}`,
        res.status
      );
    }

    return body.data;
  }
}

export const documentService = new DocumentService();
