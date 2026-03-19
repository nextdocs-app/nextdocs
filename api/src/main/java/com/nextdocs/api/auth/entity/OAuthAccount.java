package com.nextdocs.api.auth.entity;

import com.nextdocs.api.auth.entity.converter.OAuthTokenAttributeConverter;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * Represents a single OAuth provider connection for a user.
 *
 * The same user can have one row per provider (Google, GitHub, …). When OAuth
 * is implemented, the controller will upsert this record after the provider
 * callback, then either create a new {@link User} (first-ever login) or link to
 * an existing one by matching email (account linking).
 */
@Entity
@Table(
        name = "oauth_accounts",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uq_oauth_provider_user",
                        columnNames = {"provider", "provider_user_id"}))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class OAuthAccount {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    // We plan to provide google & github.
    @Column(nullable = false, length = 50)
    private String provider;

    // The user-id string as returned by the OAuth provider.
    @Column(name = "provider_user_id", nullable = false, length = 255)
    private String providerUserId;

    // Short-lived OAuth access token from the provider.
    @Convert(converter = OAuthTokenAttributeConverter.class)
    @Column(name = "access_token", columnDefinition = "TEXT")
    private String accessToken;

    // OAuth refresh token from the provider (if issued).
    @Convert(converter = OAuthTokenAttributeConverter.class)
    @Column(name = "refresh_token", columnDefinition = "TEXT")
    private String refreshToken;

    @Column(name = "token_expires_at")
    private OffsetDateTime tokenExpiresAt;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
