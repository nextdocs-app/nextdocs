'use client';

import { useRef, useState } from 'react';
import { Close } from '@/icons';
import { PickerShell, PickerTabs } from '@/components/page/PickerShell';
import { PickerLinkForm } from '@/components/page/PickerLinkForm';
import { usePageImageUpload } from '@/hooks/usePageImageUpload.hook';
import { DEFAULT_COVER_POSITION, PAGE_IMAGE_ACCEPT, isHttpsUrl } from '@/lib/document-icon.util';
import type { DocumentCover } from '@/types/document.types';

type CoverTab = 'upload' | 'link';

export function CoverPickerPanel({
  documentId,
  accessToken,
  canUpload,
  panelRef,
  panelStyle,
  onSelect,
  onClose,
}: {
  documentId: string;
  accessToken: string | null;
  canUpload: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelStyle: React.CSSProperties;
  onSelect: (cover: DocumentCover) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<CoverTab>(canUpload ? 'upload' : 'link');
  // `tab` captures `canUpload` at mount; derive the effective tab so an
  // online→offline (or sign-out) flip cannot strand the panel on the upload
  // UI with no upload ability. Mount-online keeps the stored preference when
  // coming back; mount-offline starts on (and stays on) the link tab.
  const activeTab: CoverTab = canUpload ? tab : 'link';
  const [linkValue, setLinkValue] = useState('');
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { error, setError, isUploading, upload } = usePageImageUpload({
    documentId,
    accessToken,
  });

  const isValidLink = isHttpsUrl(linkValue.trim());

  const handleUpload = async (file: File) => {
    const attachment = await upload(file);
    if (attachment) {
      onSelect({ type: 'upload', value: attachment.id, position: DEFAULT_COVER_POSITION });
      onClose();
    }
  };

  const applyLink = () => {
    onSelect({ type: 'link', value: linkValue.trim(), position: DEFAULT_COVER_POSITION });
    onClose();
  };

  return (
    <PickerShell panelRef={panelRef} style={panelStyle} label="Choose a page cover">
      <div className="flex items-center justify-between gap-1 border-b border-border/70 dark:border-white/10 px-2 pt-2.5 pb-0 sm:px-3">
        <PickerTabs<CoverTab>
          tabs={
            canUpload
              ? [
                  { id: 'upload', label: 'Upload' },
                  { id: 'link', label: 'Link' },
                ]
              : [{ id: 'link', label: 'Link' }]
          }
          activeTab={activeTab}
          onSelect={(next) => {
            setTab(next);
            setError(null);
          }}
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex-shrink-0 rounded-md p-1.5 text-muted-foreground/70 transition-colors hover:bg-sidebar-accent hover:text-card-foreground cursor-pointer"
        >
          <Close size={16} />
        </button>
      </div>

      {activeTab === 'upload' ? (
        <div className="px-2.5 py-3">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingOver(true);
            }}
            onDragLeave={() => setIsDraggingOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingOver(false);
              const file = event.dataTransfer.files?.[0];
              if (file) {
                void handleUpload(file);
              }
            }}
            className={`
              flex flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-6 text-center transition-colors
              ${
                isDraggingOver
                  ? 'border-[var(--nd-brand)] bg-[var(--nd-brand)]/10'
                  : 'border-border'
              }
            `}
          >
            <p className="text-[13px] text-muted-foreground">Drag an image here, or</p>
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {isUploading ? 'Uploading…' : 'Choose a file'}
            </button>
            <p className="text-[11.5px] text-muted-foreground">PNG, JPEG, GIF, WebP or AVIF</p>
          </div>
          {error && <p className="mt-2 text-[11.5px] text-destructive">{error}</p>}
        </div>
      ) : (
        <PickerLinkForm
          inputId="nd-page-cover-link"
          value={linkValue}
          placeholder="https://example.com/cover.jpg"
          submitLabel="Use image"
          isValid={isValidLink}
          onChange={(value) => {
            setLinkValue(value);
            setError(null);
          }}
          onSubmit={applyLink}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept={PAGE_IMAGE_ACCEPT}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) {
            void handleUpload(file);
          }
        }}
      />
    </PickerShell>
  );
}
