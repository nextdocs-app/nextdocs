import { buildInitialsAvatarDataUrl } from '@/lib/avatar.util';

/**
 * The avatar on a mention chip.
 *
 * A chip only carries the display-name snapshot, so this is always the generated
 * initials avatar: a mention in document content outlives a short-lived uploaded
 * avatar URL, which is exactly why no photo is copied into the content.
 */
export function MentionAvatar({
  userId,
  label,
  className = 'size-4',
}: {
  userId: string;
  label: string;
  className?: string;
}) {
  return (
    // A generated data URL cannot go through next/image, so a plain img is right here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={buildInitialsAvatarDataUrl(userId, label || userId)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={`${className} shrink-0 rounded-full object-cover`}
    />
  );
}
