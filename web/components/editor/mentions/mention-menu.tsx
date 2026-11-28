import type { DefaultReactSuggestionItem } from '@blocknote/react';
import { mentionService } from '@/services/mention.service';
import { UserAvatar } from '@/components/UserAvatar';
import type { MentionConfig } from './MentionConfigContext';

type MentionInsert = { type: 'mention'; props: { userId: string; label: string } };

/**
 * A candidate row. The user id travels with the row so the list can key on it instead of
 * a display name or the filter position.
 */
export type MentionSuggestionItem = DefaultReactSuggestionItem & { userId: string };

/** The slice of the editor the mention menu needs, without pinning a schema. */
export type MentionEditor = {
  getTextCursorPosition(): { block: { type: string } };
  insertInlineContent(content: Array<MentionInsert | string>): void;
};

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** Suggestion menus do not belong inside code blocks. */
function isCodeBlockCursor(editor: MentionEditor): boolean {
  try {
    return editor.getTextCursorPosition().block.type === 'codeBlock';
  } catch {
    // The editor can be queried before its first render.
    return false;
  }
}

/**
 * Builds the `@` suggestion-menu items for one editor.
 *
 * The factory owns the abort controller so a fast typist never sees a stale
 * candidate list resolve over the current one. Every item inserts the stable user id
 * plus the display-name snapshot; the server is the only authority on who is callable.
 */
export function createMentionMenuItems(
  editor: MentionEditor,
  config: MentionConfig
): (query: string) => Promise<MentionSuggestionItem[]> {
  let controller: AbortController | null = null;

  return async (query) => {
    if (!config.enabled || isCodeBlockCursor(editor)) {
      return [];
    }

    const accessToken = config.getAccessToken();
    if (!accessToken) {
      return [];
    }

    controller?.abort();
    controller = new AbortController();

    try {
      const candidates = await mentionService.search(
        config.documentId,
        accessToken,
        query,
        controller.signal
      );

      return candidates.map((candidate) => ({
        userId: candidate.userId,
        title: candidate.displayName,
        // The second line matches the share popover: the person's email.
        subtext: candidate.email,
        group: 'People',
        icon: (
          <UserAvatar
            size="sm"
            seed={candidate.userId}
            name={candidate.displayName || candidate.email}
            src={candidate.avatarUrl}
          />
        ),
        onItemClick: () => {
          editor.insertInlineContent([
            {
              type: 'mention',
              props: { userId: candidate.userId, label: candidate.displayName },
            },
            ' ',
          ]);
        },
      }));
    } catch (error) {
      if (isAbortError(error)) {
        return [];
      }
      console.warn('Failed to load mention candidates:', error);
      return [];
    }
  };
}
