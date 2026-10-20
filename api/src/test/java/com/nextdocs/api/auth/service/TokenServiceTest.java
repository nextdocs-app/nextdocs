package com.nextdocs.api.auth.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

import com.nextdocs.api.auth.entity.RefreshToken;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.security.ClientIpResolver;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import jakarta.servlet.http.Cookie;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class TokenServiceTest {

    private static final long REFRESH_EXPIRY_MS = 604_800_000L; // 7 days

    @Mock
    private RefreshTokenRepository refreshTokenRepository;

    @Mock
    private RefreshTokenRevoker refreshTokenRevoker;

    @Mock
    private ClientIpResolver clientIpResolver;

    @InjectMocks
    private TokenService tokenService;

    private MockHttpServletRequest mockRequest;
    private MockHttpServletResponse mockResponse;
    private User testUser;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(tokenService, "refreshTokenExpiryMs", REFRESH_EXPIRY_MS);
        ReflectionTestUtils.setField(tokenService, "cookieSecure", false);
        ReflectionTestUtils.setField(tokenService, "cookieDomain", "");

        // Not every refresh-token test cares about IP capture.
        lenient().when(clientIpResolver.resolve(any())).thenReturn("203.0.113.5");

        mockRequest = new MockHttpServletRequest();
        mockResponse = new MockHttpServletResponse();

        testUser = User.builder()
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$hash")
                .build();
        testUser.setId(UUID.randomUUID());
    }

    @Test
    void issueRefreshToken_savesEntityWithHashAndSetsSetCookieHeader() {
        when(refreshTokenRepository.save(any(RefreshToken.class))).thenAnswer(inv -> inv.getArgument(0));

        tokenService.issueRefreshToken(testUser, mockRequest, mockResponse);

        ArgumentCaptor<RefreshToken> captor = ArgumentCaptor.forClass(RefreshToken.class);
        verify(refreshTokenRepository).save(captor.capture());
        RefreshToken saved = captor.getValue();

        assertThat(saved.getTokenHash()).isNotBlank().hasSize(64); // SHA-256 hex
        assertThat(saved.getUser()).isEqualTo(testUser);
        assertThat(saved.getExpiresAt()).isAfter(OffsetDateTime.now());

        String setCookie = mockResponse.getHeader("Set-Cookie");
        assertThat(setCookie).contains("rt=");
        assertThat(setCookie).contains("HttpOnly");
        assertThat(setCookie).contains("SameSite=Strict");
        assertThat(setCookie).contains("Path=/api/v1/auth/");
    }

    @Test
    void issueRefreshToken_setsSecureFlag_whenCookieSecureIsTrue() {
        ReflectionTestUtils.setField(tokenService, "cookieSecure", true);
        when(refreshTokenRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        tokenService.issueRefreshToken(testUser, mockRequest, mockResponse);

        assertThat(mockResponse.getHeader("Set-Cookie")).contains("; Secure");
    }

    @Test
    void issueRefreshToken_includesDomain_whenCookieDomainIsSet() {
        ReflectionTestUtils.setField(tokenService, "cookieDomain", "example.com");
        when(refreshTokenRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        tokenService.issueRefreshToken(testUser, mockRequest, mockResponse);

        assertThat(mockResponse.getHeader("Set-Cookie")).contains("Domain=example.com");
    }

    @Test
    void issueRefreshToken_storesTheResolvedClientAddress() {
        when(refreshTokenRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        tokenService.issueRefreshToken(testUser, mockRequest, mockResponse);

        ArgumentCaptor<RefreshToken> captor = ArgumentCaptor.forClass(RefreshToken.class);
        verify(refreshTokenRepository).save(captor.capture());
        assertThat(captor.getValue().getIpAddress().getHostAddress()).isEqualTo("203.0.113.5");
    }

    @Test
    void issueRefreshToken_leavesIpAddressNull_whenNoIpLiteralResolves() {
        when(clientIpResolver.resolve(any())).thenReturn("");
        when(refreshTokenRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        tokenService.issueRefreshToken(testUser, mockRequest, mockResponse);

        ArgumentCaptor<RefreshToken> captor = ArgumentCaptor.forClass(RefreshToken.class);
        verify(refreshTokenRepository).save(captor.capture());
        assertThat(captor.getValue().getIpAddress()).isNull();
    }

    @Test
    void rotateRefreshToken_throwsInvalid_whenCookieMissing() {
        // No cookie set on mockRequest

        assertThatThrownBy(() -> tokenService.rotateRefreshToken(mockRequest, mockResponse))
                .isInstanceOf(ApiException.class)
                .satisfies(ex ->
                        assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.REFRESH_TOKEN_INVALID));
    }

    @Test
    void rotateRefreshToken_throwsInvalid_whenTokenHashNotFound() {
        mockRequest.setCookies(new Cookie("rt", "unknownrawtoken"));
        when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.empty());

        assertThatThrownBy(() -> tokenService.rotateRefreshToken(mockRequest, mockResponse))
                .isInstanceOf(ApiException.class)
                .satisfies(ex ->
                        assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.REFRESH_TOKEN_INVALID));
    }

    @Test
    void rotateRefreshToken_revokesAllTokensAndThrows_whenStoredTokenIsInvalid() {
        mockRequest.setCookies(new Cookie("rt", "expiredrawtoken"));

        RefreshToken expiredToken = RefreshToken.builder()
                .user(testUser)
                .tokenHash("somehash")
                .expiresAt(OffsetDateTime.now().minusSeconds(1)) // already expired → isValid=false
                .build();

        when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.of(expiredToken));

        assertThatThrownBy(() -> tokenService.rotateRefreshToken(mockRequest, mockResponse))
                .isInstanceOf(ApiException.class)
                .satisfies(ex ->
                        assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.REFRESH_TOKEN_INVALID));

        // Through the revoker, not the repository directly: the revocation must commit
        // even though this method throws (the throw rolls its transaction back).
        verify(refreshTokenRevoker).revokeAllForUser(testUser.getId());
        verify(refreshTokenRepository, never()).revokeAllForUser(any());
    }

    @Test
    void rotateRefreshToken_revokesAndThrows_whenUserIsDeactivated() {
        mockRequest.setCookies(new Cookie("rt", "validrawtoken"));
        testUser.setActive(false);

        RefreshToken validToken = RefreshToken.builder()
                .user(testUser)
                .tokenHash("somehash")
                .expiresAt(OffsetDateTime.now().plusHours(1))
                .build();

        when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.of(validToken));

        // Removal deactivates the account and revokes its tokens; this backstop refuses
        // any token that slips through instead of minting a fresh access token.
        assertThatThrownBy(() -> tokenService.rotateRefreshToken(mockRequest, mockResponse))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.ACCOUNT_DISABLED));

        verify(refreshTokenRevoker).revokeAllForUser(testUser.getId());
        verify(refreshTokenRepository, never()).save(any());
        assertThat(mockResponse.getHeader("Set-Cookie")).isNull();
    }

    @Test
    void rotateRefreshToken_returnsUser_andRevokesOldToken_andIssuesNewToken() {
        mockRequest.setCookies(new Cookie("rt", "validrawtoken"));

        RefreshToken validToken = RefreshToken.builder()
                .user(testUser)
                .tokenHash("somehash")
                .expiresAt(OffsetDateTime.now().plusHours(1))
                .build();

        when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.of(validToken));
        when(refreshTokenRepository.save(any(RefreshToken.class))).thenAnswer(inv -> inv.getArgument(0));

        User returned = tokenService.rotateRefreshToken(mockRequest, mockResponse);

        assertThat(returned).isEqualTo(testUser);
        assertThat(validToken.isRevoked()).isTrue();
        // A new Set-Cookie header should have been written
        assertThat(mockResponse.getHeader("Set-Cookie")).contains("rt=");
    }

    @Test
    void revokeRefreshToken_marksTokenRevokedAndClearsCookie() {
        mockRequest.setCookies(new Cookie("rt", "validrawtoken"));

        RefreshToken token = RefreshToken.builder()
                .user(testUser)
                .tokenHash("somehash")
                .expiresAt(OffsetDateTime.now().plusHours(1))
                .build();

        when(refreshTokenRepository.findByTokenHash(anyString())).thenReturn(Optional.of(token));
        when(refreshTokenRepository.save(any())).thenAnswer(inv -> inv.getArgument(0));

        tokenService.revokeRefreshToken(mockRequest, mockResponse);

        assertThat(token.isRevoked()).isTrue();
        // Cookie should be cleared (Max-Age=0)
        String setCookie = mockResponse.getHeader("Set-Cookie");
        assertThat(setCookie).contains("Max-Age=0");
    }

    @Test
    void revokeRefreshToken_clearsCookieEvenWhenNoCookiePresent() {
        // No cookie — should not throw, just clear
        tokenService.revokeRefreshToken(mockRequest, mockResponse);

        String setCookie = mockResponse.getHeader("Set-Cookie");
        assertThat(setCookie).contains("Max-Age=0");
    }
}
