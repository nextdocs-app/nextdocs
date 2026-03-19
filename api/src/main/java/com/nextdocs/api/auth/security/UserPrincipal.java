package com.nextdocs.api.auth.security;

import com.nextdocs.api.auth.entity.User;
import java.util.Collection;
import java.util.List;
import java.util.UUID;
import lombok.Getter;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

/**
 * Spring Security principal wrapping our {@link User} entity.
 *
 * For our application, we won't be requiring roles for the users, so every
 * authenticated user will have ROLE_USER. But we are definitely having role
 * for user in a document, which will be handled in the document service.
 */
public class UserPrincipal implements UserDetails {

    @Getter
    private final UUID id;

    @Getter
    private final String email;

    private final String passwordHash;

    @Getter
    private final boolean active;

    @Getter
    private final Collection<GrantedAuthority> authorities;

    private UserPrincipal(UUID id, String email, String passwordHash, boolean active) {
        this.id = id;
        this.email = email;
        this.passwordHash = passwordHash;
        this.active = active;
        this.authorities = List.of(new SimpleGrantedAuthority("ROLE_USER"));
    }

    public static UserPrincipal from(User user) {
        return new UserPrincipal(user.getId(), user.getEmail(), user.getPasswordHash(), user.isActive());
    }

    @Override
    public String getUsername() {
        return email;
    }

    @Override
    public String getPassword() {
        return passwordHash;
    }

    @Override
    public boolean isAccountNonExpired() {
        return true;
    }

    @Override
    public boolean isAccountNonLocked() {
        return active;
    }

    @Override
    public boolean isCredentialsNonExpired() {
        return true;
    }

    @Override
    public boolean isEnabled() {
        return active;
    }
}
