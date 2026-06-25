import { useEffect, type RefObject } from 'react';

export function useCommentComposerPatch(
  commentsUiEnabled: boolean,
  sendIconTemplateRef: RefObject<HTMLSpanElement | null>
) {
  useEffect(() => {
    if (!commentsUiEnabled) {
      return;
    }

    const selector =
      '.nd-floating-composer .bn-comment-actions button, .bn-thread .bn-thread-composer .bn-comment-actions button';

    const normalizeComposerText = (value: string): string => {
      const lines = value
        .replace(/\r\n?/g, '\n')
        .replace(/\u00A0/g, ' ')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .split('\n')
        .map((line) => line.replace(/[ \t]+$/g, ''));

      while (lines.length > 0 && lines[0].trim().length === 0) {
        lines.shift();
      }
      while (lines.length > 0 && lines[lines.length - 1].trim().length === 0) {
        lines.pop();
      }

      if (lines.length > 0) {
        lines[0] = lines[0].replace(/^[ \t]+/g, '');
      }

      return lines.join('\n');
    };

    const getComposerRawText = (editorSurface: HTMLElement | null): string => {
      if (!editorSurface) {
        return '';
      }
      return (editorSurface.innerText || editorSurface.textContent || '').replace(/\r\n?/g, '\n');
    };

    const getComposerEditorSurface = (button: HTMLButtonElement): HTMLElement | null => {
      const composerRoot = button.closest<HTMLElement>(
        '.bn-thread-composer, .nd-floating-composer .bn-thread'
      );
      return composerRoot?.querySelector<HTMLElement>('.bn-comment-editor .bn-editor') ?? null;
    };

    const hasComposerContent = (button: HTMLButtonElement): boolean => {
      const editorSurface = getComposerEditorSurface(button);
      const rawText = getComposerRawText(editorSurface);
      const normalized = normalizeComposerText(rawText);
      return normalized.length > 0;
    };

    const syncComposerSendButtons = () => {
      document.querySelectorAll<HTMLButtonElement>(selector).forEach((button) => {
        button.setAttribute('data-nd-send-icon-only', 'true');

        if (!button.querySelector('.nd-comment-send-icon')) {
          const iconTemplate = sendIconTemplateRef.current?.querySelector('svg');
          if (iconTemplate) {
            const wrapper = document.createElement('span');
            wrapper.className = 'nd-comment-send-icon';
            wrapper.setAttribute('aria-hidden', 'true');
            wrapper.append(iconTemplate.cloneNode(true));
            button.replaceChildren(wrapper);
          }
        }

        if (button.dataset.ndNormalizeBound !== 'true') {
          button.dataset.ndNormalizeBound = 'true';
          button.addEventListener(
            'click',
            (event) => {
              if (button.dataset.ndNormalizeBypass === 'true') {
                button.dataset.ndNormalizeBypass = 'false';
                return;
              }

              const editorSurface = getComposerEditorSurface(button);
              if (!editorSurface) {
                return;
              }

              const rawText = getComposerRawText(editorSurface);
              const normalized = normalizeComposerText(rawText);

              if (normalized.length === 0) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }

              if (normalized !== rawText) {
                event.preventDefault();
                event.stopPropagation();
                editorSurface.textContent = normalized;
                editorSurface.dispatchEvent(new Event('input', { bubbles: true }));

                button.dataset.ndNormalizeBypass = 'true';
                queueMicrotask(() => {
                  button.click();
                });
              }
            },
            true
          );
        }

        const hasContent = hasComposerContent(button);
        const actionsWrapper = button.closest<HTMLElement>('.bn-comment-actions-wrapper');
        button.hidden = !hasContent;
        button.setAttribute('aria-hidden', String(!hasContent));
        if (actionsWrapper) {
          actionsWrapper.hidden = !hasContent;
        }
      });
    };

    let syncScheduled = false;
    const observer = new MutationObserver(() => {
      if (syncScheduled) return;
      syncScheduled = true;
      requestAnimationFrame(() => {
        syncScheduled = false;
        syncComposerSendButtons();
      });
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [commentsUiEnabled, sendIconTemplateRef]);
}
