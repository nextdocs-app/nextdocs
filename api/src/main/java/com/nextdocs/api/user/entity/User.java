package com.nextdocs.api.user.entity;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.DynamicUpdate;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * The identity row: who somebody is, plus the credentials that prove it.
 *
 * <p>Everything every feature needs to name a person lives here — documents, comments,
 * workspaces and spaces all join this row — so the profile attributes are columns on it
 * rather than a one-to-one table, which would add a join to those queries and put the
 * two most public fields on a person behind the same lookup as their password.
 *
 * <p>The photo's bytes are not in the row: {@link #avatarId} points at storage, and an
 * account without an uploaded photo simply has no avatar. Profile editing is the only
 * writer, so the id doubles as the storage key, the cache-busting version and the ETag.
 */
@Entity
// Other transactions may have loaded this row before a concurrent profile change.
@DynamicUpdate
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @Column(nullable = false, unique = true, length = 255)
    private String email;

    @Column(name = "display_name", nullable = false, length = 255)
    private String displayName;

    @Column(name = "password_hash", nullable = false, length = 255)
    private String passwordHash;

    @Column(name = "is_active", nullable = false)
    @Builder.Default
    private boolean active = true;

    /**
     * Version of the uploaded photo, {@code null} when the account has none. It is three
     * things at once, which is why there is no digest column: the second half of the
     * storage key ({@code <userId>/<avatarId>}), the {@code ?v=} fingerprint that makes a
     * replacement a new URL, and the strong {@code ETag} that lets a cached copy
     * revalidate with a 304.
     */
    @Column(name = "avatar_id")
    private UUID avatarId;

    /** Sniffed MIME type of the uploaded photo, used as the response Content-Type. */
    @Column(name = "avatar_content_type", length = 64)
    private String avatarContentType;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;

    /**
     * The photo clients should render, or {@code null} for the generated initials.
     *
     * <p>Every response that names a person reads this getter, so the URL shape is
     * decided here once instead of at six call sites. It is host-independent, like the
     * attachment paths blocks store, and the web client resolves it against the API
     * origin. The version travels in the query string so the image itself can be cached
     * for as long as the browser likes: replacing the photo changes the URL.
     */
    public String getAvatarUrl() {
        return avatarId == null ? null : "/api/v1/users/" + id + "/avatar?v=" + avatarId;
    }
}
