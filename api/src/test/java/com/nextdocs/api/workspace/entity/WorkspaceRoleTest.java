package com.nextdocs.api.workspace.entity;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;

class WorkspaceRoleTest {

    @Test
    void parse_parsesValidRoleCaseInsensitivelyAndTrimsWhitespace() {
        assertThat(WorkspaceRole.parse("owner")).isEqualTo(WorkspaceRole.OWNER);
        assertThat(WorkspaceRole.parse("ADMIN")).isEqualTo(WorkspaceRole.ADMIN);
        assertThat(WorkspaceRole.parse("  member  ")).isEqualTo(WorkspaceRole.MEMBER);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "  \t\n  "})
    void parse_throwsIllegalArgumentException_whenNullOrBlank(String raw) {
        assertThatThrownBy(() -> WorkspaceRole.parse(raw)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void parse_throwsIllegalArgumentException_whenUnknown() {
        assertThatThrownBy(() -> WorkspaceRole.parse("GUEST")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void canManageMembers_onlyTrueForOwnerAndAdmin() {
        assertThat(WorkspaceRole.OWNER.canManageMembers()).isTrue();
        assertThat(WorkspaceRole.ADMIN.canManageMembers()).isTrue();
        assertThat(WorkspaceRole.MEMBER.canManageMembers()).isFalse();
    }

    @Test
    void canGrant_checksPermissionsCorrectly() {
        assertThat(WorkspaceRole.OWNER.canGrant(WorkspaceRole.OWNER)).isTrue();
        assertThat(WorkspaceRole.OWNER.canGrant(WorkspaceRole.ADMIN)).isTrue();
        assertThat(WorkspaceRole.OWNER.canGrant(WorkspaceRole.MEMBER)).isTrue();

        assertThat(WorkspaceRole.ADMIN.canGrant(WorkspaceRole.OWNER)).isFalse();
        assertThat(WorkspaceRole.ADMIN.canGrant(WorkspaceRole.ADMIN)).isFalse();
        assertThat(WorkspaceRole.ADMIN.canGrant(WorkspaceRole.MEMBER)).isTrue();

        assertThat(WorkspaceRole.MEMBER.canGrant(WorkspaceRole.OWNER)).isFalse();
        assertThat(WorkspaceRole.MEMBER.canGrant(WorkspaceRole.ADMIN)).isFalse();
        assertThat(WorkspaceRole.MEMBER.canGrant(WorkspaceRole.MEMBER)).isTrue();
    }
}
