'use client';

import '@blocknote/core/fonts/inter.css';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import '@blocknote/shadcn/style.css';
import { useParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useDocument } from '@/hooks/useDocument.hook';
import { useYjsPersistence } from '@/hooks/useYjsPersistence.hook';
import { useTheme } from '@/hooks/useTheme.hook';
import type { DocumentMeta } from '@/types/document.types';
import type * as Y from 'yjs';

export default function Editor() {
  const params = useParams();
  const documentId = (params?.id as string) || 'default-doc';
  const { ydoc, meta, isLoading, error, updateMeta } = useDocument(documentId);
  const [showLoading, setShowLoading] = useState(false);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isLoading) {
      timer = setTimeout(() => setShowLoading(true), 300);
    } else {
      timer = setTimeout(() => setShowLoading(false), 0);
    }
    return () => clearTimeout(timer);
  }, [documentId, isLoading]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-sm text-destructive">Failed to load document: {error.message}</div>
      </div>
    );
  }

  if (isLoading || !ydoc || !meta) {
    return (
      <div className="flex items-center justify-center h-full">
        {showLoading && (
          // TODO: Add a spinner/loading animation here instead of just text.
          // Maybe we can also change the placement of the loading indicator.
          <div className="text-sm text-muted-foreground animate-in fade-in duration-300">
            Loading document...
          </div>
        )}
      </div>
    );
  }

  return (
    <EditorContent
      key={documentId}
      documentId={documentId}
      ydoc={ydoc}
      meta={meta}
      updateMeta={updateMeta}
    />
  );
}

// We separate this component to ensure BlockNote editor is only created
// after the Yjs document is fully loaded from IndexedDB
function EditorContent({
  documentId,
  ydoc,
  meta,
  updateMeta,
}: {
  documentId: string;
  ydoc: Y.Doc;
  meta: DocumentMeta;
  updateMeta: (updates: Partial<DocumentMeta>) => void;
}) {
  useYjsPersistence(documentId, ydoc, meta);
  const { resolvedTheme } = useTheme();

  const editor = useCreateBlockNote({
    collaboration: {
      fragment: ydoc.getXmlFragment('blocknote'),
      user: {
        name: 'Local User',
        color: '#3b82f6',
      },
    },
  });

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const focusRequested = useRef(false);

  const [isEditorVisible, setIsEditorVisible] = useState(() => {
    const blocks = editor.document;
    const hasTitle = meta.title !== 'Untitled';
    const hasContent =
      blocks.length > 1 ||
      (blocks.length === 1 && Array.isArray(blocks[0].content) && blocks[0].content.length > 0);
    return hasTitle || hasContent;
  });

  useEffect(() => {
    // Check if the document has actual content after Yjs sync
    const blocks = editor.document;
    const hasContent =
      blocks.length > 1 ||
      (blocks.length === 1 && Array.isArray(blocks[0].content) && blocks[0].content.length > 0);

    // If it has content (e.g. from collab sync), ensure editor is visible
    if (hasContent) {
      setIsEditorVisible(true);
    }
  }, [editor.document]);

  useEffect(() => {
    if (isEditorVisible && focusRequested.current) {
      // Small delay to ensure the DOM is ready and BlockNote is initialized
      const timer = setTimeout(() => {
        editor.focus();
        focusRequested.current = false;
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [isEditorVisible, editor]);

  const adjustTextareaHeight = () => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    }
  };

  useEffect(() => {
    adjustTextareaHeight();
  }, [meta.title]);

  useEffect(() => {
    // Auto-focus the title input when the editor mounts
    // only if this is a new document (untitled)
    if (textareaRef.current && meta.title === 'Untitled') {
      textareaRef.current.focus();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Intentionally only run on mount to avoid stealing focus later

  const handleTitleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateMeta({ title: e.target.value });
    adjustTextareaHeight();
  };

  const handleTitleBlur = () => {
    // Normalize empty titles to 'Untitled' to maintain consistency
    if (!meta.title || meta.title.trim() === '') {
      updateMeta({ title: 'Untitled' });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!isEditorVisible) {
        setIsEditorVisible(true);
        focusRequested.current = true;
      } else {
        editor.focus();
      }
    }
  };

  return (
    <div className="flex flex-col w-full mt-12 md:mt-24">
      <div className="document-title-container group">
        <textarea
          ref={textareaRef}
          value={meta.title === 'Untitled' ? '' : meta.title}
          onChange={handleTitleChange}
          onBlur={handleTitleBlur}
          onKeyDown={handleKeyDown}
          placeholder="Untitled"
          className="document-title-input overflow-hidden"
          rows={1}
        />
      </div>
      {isEditorVisible && (
        <div className="animate-in fade-in duration-300">
          <BlockNoteView editor={editor} theme={resolvedTheme} shadCNComponents={{}} />
        </div>
      )}
    </div>
  );
}
