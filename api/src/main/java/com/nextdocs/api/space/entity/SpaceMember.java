package com.nextdocs.api.space.entity;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.UUID;
import lombok.*;
import org.hibernate.annotations.CreationTimestamp;
import org.hibernate.annotations.UpdateTimestamp;

/**
 * A user's standing in a space, carrying both content access and ownership.
 *
 * <p>The level reuses {@link DocumentAccessLevel} so one enum describes content access
 * everywhere: {@code OWNER} may administer the space and is the only level that may,
 * while {@code VIEW}/{@code COMMENT}/{@code EDIT} are the content grants a page inside
 * the space resolves. Removing somebody deletes the row; there is no NO_ACCESS row,
 * because a space is the outer end of its channel and has nothing above it to shadow.
 *
 * <p>The unique constraint on {@code (space_id, user_id)} is what makes a double invite
 * unable to create two memberships.
 */
@Entity
@Table(
        name = "space_members",
        uniqueConstraints =
                @UniqueConstraint(
                        name = "uq_space_member",
                        columnNames = {"space_id", "user_id"}),
        indexes = @Index(name = "idx_space_members_user", columnList = "user_id"))
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SpaceMember {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "space_id", nullable = false)
    private Space space;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Enumerated(EnumType.STRING)
    @Column(name = "access_level", nullable = false, length = 16)
    private DocumentAccessLevel accessLevel;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "granted_by_user_id")
    private User grantedBy;

    @CreationTimestamp
    @Column(name = "created_at", nullable = false, updatable = false)
    private OffsetDateTime createdAt;

    @UpdateTimestamp
    @Column(name = "updated_at", nullable = false)
    private OffsetDateTime updatedAt;
}
