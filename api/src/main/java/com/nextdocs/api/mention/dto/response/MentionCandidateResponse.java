package com.nextdocs.api.mention.dto.response;

import java.util.UUID;

/**
 * One person the mention picker may offer. The display name and avatar are current at
 * read time; document content still stores its own display-name snapshot.
 *
 * <p>The email is the second line of the picker row, matching the collaborator roster.
 * Both surfaces sit behind the same identity roster gate, so neither can be used to
 * enumerate a workspace the caller is only visiting through a link.
 */
public record MentionCandidateResponse(UUID userId, String email, String displayName, String avatarUrl) {}
