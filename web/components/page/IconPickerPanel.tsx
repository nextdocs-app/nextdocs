'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Close } from '@/icons';
import { useIconCatalog } from '@/hooks/useIconCatalog.hook';
import { useIconBundle } from '@/hooks/useIconBundle.hook';
import { useIconSearchPagination } from '@/hooks/useIconSearchPagination.hook';
import { usePageImageUpload } from '@/hooks/usePageImageUpload.hook';
import { useTheme } from '@/hooks/useTheme.hook';
import { IconCategoryMenu } from '@/components/page/IconCategoryMenu';
import { IconGridButton } from '@/components/page/IconGridButton';
import { IconColorMenu } from '@/components/page/IconColorMenu';
import { PickerLinkForm } from '@/components/page/PickerLinkForm';
import {
  PickerShell,
  PickerTabs,
  pickerInputClassName,
  pickerSectionHeaderClassName,
} from '@/components/page/PickerShell';
import { EmojiMartPicker, preloadEmojiMart } from '@/components/page/EmojiMartPicker';
import {
  PAGE_IMAGE_ACCEPT,
  isHttpsUrl,
  isIconColorId,
  type IconColorId,
} from '@/lib/document-icon.util';
import type { DocumentIcon } from '@/types/document.types';

/** Initial & incremental batch size for pagination on scroll. */
export const ICONS_PAGE_SIZE = 49;

type IconTab = 'emoji' | 'icons' | 'link';

