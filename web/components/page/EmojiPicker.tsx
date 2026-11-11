'use client';

import { useEffect, useRef, useState } from 'react';
import { loadFrimousseData } from '@blocknote/core/emoji-data';
import { EmojiPicker as FrimousseEmojiPicker, type EmojiDataResolver } from 'frimousse';

/** The app ships English only, so the picker avoids loading another locale. */
export const EMOJI_PICKER_LOCALE = 'en';

/** The grid divides the viewport into this many equal cells. */
export const EMOJI_PICKER_COLUMNS = 10;

const SKIN_TONE_LABELS = {
  none: 'Default skin tone',
  light: 'Light skin tone',
  'medium-light': 'Medium light skin tone',
  medium: 'Medium skin tone',
  'medium-dark': 'Medium dark skin tone',
  dark: 'Dark skin tone',
} as const;

/**
 * Frimousse consumes the same emoji corpus BlockNote bundles for its own
 * picker. The dataset is a dynamic per-locale chunk, so opening the emoji tab
 * no longer parses a 424KB module up front.
 */
export const resolveEmojiData: EmojiDataResolver = async (locale, { signal } = {}) => {
  signal?.throwIfAborted();
  const data = await loadFrimousseData(locale);
  signal?.throwIfAborted();
  return data;
};

/** Warm the locale chunk on hover/focus so opening the tab feels instant. */
export function preloadEmojiPicker(locale = EMOJI_PICKER_LOCALE): void {
  void loadFrimousseData(locale).catch((error: unknown) => {
    console.warn('Failed to preload the emoji picker:', error);
  });
}

export interface EmojiPickerProps {
  onEmojiSelect: (emoji: string) => void;
  autoFocus?: boolean;
  locale?: string;
}

export function EmojiPicker({
  onEmojiSelect,
  autoFocus = false,
  locale = EMOJI_PICKER_LOCALE,
}: EmojiPickerProps) {
  const [isSkinToneOpen, setIsSkinToneOpen] = useState(false);
  const skinToneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isSkinToneOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!skinToneRef.current?.contains(event.target as Node)) {
        setIsSkinToneOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setIsSkinToneOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSkinToneOpen]);

  return (
    <FrimousseEmojiPicker.Root
      className="nd-emoji-picker"
      locale={locale}
      columns={EMOJI_PICKER_COLUMNS}
      resolveEmojiData={resolveEmojiData}
      style={{ '--nd-emoji-columns': EMOJI_PICKER_COLUMNS } as React.CSSProperties}
      onEmojiSelect={({ emoji }) => onEmojiSelect(emoji)}
    >
      <FrimousseEmojiPicker.Search
        className="nd-emoji-search"
        placeholder="Search emoji"
        aria-label="Search emoji"
        autoFocus={autoFocus}
      />
      <FrimousseEmojiPicker.Viewport className="nd-emoji-viewport">
        <FrimousseEmojiPicker.Loading className="nd-emoji-status">
          Loading emoji…
        </FrimousseEmojiPicker.Loading>
        <FrimousseEmojiPicker.Empty className="nd-emoji-status">
          No emoji found.
        </FrimousseEmojiPicker.Empty>
        <FrimousseEmojiPicker.List />
      </FrimousseEmojiPicker.Viewport>
      <div className="nd-emoji-footer">
        <FrimousseEmojiPicker.ActiveEmoji>
          {({ emoji }) => (
            <span className="nd-emoji-active">
              {emoji ? (
                <>
                  <span className="nd-emoji-active-glyph" aria-hidden>
                    {emoji.emoji}
                  </span>
                  <span className="nd-emoji-active-label">{emoji.label}</span>
                </>
              ) : (
                <span className="nd-emoji-active-label">Search or select an emoji…</span>
              )}
            </span>
          )}
        </FrimousseEmojiPicker.ActiveEmoji>
        <FrimousseEmojiPicker.SkinTone emoji="👋">
          {({ skinTone, setSkinTone, skinToneVariations }) => {
            const active = skinToneVariations.find((variation) => variation.skinTone === skinTone);
            return (
              <div ref={skinToneRef} className="nd-emoji-skin-tone">
                <button
                  type="button"
                  className="nd-emoji-skin-tone-trigger"
                  aria-label="Change skin tone"
                  aria-haspopup="true"
                  aria-expanded={isSkinToneOpen}
                  onClick={() => setIsSkinToneOpen((open) => !open)}
                >
                  {active?.emoji ?? '👋'}
                </button>
                {isSkinToneOpen ? (
                  <div className="nd-emoji-skin-tone-popover" role="group" aria-label="Skin tone">
                    {skinToneVariations.map(({ skinTone: tone, emoji }) => (
                      <button
                        key={tone}
                        type="button"
                        className="nd-emoji-skin-tone-option"
                        aria-label={SKIN_TONE_LABELS[tone]}
                        aria-pressed={tone === skinTone}
                        title={SKIN_TONE_LABELS[tone]}
                        onClick={() => {
                          setSkinTone(tone);
                          setIsSkinToneOpen(false);
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          }}
        </FrimousseEmojiPicker.SkinTone>
      </div>
    </FrimousseEmojiPicker.Root>
  );
}
