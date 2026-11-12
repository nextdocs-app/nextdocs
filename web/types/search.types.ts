import type { DocumentIcon } from '@/types/document.types';

export interface SearchTextSegment {
  text: string;
  match: boolean;
}

export interface SearchBreadcrumb {
  id: string;
  title: string;
}

export interface SearchSpace {
  id: string;
  name: string;
}

export interface SearchHit {
  documentId: string;
  title: SearchTextSegment[];
  snippet: SearchTextSegment[];
  breadcrumb: SearchBreadcrumb[];
  space: SearchSpace | null;
  icon: DocumentIcon | null;
  updatedAt: string | null;
}

export interface SearchResponse {
  query: string;
  items: SearchHit[];
  hasMore: boolean;
  nextOffset: number;
}