export function IconPickerPanel({
  icon,
  documentId,
  accessToken,
  canUpload,
  panelRef,
  panelStyle,
  onSelect,
  onRemove,
  onClose,
}: {
  icon?: DocumentIcon;
  documentId: string;
  accessToken: string | null;
  canUpload: boolean;
  panelRef: React.RefObject<HTMLDivElement | null>;
  panelStyle: React.CSSProperties;
  onSelect: (icon: DocumentIcon) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  // Icons first: the emoji tab parses a 424KB dataset on open (~50-150ms
  // desktop, 300ms+ mobile), so it loads lazily on selection instead. Hovering
  // the tab row warms the singleton ahead of the click (see below).
  const [tab, setTab] = useState<IconTab>('icons');
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');
  const [linkValue, setLinkValue] = useState('');
  const [selectedColor, setSelectedColor] = useState<IconColorId>(() => {
    if (icon?.type === 'builtin' && icon.color && isIconColorId(icon.color)) {
      return icon.color;
    }
    return 'default';
  });
  const [prevIcon, setPrevIcon] = useState(icon);
  // Keep selectedColor in sync if the document's icon prop updates. Adjusted
  // during render (not in an effect) so the sync commits with the same render
  // instead of cascading a second one. A non-builtin icon resets to the
  // default, so a stale color cannot leak into the next glyph pick.
  if (prevIcon !== icon) {
    setPrevIcon(icon);
    if (icon?.type === 'builtin' && icon.color && isIconColorId(icon.color)) {
      setSelectedColor(icon.color);
    } else {
      setSelectedColor('default');
    }
  }
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const [isCategoryMenuOpen, setIsCategoryMenuOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const colorMenuRef = useRef<HTMLDivElement | null>(null);
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);

  const { resolvedTheme } = useTheme();
  const { names, categories, isLoading, error: catalogError } = useIconCatalog(tab === 'icons');
  // The grid waits for the bundle: rendering glyphs on per-icon URLs first
  // would fire a request waterfall the bundle exists to avoid. A bundle
  // failure still renders the grid on per-glyph URLs instead of bricking it.
  const { bundle, error: bundleError } = useIconBundle(tab === 'icons');
  const gridReady = !isLoading && !catalogError && (bundle !== null || bundleError !== null);
  const { upload, error, setError, isUploading } = usePageImageUpload({
    documentId,
    accessToken,
  });
  // A chosen category narrows the grid to that section; 'all' keeps every
  // section. Memoized so the pagination hook sees a stable reference and
  // does not reset its visible budget on every render.
  const visibleCategories = useMemo(
    () =>
      activeCategory === 'all'
        ? categories
        : categories.filter((category) => category.id === activeCategory),
    [categories, activeCategory]
  );
  const {
    matches: iconMatches,
    displayed: displayedIcons,
    hasMore: hasMoreIcons,
    sections: displayedSections,
    sentinelRef,
    isSentinelSupported,
    loadMore,
  } = useIconSearchPagination({
    names,
    categories: visibleCategories,
    query,
    resetKey: `${tab}:${activeCategory}`,
    pageSize: ICONS_PAGE_SIZE,
    scrollContainerRef,
    enabled: tab === 'icons',
  });

  // Close the dropdowns on click outside or Escape.
  useEffect(() => {
    if (!isColorMenuOpen && !isCategoryMenuOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (colorMenuRef.current && !colorMenuRef.current.contains(event.target as Node)) {
        setIsColorMenuOpen(false);
      }
      if (categoryMenuRef.current && !categoryMenuRef.current.contains(event.target as Node)) {
        setIsCategoryMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsColorMenuOpen(false);
        setIsCategoryMenuOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isColorMenuOpen, isCategoryMenuOpen]);

  const handleColorSelect = (nextColor: IconColorId) => {
    setSelectedColor(nextColor);
    setIsColorMenuOpen(false);
    if (icon?.type === 'builtin') {
      onSelect({
        type: 'builtin',
        value: icon.value,
        color: nextColor === 'default' ? undefined : nextColor,
      });
    }
  };

  const isValidLink = isHttpsUrl(linkValue.trim());

  // Stable so the memoized grid cells keep their identity across the panel's
  // own re-renders (typing, recolouring, revealing a page).
  const pick = useCallback(
    (next: DocumentIcon) => {
      onSelect(next);
      onClose();
    },
    [onSelect, onClose]
  );

  const renderGrid = (names: string[], className = 'grid grid-cols-9 gap-0.5') => (
    <div className={className}>
      {names.map((name) => (
        <IconGridButton
          key={name}
          name={name}
          svg={bundle?.get(name)}
          color={selectedColor}
          onPick={pick}
        />
      ))}
    </div>
  );

  const handleUpload = async (file: File) => {
    const attachment = await upload(file);
    if (attachment) {
      pick({ type: 'upload', value: attachment.id });
    }
  };

  const selectTab = (next: IconTab) => {
    setTab(next);
    setQuery('');
    setActiveCategory('all');
    setError(null);
    setIsColorMenuOpen(false);
    setIsCategoryMenuOpen(false);
  };

  return (
    <PickerShell panelRef={panelRef} style={panelStyle} label="Choose a page icon">
      <div
        className="flex items-center justify-between gap-1 border-b border-border/70 dark:border-white/10 px-2 pt-2.5 pb-0 sm:px-3"
        onMouseEnter={preloadEmojiMart}
        onFocus={preloadEmojiMart}
      >
        <PickerTabs<IconTab>
          tabs={[
            { id: 'emoji', label: 'Emoji' },
            { id: 'icons', label: 'Icons' },
            { id: 'link', label: 'Link' },
          ]}
          activeTab={tab}
          onSelect={selectTab}
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

      {tab === 'link' ? (
        <PickerLinkForm
          inputId="nd-page-icon-link"
          value={linkValue}
          placeholder="https://example.com/icon.png"
          submitLabel="Use image"
          isValid={isValidLink}
          onChange={(value) => {
            setLinkValue(value);
            setError(null);
          }}
          onSubmit={() => pick({ type: 'link', value: linkValue.trim() })}
        />
      ) : tab === 'icons' ? (
        <>
          <div className="relative z-20 flex items-center gap-1.5 px-2.5 pt-2.5">
            <input
              type="text"
              value={query}
              placeholder="Search icons"
              onChange={(event) => setQuery(event.target.value)}
              className={`min-w-0 flex-1 ${pickerInputClassName}`}
            />
            <IconColorMenu
              selectedColor={selectedColor}
              isOpen={isColorMenuOpen}
              menuRef={colorMenuRef}
              onToggle={() => {
                setIsColorMenuOpen((prev) => !prev);
                setIsCategoryMenuOpen(false);
              }}
              onSelect={handleColorSelect}
            />
          </div>

          {categories.length > 0 && (
            <div className="px-2.5 pt-2">
              <IconCategoryMenu
                categories={categories}
                activeCategory={activeCategory}
                isOpen={isCategoryMenuOpen}
                menuRef={categoryMenuRef}
                onToggle={() => {
                  setIsCategoryMenuOpen((prev) => !prev);
                  setIsColorMenuOpen(false);
                }}
                onSelect={(categoryId) => {
                  setActiveCategory(categoryId);
                  setIsCategoryMenuOpen(false);
                }}
              />
            </div>
          )}

          <div
            ref={scrollContainerRef}
            className="max-h-[360px] min-h-[132px] flex-1 overflow-y-auto px-2.5 pb-2"
          >
            {gridReady && displayedSections.length > 0
              ? displayedSections.map((section) => (
                  <section key={section.id} aria-label={section.label}>
                    {/* The air above a pinned label lives in `pt-3` *inside* this
                        band, never in the container: only what is in the band can
                        cover the strip glyphs would otherwise scroll through. */}
                    <h3
                      className={`sticky top-0 z-10 -mx-2.5 bg-card pb-[5px] pl-3 pr-2.5 pt-3 ${pickerSectionHeaderClassName}`}
                    >
                      {section.label}
                    </h3>
                    {renderGrid(section.icons)}
                  </section>
                ))
              : gridReady
                ? renderGrid(displayedIcons, 'grid grid-cols-9 gap-0.5 pt-2')
                : null}

            {gridReady &&
              hasMoreIcons &&
              (isSentinelSupported ? (
                // Silent marker, not a spinner: the reveal loop keeps the list
                // taller than the pane, so this strip normally sits below the
                // fold and the next page is already there by the time it is
                // scrolled to. Saying "loading" here would describe a request
                // that never happens — the catalog is already in memory.
                <div ref={sentinelRef} className="h-6" aria-hidden />
              ) : (
                // No IntersectionObserver: hand the reader the control rather
                // than stranding the rest of the catalog behind nothing.
                <div className="flex justify-center py-2">
                  <button
                    type="button"
                    onClick={loadMore}
                    className="rounded-md px-2 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground cursor-pointer"
                  >
                    Show more icons
                  </button>
                </div>
              ))}

            {!gridReady && !catalogError && (
              <p className="px-1 py-6 text-center text-[12.5px] text-muted-foreground">
                Loading icons…
              </p>
            )}
            {catalogError && iconMatches.length === 0 && (
              <p className="px-1 py-6 text-center text-[12.5px] text-muted-foreground">
                Could not load the icon set.
              </p>
            )}
            {gridReady && iconMatches.length === 0 && (
              <p className="px-1 py-6 text-center text-[12.5px] text-muted-foreground">
                No icons match “{query}”.
              </p>
            )}
          </div>
        </>
      ) : (
        <div className="flex-1 overflow-hidden">
          <EmojiMartPicker
            onEmojiSelect={(emoji) => pick({ type: 'emoji', value: emoji.native })}
            theme={resolvedTheme}
            autoFocus
            perLine={10}
            dynamicWidth
            previewPosition="none"
            skinTonePosition="search"
          />
        </div>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border/70 dark:border-white/10 px-2.5 py-1.5">
        {icon ? (
          <button
            type="button"
            onClick={() => {
              onRemove();
              onClose();
            }}
            className="rounded-md px-1.5 py-1 text-[12.5px] text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-destructive cursor-pointer"
          >
            Remove
          </button>
        ) : (
          <span />
        )}

        <div className="flex min-w-0 items-center gap-2">
          {error && <span className="truncate text-[11.5px] text-destructive">{error}</span>}
          {canUpload && (
            <button
              type="button"
              disabled={isUploading}
              onClick={() => fileInputRef.current?.click()}
              className="rounded-md px-1.5 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
            >
              {isUploading ? 'Uploading…' : 'Upload image'}
            </button>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={PAGE_IMAGE_ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset so picking the same file twice still fires a change event.
            event.target.value = '';
            if (file) {
              void handleUpload(file);
            }
          }}
        />
      </div>
    </PickerShell>
  );
}
