package com.nextdocs.api.workspace.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

/**
 * The singleton row that serializes bootstrap registration (created and seeded by V22).
 *
 * <p>An empty instance has no workspace row to lock, so the "does anyone exist yet"
 * check-then-insert cannot otherwise be serialized: two concurrent first registrations
 * would both bootstrap a workspace. Registration takes a pessimistic write lock on this
 * row and re-checks initialization under it. The row itself carries no state.
 */
@Entity
@Table(name = "instance_lock")
@Getter
@Setter
@NoArgsConstructor
public class InstanceLock {

    @Id
    @Column(nullable = false)
    private Short id;
}
