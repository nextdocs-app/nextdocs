'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useLocalDocuments } from '@/hooks/useLocalDocuments.hook';
import { documentService } from '@/services/document.service';
import { NewDocument, Search, ChevronRight, DocumentText } from '@/icons';

const emptySubscribe = () => () => {};

export default function Sidebar() {
  const router = useRouter();
  const params = useParams();
  const activeDocId = (params?.id as string) || 'default-doc';
  const { documents, isLoading, refresh } = useLocalDocuments();

  const [isPrivateOpen, setIsPrivateOpen] = useState(true);

  // Use useSyncExternalStore to safely detect if we are on the client
  // without triggering "cascading render" lint errors or hydration mismatches.
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const handleCreateFile = useCallback(async () => {
    try {
      const newId = crypto.randomUUID();
      const { ydoc, meta } = await documentService.createDocument();
      await documentService.saveDocument(newId, ydoc, meta);
      await refresh(false);
      router.push(`/doc/${newId}`);
    } catch (error) {
      console.error('Failed to create document:', error);
      // TODO: Replace alert with a non-blocking notification system (e.g., toast)
      alert('Failed to create document. Please try again.');
    }
  }, [router, refresh]);

  const handleSelectDocument = useCallback(
    (id: string) => {
      if (id === 'default-doc') {
        router.push('/');
      } else {
        router.push(`/doc/${id}`);
      }
    },
    [router]
  );

  if (!isClient) {
    return <aside className="w-60 border-r flex-shrink-0 bg-sidebar" />;
  }

  return (
    <aside className="w-60 border-r flex-shrink-0 flex flex-col bg-sidebar text-sidebar-foreground border-border select-none">
      {/* Top actions */}
      <div className="flex flex-col gap-0.5 px-2 pt-3 pb-1">
        {/* New Document */}
        <button
          onClick={handleCreateFile}
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                     text-sidebar-foreground hover:bg-sidebar-accent/100
                     transition-colors duration-100 cursor-pointer"
        >
          <NewDocument className="flex-shrink-0 opacity-80" />
          <span className="text-[14px]">New document</span>
        </button>

        {/* Search Documents (TODO: currently placeholder) */}
        <button
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-left
                     text-sidebar-foreground hover:bg-sidebar-accent/100
                     transition-colors duration-100 cursor-pointer"
        >
          <Search className="flex-shrink-0 opacity-80" />
          <span className="text-[14px]">Search documents</span>
        </button>
      </div>

      {/* Private section — collapsible */}
      <div className="group flex flex-col flex-1 min-h-0">
        <button
          onClick={() => setIsPrivateOpen((prev) => !prev)}
          aria-expanded={isPrivateOpen}
          className="flex items-center gap-1 px-4 py-2 text-left
                     text-[13px] text-muted-foreground cursor-pointer"
        >
          <span className="font-medium">Private</span>
          <ChevronRight
            className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all duration-200 ${isPrivateOpen ? 'rotate-90' : 'rotate-0'}`}
          />
        </button>

        {isPrivateOpen && (
          <nav className="flex-1 overflow-y-auto px-2 pb-2">
            {isLoading ? (
              <div className="flex flex-col gap-0.5 px-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-8 rounded-lg bg-sidebar-accent/30 animate-pulse" />
                ))}
              </div>
            ) : documents.length === 0 ? (
              <div className="px-3 pt-1">
                <p className="text-[13px] text-muted-foreground/50">No documents yet</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-px">
                {documents.map((doc) => {
                  const isActive = doc.id === activeDocId;
                  return (
                    <li key={doc.id}>
                      <button
                        onClick={() => handleSelectDocument(doc.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left
                          transition-colors duration-100 cursor-pointer
                          ${
                            isActive
                              ? 'bg-sidebar-accent/70 hover:bg-sidebar-accent/100 text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/100 hover:text-sidebar-foreground'
                          }`}
                      >
                        <DocumentText className="flex-shrink-0 opacity-50" />
                        <span className="text-[13px] truncate">{doc.meta.title || 'Untitled'}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </nav>
        )}
      </div>
    </aside>
  );
}
