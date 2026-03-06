'use client';

import { useState, useEffect, useCallback } from 'react';
import { documentService } from '@/services/document.service';
import type { DocumentMeta } from '@/types/document.types';

export interface LocalDocumentEntry {
  id: string;
  meta: DocumentMeta;
}

export function useLocalDocuments() {
  const [documents, setDocuments] = useState<LocalDocumentEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      const docs = await documentService.getAllDocumentsMeta();

      // Sort by updatedAt descending so the most recently edited document appears first
      docs.sort(
        (a, b) => new Date(b.meta.updatedAt).getTime() - new Date(a.meta.updatedAt).getTime()
      );

      setDocuments(docs);
    } catch (error) {
      console.error('Failed to load local documents:', error);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh(true);
  }, [refresh]);

  useEffect(() => {
    const handleMetaUpdated = (event: CustomEvent<{ id: string; meta: DocumentMeta }>) => {
      setDocuments((prevDocs) => {
        const { id, meta } = event.detail;
        const exists = prevDocs.some((doc) => doc.id === id);

        let newDocs;
        if (exists) {
          newDocs = prevDocs.map((doc) => (doc.id === id ? { ...doc, meta } : doc));
        } else {
          newDocs = [{ id, meta }, ...prevDocs];
        }

        return newDocs.sort(
          (a, b) => new Date(b.meta.updatedAt).getTime() - new Date(a.meta.updatedAt).getTime()
        );
      });
    };

    window.addEventListener('document-meta-updated', handleMetaUpdated as EventListener);
    return () => {
      window.removeEventListener('document-meta-updated', handleMetaUpdated as EventListener);
    };
  }, []);

  return { documents, isLoading, refresh };
}
