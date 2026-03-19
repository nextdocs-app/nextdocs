package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@ExtendWith(MockitoExtension.class)
class JwtAuthenticationFilterTest {

    @Mock
    private JwtTokenProvider jwtTokenProvider;

    @Mock
    private UserRepository userRepository;

    private JwtAuthenticationFilter filter;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        filter = new JwtAuthenticationFilter(jwtTokenProvider, userRepository);
        mockMvc = MockMvcBuilders.standaloneSetup(new AuthCheckController())
                .addFilters(filter)
                .build();
    }

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void requestWithoutAuthorizationHeader_passesThrough_unauthenticated() throws Exception {
        mockMvc.perform(get("/check")).andExpect(status().isOk());
        assertNull(SecurityContextHolder.getContext().getAuthentication());
    }

    @Test
    void requestWithValidToken_populatesSecurityContext() throws Exception {
        UUID userId = UUID.randomUUID();
        User user = User.builder()
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("hash")
                .build();
        user.setId(userId);

        when(jwtTokenProvider.extractUserId("validtoken")).thenReturn(userId);
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));

        mockMvc.perform(get("/check").header("Authorization", "Bearer validtoken"))
                .andExpect(status().isOk());

        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        assertThat(auth).isNotNull();
        assertThat(auth.getName()).isEqualTo("alice@example.com");
    }

    @Test
    void requestWithInvalidToken_continuesUnauthenticated() throws Exception {
        when(jwtTokenProvider.extractUserId(any())).thenThrow(new io.jsonwebtoken.MalformedJwtException("bad"));

        mockMvc.perform(get("/check").header("Authorization", "Bearer badtoken"))
                .andExpect(status().isOk());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void requestForInactiveUser_doesNotPopulateSecurityContext() throws Exception {
        UUID userId = UUID.randomUUID();
        User inactiveUser = User.builder()
                .email("disabled@example.com")
                .displayName("Disabled")
                .passwordHash("hash")
                .build();
        inactiveUser.setId(userId);
        inactiveUser.setActive(false);

        when(jwtTokenProvider.extractUserId("validtoken")).thenReturn(userId);
        when(userRepository.findById(userId)).thenReturn(Optional.of(inactiveUser));

        mockMvc.perform(get("/check").header("Authorization", "Bearer validtoken"))
                .andExpect(status().isOk());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @Test
    void requestWithNonBearerHeader_passesThrough() throws Exception {
        mockMvc.perform(get("/check").header("Authorization", "Basic dXNlcjpwYXNz"))
                .andExpect(status().isOk());

        assertThat(SecurityContextHolder.getContext().getAuthentication()).isNull();
    }

    @RestController
    static class AuthCheckController {
        @GetMapping("/check")
        ResponseEntity<String> check() {
            Authentication auth = SecurityContextHolder.getContext().getAuthentication();
            return ResponseEntity.ok(auth != null ? auth.getName() : "anonymous");
        }
    }
}
