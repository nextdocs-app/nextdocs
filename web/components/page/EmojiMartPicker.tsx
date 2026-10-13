'use client';

import type { EmojiMartData } from '@emoji-mart/data';
import React, { useCallback, useEffect, useRef, useState } from 'react';

// Singleton loader to avoid redundant downloads & parse overhead,
// modeled after BlockNote's internal Comments/EmojiMartPicker.
let emojiLoadingPromise:
  | Promise<{
      emojiMart: typeof import('emoji-mart');
      emojiData: EmojiMartData;
    }>
  | undefined;

async function loadEmojiMart() {
  if (emojiLoadingPromise) {
    return emojiLoadingPromise;
  }

  emojiLoadingPromise = (async () => {
    try {
      const [emojiMartModule, emojiDataModule] = await Promise.all([
        import('emoji-mart'),
        import('@emoji-mart/data'),
      ]);

      const emojiMart = 'default' in emojiMartModule ? emojiMartModule.default : emojiMartModule;
      const emojiData =
        'default' in emojiDataModule
          ? (emojiDataModule.default as EmojiMartData)
          : (emojiDataModule as EmojiMartData);

      await emojiMart.init({ data: emojiData });

      return { emojiMart, emojiData };
    } catch (err) {
      // A single network glitch must not brick the picker forever: drop the
      // rejected singleton so the next mount retries, like useIconCatalog does
      // by clearing its inflight request on failure.
      emojiLoadingPromise = undefined;
      throw err;
    }
  })();

  return emojiLoadingPromise;
}

/** Test hook: the module-level singleton must not leak between test files. */
export function resetEmojiMartLoader(): void {
  emojiLoadingPromise = undefined;
}

/**
 * Warms the emoji-mart singleton (module + 424KB dataset + init) without
 * mounting a picker. Call on hover/focus of the emoji tab so opening the tab
 * later feels instant; the load is shared with the mounted picker below.
 */
export function preloadEmojiMart(): void {
  void loadEmojiMart().catch((err: unknown) => {
    console.warn('Failed to preload the emoji picker:', err);
  });
}

export interface EmojiSelectPayload {
  id: string;
  name: string;
  native: string;
  unified?: string;
  keywords?: string[];
  shortcodes?: string;
  [key: string]: unknown;
}

export interface EmojiMartPickerProps {
  onEmojiSelect: (emoji: EmojiSelectPayload) => void;
  theme?: 'light' | 'dark' | 'auto';
  autoFocus?: boolean;
  perLine?: number;
  /** Fill the container width instead of a fixed perLine grid (see emoji-mart). */
  dynamicWidth?: boolean;
  previewPosition?: 'top' | 'bottom' | 'none';
  skinTonePosition?: 'preview' | 'search' | 'none';
  navPosition?: 'top' | 'bottom' | 'none';
  searchPosition?: 'sticky' | 'static' | 'none';
}

/**
 * The slice of emoji-mart's `Picker` this component drives, so the ref boundary is
 * explicit instead of `any`.
 */
interface EmojiMartInstance {
  update(props: Partial<EmojiMartPickerProps>): void;
}

export function EmojiMartPicker(props: EmojiMartPickerProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const instance = useRef<EmojiMartInstance | null>(null);

  const {
    onEmojiSelect,
    theme,
    autoFocus,
    perLine,
    dynamicWidth,
    previewPosition,
    skinTonePosition,
    navPosition,
    searchPosition,
  } = props;

  // Latest-callback ref so the mounted picker never calls a stale closure. Assigned
  // from an effect, not the render body: a ref must not be written while rendering,
  // and the picker only invokes the callback after paint, so the commit-late write
  // is never observable.
  const onEmojiSelectRef = useRef(onEmojiSelect);
  useEffect(() => {
    onEmojiSelectRef.current = onEmojiSelect;
  }, [onEmojiSelect]);

  // Push prop changes to the mounted instance from an effect, not the render
  // body: updating during render fires on every parent render (and twice in
  // StrictMode), while an effect on the stable primitives only runs when one
  // of them actually changes.
  useEffect(() => {
    instance.current?.update({
      theme,
      autoFocus,
      perLine,
      dynamicWidth,
      previewPosition,
      skinTonePosition,
      navPosition,
      searchPosition,
    });
  }, [
    theme,
    autoFocus,
    perLine,
    dynamicWidth,
    previewPosition,
    skinTonePosition,
    navPosition,
    searchPosition,
  ]);

  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  const retry = useCallback(() => {
    setError(null);
    setRetryKey((key) => key + 1);
  }, []);

  useEffect(() => {
    let unmounted = false;
    const container = ref.current;

    void (async () => {
      try {
        const { emojiMart } = await loadEmojiMart();
        if (unmounted || !container) return;

        instance.current = new emojiMart.Picker({
          theme,
          autoFocus,
          perLine,
          dynamicWidth,
          previewPosition,
          skinTonePosition,
          navPosition,
          searchPosition,
          onEmojiSelect: (emoji: EmojiSelectPayload) => onEmojiSelectRef.current(emoji),
          ref: { current: container },
        });
      } catch (err: unknown) {
        if (!unmounted) {
          console.warn('Failed to load the emoji picker:', err);
          setError(err instanceof Error ? err.message : 'Failed to load emoji.');
        }
      }
    })();

    return () => {
      unmounted = true;
      if (container) {
        container.innerHTML = '';
      }
      instance.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryKey]);

  if (error) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-1 py-6">
        <p className="text-center text-[12.5px] text-muted-foreground">
          Could not load the emoji set.
        </p>
        <button
          type="button"
          onClick={retry}
          className="rounded-md px-2 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-[var(--nd-toolbar-hover-bg)] hover:text-foreground cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  return <div ref={ref} className="w-full h-full flex flex-col items-center" />;
}
