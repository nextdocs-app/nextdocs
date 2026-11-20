/** Wire shape for the document mention picker. */
export interface MentionCandidate {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
}
