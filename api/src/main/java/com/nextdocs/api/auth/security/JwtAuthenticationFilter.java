package com.nextdocs.api.auth.security;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import io.jsonwebtoken.JwtException;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.WebAuthenticationDetailsSource;
import org.springframework.stereotype.Component;
import org.springframework.util.StringUtils;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Validates the JWT Bearer token on every request and populates the Spring
 * Security context with a {@link UserPrincipal} when the token is valid.
 *
 * <p>A token only authenticates while the caller is still an active workspace
 * member: removal deletes the membership and deactivates the account, and both are
 * re-read here on every request. A removed member's otherwise unexpired token stops
 * working on the next call instead of staying live until it expires, and document
 * endpoints are covered because the gate sits in front of every route.
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class JwtAuthenticationFilter extends OncePerRequestFilter {

    private final JwtTokenProvider jwtTokenProvider;
    private final WorkspaceMemberRepository memberRepository;

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
            throws ServletException, IOException {

        String token = extractBearerToken(request);

        if (StringUtils.hasText(token)) {
            try {
                UUID userId = jwtTokenProvider.extractUserId(token);

                // Only load the user if this request hasn't been authenticated yet
                if (SecurityContextHolder.getContext().getAuthentication() == null) {
                    memberRepository
                            .findByUserId(userId)
                            .map(WorkspaceMember::getUser)
                            .filter(User::isActive)
                            .ifPresent(user -> {
                                UserPrincipal principal = UserPrincipal.from(user);
                                var authentication = new UsernamePasswordAuthenticationToken(
                                        principal, null, principal.getAuthorities());
                                authentication.setDetails(new WebAuthenticationDetailsSource().buildDetails(request));
                                SecurityContextHolder.getContext().setAuthentication(authentication);
                            });
                }
            } catch (JwtException e) {
                // Token is malformed or expired — continue unauthenticated
                log.debug("JWT authentication failed: {}", e.getMessage());
            }
        }

        filterChain.doFilter(request, response);
    }

    private String extractBearerToken(HttpServletRequest request) {
        String header = request.getHeader("Authorization");
        if (StringUtils.hasText(header) && header.startsWith("Bearer ")) {
            return header.substring(7);
        }
        return null;
    }
}
