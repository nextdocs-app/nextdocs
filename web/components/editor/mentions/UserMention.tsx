import { createReactInlineContentSpec } from '@blocknote/react';
import { MentionAvatar } from './MentionAvatar';

/**
 * BlockNote inline content for a user mention.
 *
 * `userId` is the stable identity the API uses for notifications and access checks.
 * `label` is a display-name snapshot so the mention still renders before any profile
 * lookup, offline, or after the account was removed. The snapshot is never treated as
 * the identity: every server-side mention extraction reads `userId` only.
 */
export const UserMention = createReactInlineContentSpec(
  {
    type: 'mention',
    propSchema: {
      userId: { default: '' },
      label: { default: '' },
    },
    content: 'none',
  } as const,
  {
    render: ({ inlineContent }) => {
      const { userId, label } = inlineContent.props;
      return (
        <span
          className="nd-mention inline-flex items-center gap-1 rounded px-1 py-0.5 align-middle text-[0.95em] font-medium text-primary bg-primary/10"
          data-nd-mention-user-id={userId}
          title={label ? `Mentioned ${label}` : 'Mentioned user'}
        >
          <MentionAvatar userId={userId} label={label} className="size-5" />@{label || 'Unknown'}
        </span>
      );
    },
    toExternalHTML: ({ inlineContent }) => (
      <span data-nd-mention={inlineContent.props.userId}>
        @{inlineContent.props.label || 'Unknown'}
      </span>
    ),
    parse: (element) => {
      if (element.tagName !== 'SPAN') {
        return undefined;
      }
      const userId = (
        element.getAttribute('data-nd-mention') ?? element.getAttribute('data-nd-mention-user-id')
      )?.trim();
      if (!userId) {
        return undefined;
      }
      return {
        userId,
        label: (element.textContent ?? '').replace(/^@/, '').trim(),
      };
    },
  }
);
