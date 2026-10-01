package com.nextdocs.api.auth.security;

import com.nextdocs.api.common.response.ApiResponse;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import tools.jackson.databind.ObjectMapper;

@Configuration
@EnableWebSecurity
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtAuthenticationFilter jwtAuthenticationFilter;
    private final ObjectMapper objectMapper;

    @Value("${app.cors.allowed-origins}")
    private String allowedOrigins;

    /** Public endpoints that do not require a JWT. */
    private static final String[] PUBLIC_PATHS = {
        "/api/v1/auth/register",
        "/api/v1/auth/login",
        "/api/v1/auth/refresh",
        "/api/v1/documents/*/public",
        "/api/v1/documents/*/public/path",
        // OpenAPI / Swagger UI
        "/v3/api-docs/**",
        "/swagger-ui/**",
        "/swagger-ui.html",
        // Health check
        "/actuator/health"
    };

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
        return http
                // Stateless API — no CSRF needed; CSRF is a browser-session attack
                .csrf(AbstractHttpConfigurer::disable)
                .cors(cors -> cors.configurationSource(corsConfigurationSource()))
                .sessionManagement(sm -> sm.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .authorizeHttpRequests(auth -> auth.requestMatchers(PUBLIC_PATHS)
                        .permitAll()
                        .anyRequest()
                        .authenticated())
                // Return structured JSON on auth failures instead of Spring's HTML defaults
                .exceptionHandling(ex -> ex.authenticationEntryPoint(
                                (req, res, e) -> writeError(res, 401, "Authentication required."))
                        .accessDeniedHandler((req, res, e) -> writeError(res, 403, "Access denied.")))
                .addFilterBefore(jwtAuthenticationFilter, UsernamePasswordAuthenticationFilter.class)
                .build();
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // BCrypt with work factor 12; increase to 13-14 on hardware upgrade
        return new BCryptPasswordEncoder(12);
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        List<String> allowedOriginPatterns = List.of(allowedOrigins.split(",")).stream()
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .collect(Collectors.toList());

        Set<String> exactOrigins = new HashSet<>();
        List<Pattern> wildcardPatterns = new ArrayList<>();

        for (String pattern : allowedOriginPatterns) {
            if (!pattern.contains("*") || pattern.equals("*")) {
                exactOrigins.add(pattern);
            } else {
                wildcardPatterns.add(compileOriginPattern(pattern));
            }
        }

        CorsConfiguration config = new CorsConfiguration() {
            @Override
            public String checkOrigin(String requestOrigin) {
                if (requestOrigin == null) {
                    return null;
                }
                if (exactOrigins.contains(requestOrigin)) {
                    return requestOrigin;
                }
                for (Pattern pattern : wildcardPatterns) {
                    if (pattern.matcher(requestOrigin).matches()) {
                        return requestOrigin;
                    }
                }
                return null;
            }
        };
        config.setAllowedOriginPatterns(allowedOriginPatterns);
        config.setAllowedMethods(List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Requested-With"));
        config.setExposedHeaders(List.of("Authorization"));
        config.setAllowCredentials(true); // required for HTTP-only cookie refresh token
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", config);
        return source;
    }

    private static Pattern compileOriginPattern(String pattern) {
        boolean isIpPattern = pattern.matches(
                "^https?://(?:\\d{1,3}|\\*)\\.(?:\\d{1,3}|\\*)\\.(?:\\d{1,3}|\\*)\\.(?:\\d{1,3}|\\*)(?::\\d+)?$");
        if (isIpPattern) {
            String octetRegex = "(?:25[0-5]|2[0-4][0-9]|1[0-9]{2}|[1-9]?[0-9])";
            String[] parts = pattern.split("\\*", -1);
            StringBuilder sb = new StringBuilder("^");
            for (int i = 0; i < parts.length; i++) {
                sb.append(Pattern.quote(parts[i]));
                if (i < parts.length - 1) {
                    sb.append(octetRegex);
                }
            }
            sb.append("$");
            return Pattern.compile(sb.toString());
        }
        String[] parts = pattern.split("\\*", -1);
        StringBuilder sb = new StringBuilder("^");
        for (int i = 0; i < parts.length; i++) {
            sb.append(Pattern.quote(parts[i]));
            if (i < parts.length - 1) {
                sb.append("[^.:/]+");
            }
        }
        sb.append("$");
        return Pattern.compile(sb.toString());
    }

    private void writeError(HttpServletResponse response, int status, String message) throws IOException {
        response.setStatus(status);
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(message)));
    }
}
