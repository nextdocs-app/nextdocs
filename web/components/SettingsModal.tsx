/*
  TODO:
  This component design is temporary and need to do significant refactor in the future
  because currently it is tightly coupled with the theme setting and not scalable 
  for other settings sections. The main goal of doing this is to provide a quick way 
  to test with different themes when integrating features.
*/
'use client';

import { useEffect, useRef } from 'react';
import { useTheme, type Theme } from '@/hooks/useTheme.hook';

interface SettingsModalProps {
  onClose: () => void;
}

const themeOptions: { value: Theme; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function ThemePreview({ variant }: { variant: Theme }) {
  if (variant === 'system') {
    return (
      <div className="w-full h-[72px] rounded-lg overflow-hidden border border-black/10 flex">
        <div className="w-1/2 bg-[#f5f5f5] flex">
          <div className="w-[18px] bg-[#ebebeb] flex flex-col gap-1 p-1 pt-1.5 flex-shrink-0">
            <div className="h-1 rounded-full bg-[#d0d0d0]" />
            <div className="h-1 rounded-full bg-[#d0d0d0]" />
            <div className="h-1 rounded-full bg-[#d0d0d0]" />
          </div>
          <div className="flex-1 flex flex-col gap-1 p-1.5">
            <div className="h-1.5 w-3/4 rounded-full bg-[#d0d0d0]" />
            <div className="h-1 w-full rounded-full bg-[#e8e8e8]" />
            <div className="h-1 w-5/6 rounded-full bg-[#e8e8e8]" />
          </div>
        </div>
        <div className="w-1/2 bg-[#1f1f1f] flex">
          <div className="w-[18px] bg-[#181818] flex flex-col gap-1 p-1 pt-1.5 flex-shrink-0">
            <div className="h-1 rounded-full bg-white/20" />
            <div className="h-1 rounded-full bg-white/20" />
            <div className="h-1 rounded-full bg-white/20" />
          </div>
          <div className="flex-1 flex flex-col gap-1 p-1.5">
            <div className="h-1.5 w-3/4 rounded-full bg-white/25" />
            <div className="h-1 w-full rounded-full bg-white/10" />
            <div className="h-1 w-5/6 rounded-full bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  const isDark = variant === 'dark';
  return (
    <div
      className={`w-full h-[72px] rounded-lg overflow-hidden border flex ${
        isDark ? 'bg-[#1f1f1f] border-white/10' : 'bg-[#f5f5f5] border-black/10'
      }`}
    >
      <div
        className={`w-[22px] flex flex-col gap-1 p-1 pt-1.5 flex-shrink-0 ${
          isDark ? 'bg-[#181818]' : 'bg-[#ebebeb]'
        }`}
      >
        <div className={`h-1 rounded-full ${isDark ? 'bg-white/20' : 'bg-[#d0d0d0]'}`} />
        <div className={`h-1 rounded-full ${isDark ? 'bg-white/20' : 'bg-[#d0d0d0]'}`} />
        <div className={`h-1 rounded-full ${isDark ? 'bg-white/20' : 'bg-[#d0d0d0]'}`} />
      </div>
      <div className="flex-1 flex flex-col gap-1.5 p-2">
        <div className={`h-2 w-2/3 rounded-full ${isDark ? 'bg-white/25' : 'bg-[#c8c8c8]'}`} />
        <div className={`h-1 w-full rounded-full ${isDark ? 'bg-white/10' : 'bg-[#e0e0e0]'}`} />
        <div className={`h-1 w-5/6 rounded-full ${isDark ? 'bg-white/10' : 'bg-[#e0e0e0]'}`} />
        <div className={`h-1 w-4/6 rounded-full ${isDark ? 'bg-white/10' : 'bg-[#e0e0e0]'}`} />
      </div>
    </div>
  );
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { theme, setTheme } = useTheme();
  const modalRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;

    const modalElement = modalRef.current;
    const getFocusableElements = () => {
      if (!modalElement) return [] as HTMLElement[];
      const focusableSelector =
        'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
      return Array.from(modalElement.querySelectorAll<HTMLElement>(focusableSelector)).filter(
        (element) =>
          !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true'
      );
    };

    const focusTarget = closeButtonRef.current ?? getFocusableElements()[0] ?? modalElement;
    focusTarget?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();

      if (e.key !== 'Tab') return;

      const focusableElements = getFocusableElements();
      if (focusableElements.length === 0) {
        e.preventDefault();
        modalElement?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const activeElement = document.activeElement as HTMLElement | null;

      if (e.shiftKey) {
        if (activeElement === firstElement || !modalElement?.contains(activeElement)) {
          e.preventDefault();
          lastElement.focus();
        }
        return;
      }

      if (activeElement === lastElement || !modalElement?.contains(activeElement)) {
        e.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocusedRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 will-change-transform"
      aria-modal="true"
      role="dialog"
      aria-label="Settings"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm will-change-transform"
        onClick={onClose}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        tabIndex={-1}
        className="relative z-10 flex w-full max-w-[660px] h-[440px] max-h-[calc(100vh-2rem)]
                   rounded-2xl border border-border bg-background shadow-2xl overflow-hidden"
      >
        {/* Left nav */}
        <nav className="w-48 flex-shrink-0 border-r border-border bg-sidebar flex flex-col">
          <div className="px-3 pt-4 pb-2">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-2 pb-1">
              Settings
            </p>
          </div>
          <div className="px-2 flex flex-col gap-0.5">
            <button
              className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-left text-[13px]
                         bg-sidebar-accent text-sidebar-foreground font-medium cursor-default"
            >
              General
            </button>
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-border flex-shrink-0">
            <h2 className="text-[15px] font-semibold text-foreground">General</h2>
            <button
              ref={closeButtonRef}
              onClick={onClose}
              className="flex items-center justify-center h-7 w-7 rounded-md text-muted-foreground
                         hover:bg-sidebar-accent hover:text-foreground transition-colors cursor-pointer"
              aria-label="Close settings"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-5">
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-4">
                Appearance
              </h3>
              <div className="flex gap-3">
                {themeOptions.map((option) => {
                  const isSelected = theme === option.value;
                  return (
                    <button
                      key={option.value}
                      onClick={() => setTheme(option.value)}
                      className={`flex-1 flex flex-col gap-2.5 p-2.5 rounded-xl border-2 cursor-pointer
                                  transition-all duration-150 text-left
                                  ${
                                    isSelected
                                      ? 'border-foreground/40 bg-sidebar-accent'
                                      : 'border-border hover:border-muted-foreground/40 hover:bg-sidebar-accent/40'
                                  }`}
                    >
                      <ThemePreview variant={option.value} />
                      <div className="flex items-center gap-1.5 px-0.5">
                        <span
                          className={`inline-flex h-4 w-4 flex-shrink-0 rounded-full border-2 items-center justify-center
                                      ${isSelected ? 'border-foreground/60' : 'border-muted-foreground/40'}`}
                        >
                          {isSelected && (
                            <span className="h-2 w-2 rounded-full bg-foreground/70 block" />
                          )}
                        </span>
                        <span
                          className={`text-[13px] font-medium ${
                            isSelected ? 'text-foreground' : 'text-muted-foreground'
                          }`}
                        >
                          {option.label}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
