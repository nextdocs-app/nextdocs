package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.entity.User;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.security.core.authority.SimpleGrantedAuthority;

class UserPrincipalTest {

    private User buildActiveUser() {
        User user = User.builder()
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$encodedPasswordHash")
                .build();
        user.setId(UUID.randomUUID());
        return user;
    }

    @Test
    void from_mapsUserFieldsCorrectly() {
        // Arrange
        UUID id = UUID.randomUUID();
        User user = buildActiveUser();
        user.setId(id);

        // Act
        UserPrincipal principal = UserPrincipal.from(user);

        // Assert
        assertThat(principal.getId()).isEqualTo(id);
        assertThat(principal.getEmail()).isEqualTo("alice@example.com");
        assertThat(principal.getPassword()).isEqualTo("$2a$12$encodedPasswordHash");
        assertThat(principal.isActive()).isTrue();
    }

    @Test
    void getUsername_returnsEmail() {
        // Arrange
        UserPrincipal principal = UserPrincipal.from(buildActiveUser());

        // Act & Assert
        assertThat(principal.getUsername()).isEqualTo("alice@example.com");
    }

    @Test
    void getPassword_returnsPasswordHash() {
        // Arrange
        UserPrincipal principal = UserPrincipal.from(buildActiveUser());

        // Act & Assert
        assertThat(principal.getPassword()).isEqualTo("$2a$12$encodedPasswordHash");
    }

    @Test
    void getAuthorities_containsRoleUser() {
        // Arrange
        UserPrincipal principal = UserPrincipal.from(buildActiveUser());

        // Act & Assert
        assertThat(principal.getAuthorities()).containsExactly(new SimpleGrantedAuthority("ROLE_USER"));
    }

    @Test
    void isEnabled_whenActiveTrue_returnsTrue() {
        // Arrange
        User user = buildActiveUser();
        user.setActive(true);

        // Act
        UserPrincipal principal = UserPrincipal.from(user);

        // Assert
        assertThat(principal.isEnabled()).isTrue();
    }

    @Test
    void isEnabled_whenActiveFalse_returnsFalse() {
        // Arrange
        User user = buildActiveUser();
        user.setActive(false);

        // Act
        UserPrincipal principal = UserPrincipal.from(user);

        // Assert
        assertThat(principal.isEnabled()).isFalse();
    }

    @Test
    void isAccountNonLocked_delegatesToActive() {
        // Arrange
        User activeUser = buildActiveUser();
        User inactiveUser = buildActiveUser();
        inactiveUser.setActive(false);

        // Act & Assert
        assertThat(UserPrincipal.from(activeUser).isAccountNonLocked()).isTrue();
        assertThat(UserPrincipal.from(inactiveUser).isAccountNonLocked()).isFalse();
    }

    @Test
    void isAccountNonExpired_alwaysTrue() {
        // Arrange
        UserPrincipal principal = UserPrincipal.from(buildActiveUser());

        // Act & Assert
        assertThat(principal.isAccountNonExpired()).isTrue();
    }

    @Test
    void isCredentialsNonExpired_alwaysTrue() {
        // Arrange
        UserPrincipal principal = UserPrincipal.from(buildActiveUser());

        // Act & Assert
        assertThat(principal.isCredentialsNonExpired()).isTrue();
    }
}
