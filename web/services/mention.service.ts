import { apiRequest } from '@/services/api-client';
import type { MentionCandidate } from '@/types/mention.types';

const DOCUMENTS_PATH = '/api/v1/documents';

function authHeaders(accessToken: string | null): Record<string, string> {
  return accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
}

/**
 * People who can be mentioned in one document, as the API resolves them.
 *
 * The server decides the candidate set from current access, so the picker never
 * offers someone the document cannot reach. The client sends only the query.
 */
export const mentionService = {
  search(
    documentId: string,
    accessToken: string | null,
    query: string,
    signal?: AbortSignal
  ): Promise<MentionCandidate[]> {
    // The menu shows everyone who can be mentioned, so it asks for the endpoint's
    // whole page rather than a short "most likely" slice.
    const params = new URLSearchParams({ limit: '50' });
    if (query.trim()) {
      params.set('q', query.trim());
    }

    return apiRequest<MentionCandidate[]>(
      `${DOCUMENTS_PATH}/${encodeURIComponent(documentId)}/mentionable-users?${params.toString()}`,
      {
        method: 'GET',
        headers: authHeaders(accessToken),
        signal,
      }
    );
  },
};
