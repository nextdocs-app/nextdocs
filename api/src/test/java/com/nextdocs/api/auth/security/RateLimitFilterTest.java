package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.security.ratelimit.RateLimiter;
import com.nextdocs.api.common.exception.ErrorCode;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

class RateLimitFilterTest {

    /** Small ceiling so body-limit tests stay cheap; the production default is 5 MB. */
    private static final long MAX_TEST_BODY_BYTES = 1024;

    /** Small multipart request ceiling so the declared-size test does not need a 30 MB body. */
    private static final String MAX_TEST_UPLOAD_REQUEST_SIZE = "2KB";

    private static final long MAX_TEST_UPLOAD_DECLARED_BYTES = 2048;

    private MockMvc mockMvc;
    private StubRateLimiter rateLimiter;
    private RateLimitFilter filter;

    @BeforeEach
    void setUp() {
        rateLimiter = new StubRateLimiter();
        filter = new RateLimitFilter(
                rateLimiter,
                new ObjectMapper(),
                120,
                60,
                20,
                60,
                MAX_TEST_BODY_BYTES,
                20,
                60,
                600,
                60,
                MAX_TEST_UPLOAD_REQUEST_SIZE);
        mockMvc = MockMvcBuilders.standaloneSetup(new StubController())
                .addFilters(filter)
                .build();
    }

    private static final String DOCUMENT_ID = "11111111-1111-1111-1111-111111111111";

    private static UUID authenticate() {
        com.nextdocs.api.auth.entity.User user = com.nextdocs.api.auth.entity.User.builder()
                .id(UUID.randomUUID())
                .email("user@example.com")
                .displayName("Test User")
                .passwordHash("hash")
                .active(true)
                .build();
        UserPrincipal principal = UserPrincipal.from(user);
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, List.of()));
        return principal.getId();
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void authPath_whenAllowed_isPassedThrough() throws Exception {
        mockMvc.perform(post("/api/v1/auth/login").remoteAddress("10.0.0.1")).andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("auth:10.0.0.1");
    }

    @Test
    void authPath_whenRejected_returnsTooManyRequests() throws Exception {
        rateLimiter.allowed = false;

        mockMvc.perform(post("/api/v1/auth/login").remoteAddress("10.0.0.2"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void nonAuthPath_isNotRateLimited() throws Exception {
        mockMvc.perform(post("/other/endpoint").remoteAddress("10.0.0.3")).andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void publicDocumentPath_whenAllowed_isPassedThrough() throws Exception {
        mockMvc.perform(get("/api/v1/documents/{id}/public", "11111111-1111-1111-1111-111111111111")
                        .remoteAddress("10.0.0.4"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.0.4");
    }

    @Test
    void headOnPublicReadPath_usesSameReadBucketAsGet() throws Exception {
        // HEAD is a bodyless GET: it must consume the same public-read budget
        // rather than passing through unlimited.
        mockMvc.perform(head("/api/v1/documents/{id}/public", "11111111-1111-1111-1111-111111111111")
                .remoteAddress("10.0.0.7"));

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.0.7");
    }

    @Test
    void publicDocumentPath_whenRejected_returnsTooManyRequests() throws Exception {
        rateLimiter.allowed = false;

        mockMvc.perform(get("/api/v1/documents/{id}/public", "11111111-1111-1111-1111-111111111111")
                        .remoteAddress("10.0.0.5"))
                .andExpect(status().isTooManyRequests())
                // The limiter's own refill estimate, not the 60s window length: a client
                // that waits the window would idle nineteen times longer than needed.
                .andExpect(header().string("Retry-After", "3"))
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void publicDocumentPath_withEncodedSlashInId_isRateLimitedFailClosed() throws Exception {
        mockMvc.perform(get("/api/v1/documents/11111111-1111-1111-1111-111111111111%2Fchild/public")
                        .remoteAddress("10.0.0.6"))
                .andReturn();

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.0.6");
    }

    @Test
    void publicSubPaths_areRateLimited() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/{id}/public/path", id).remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/public/children", id).remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id).remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());
        mockMvc.perform(patch("/api/v1/documents/{id}/public", id)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("{}")
                        .remoteAddress("10.0.1.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(4);
        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.1.1");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(20);
    }

    @Test
    void attachmentMintAndDownload_shareDownloadBudget() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        // Anonymous mints fan out like downloads (a hundred-image doc mints ~100 URLs in a
        // ~2s burst), so both share the larger bucket instead of starving browsing.
        mockMvc.perform(get("/api/v1/attachments/{id}/url", id).remoteAddress("10.0.4.1"))
                .andExpect(status().isOk());
        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.4.1");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(600);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", id)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.4.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(2);
        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.4.1");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(600);
    }

    @Test
    void attachmentPath_whenRejected_returnsTooManyRequests() throws Exception {
        rateLimiter.allowed = false;

        mockMvc.perform(get("/api/v1/attachments/{id}/file", "11111111-1111-1111-1111-111111111111")
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.4.2"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.success").value(false));

        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.4.2");
    }

    @Test
    void uploadPath_consumesCallerAndAddressBuckets() throws Exception {
        UUID callerId = authenticate();

        mockMvc.perform(post("/api/v1/documents/{id}/attachments", DOCUMENT_ID).remoteAddress("10.0.5.1"))
                .andExpect(status().isOk());

        // Both budgets are charged: one account cannot queue disk-filling uploads, and one
        // shared egress address cannot either.
        assertThat(rateLimiter.keys).containsExactly("upload-ip:10.0.5.1", "upload:" + callerId);
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(20);
        assertThat(rateLimiter.lastWindow).isEqualTo(Duration.ofSeconds(60));
    }

    @Test
    void uploadPath_whenCallerBucketIsExhausted_returnsTooManyRequests() throws Exception {
        UUID callerId = authenticate();
        rateLimiter.deniedKeys.add("upload:" + callerId);

        mockMvc.perform(post("/api/v1/documents/{id}/attachments", DOCUMENT_ID).remoteAddress("10.0.5.2"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void uploadPath_whenAddressBucketIsExhausted_returnsTooManyRequests() throws Exception {
        authenticate();
        rateLimiter.deniedKeys.add("upload-ip:10.0.5.5");

        // Either budget refusing refuses the request: returning only the caller decision
        // would let a denied address through here.
        mockMvc.perform(post("/api/v1/documents/{id}/attachments", DOCUMENT_ID).remoteAddress("10.0.5.5"))
                .andExpect(status().isTooManyRequests())
                .andExpect(jsonPath("$.success").value(false));

        assertThat(rateLimiter.keys).contains("upload-ip:10.0.5.5");
    }

    @Test
    void uploadPath_withOversizedDeclaredBody_isRejectedBeforeBuffering() throws Exception {
        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest(
                        "POST", "/api/v1/documents/" + DOCUMENT_ID + "/attachments") {
                    @Override
                    public long getContentLengthLong() {
                        return MAX_TEST_UPLOAD_DECLARED_BYTES + 1;
                    }
                };
        request.setContentType("multipart/form-data; boundary=----test");
        request.setRemoteAddr("10.0.5.3");

        org.springframework.mock.web.MockHttpServletResponse response =
                new org.springframework.mock.web.MockHttpServletResponse();
        jakarta.servlet.FilterChain chain = org.mockito.Mockito.mock(jakarta.servlet.FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        // An oversized upload is the same event the multipart ceiling reports, so it
        // carries the same message (not the anonymous-write wording below).
        assertThat(response.getContentAsString()).contains(ErrorCode.PAYLOAD_TOO_LARGE.defaultMessage());
        org.mockito.Mockito.verify(chain, org.mockito.Mockito.never())
                .doFilter(
                        org.mockito.Mockito.any(jakarta.servlet.ServletRequest.class),
                        org.mockito.Mockito.any(jakarta.servlet.ServletResponse.class));
    }

    @Test
    void uploadPath_withoutDeclaredLength_isRejectedBeforeTheChain() throws Exception {
        authenticate();

        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest(
                        "POST", "/api/v1/documents/" + DOCUMENT_ID + "/attachments") {
                    @Override
                    public long getContentLengthLong() {
                        return -1L;
                    }
                };
        request.setContentType("multipart/form-data; boundary=----test");
        request.setRemoteAddr("10.0.5.4");

        org.springframework.mock.web.MockHttpServletResponse response =
                new org.springframework.mock.web.MockHttpServletResponse();
        jakarta.servlet.FilterChain chain = org.mockito.Mockito.mock(jakarta.servlet.FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        org.mockito.Mockito.verify(chain, org.mockito.Mockito.never())
                .doFilter(
                        org.mockito.Mockito.any(jakarta.servlet.ServletRequest.class),
                        org.mockito.Mockito.any(jakarta.servlet.ServletResponse.class));
    }

    @Test
    void downloadPath_usesItsOwnLargerBucket() throws Exception {
        mockMvc.perform(get("/api/v1/attachments/{id}/file", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.6.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.6.1");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(600);
        assertThat(rateLimiter.lastWindow).isEqualTo(Duration.ofSeconds(60));
    }

    @Test
    void downloadRangeSeek_chargesTheDownloadBucketNotTheReadBucket() throws Exception {
        mockMvc.perform(get("/api/v1/attachments/{id}/file", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .header("Range", "bytes=0-1")
                        .remoteAddress("10.0.6.2"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.6.2");
        assertThat(rateLimiter.keys).doesNotContain("public-read:10.0.6.2");
    }

    @Test
    void anonymousMint_usesDownloadBucketNotReadBucket() throws Exception {
        mockMvc.perform(get("/api/v1/attachments/{id}/url", DOCUMENT_ID).remoteAddress("10.0.6.3"))
                .andExpect(status().isOk());
        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.6.3");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(600);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.6.3"))
                .andExpect(status().isOk());
        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.6.3");
    }

    @Test
    void attachmentFile_withTrailingSlashOrExtraSegment_usesPublicReadBucket() throws Exception {
        // Exact-shape matching: a contains("/file") check would pull these into the
        // download bucket and let malformed paths share the fan-out budget.
        mockMvc.perform(get("/api/v1/attachments/{id}/file/", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.6.4"))
                .andReturn();
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.6.4");

        mockMvc.perform(get("/api/v1/attachments/{id}/file/extra", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.6.4"))
                .andReturn();
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.6.4");
    }

    @Test
    void attachmentFile_withPostMethod_usesPublicReadBucket() throws Exception {
        // Only GET|HEAD are downloads: a POST must not consume the download budget.
        mockMvc.perform(post("/api/v1/attachments/{id}/file", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.6.5"))
                .andReturn();
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.6.5");
    }

    @Test
    void attachmentMint_withPostMethodOrTrailingSlash_usesPublicReadBucket() throws Exception {
        mockMvc.perform(post("/api/v1/attachments/{id}/url", DOCUMENT_ID).remoteAddress("10.0.6.6"))
                .andReturn();
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.6.6");

        mockMvc.perform(get("/api/v1/attachments/{id}/url/", DOCUMENT_ID).remoteAddress("10.0.6.6"))
                .andReturn();
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.6.6");
    }

    @Test
    void headOnSignedDownload_usesDownloadBucket() throws Exception {
        mockMvc.perform(head("/api/v1/attachments/{id}/file", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.6.7"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.6.7");
    }

    @Test
    void signedUrlMint_whenAuthenticated_isNotRateLimited() throws Exception {
        authenticate();

        // Minting re-runs the permission check; throttling an identified caller here would
        // only starve guests sharing the same egress IP.
        mockMvc.perform(get("/api/v1/attachments/{id}/url", DOCUMENT_ID).remoteAddress("10.0.6.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void attachmentDownload_whenAuthenticated_stillUsesTheDownloadBudget() throws Exception {
        authenticate();

        // Browser media tags cannot send an Authorization header, so a download keys on the
        // address even when its viewer is signed in - and pays the download budget, not the
        // read one.
        mockMvc.perform(get("/api/v1/attachments/{id}/file", DOCUMENT_ID)
                        .param("exp", "4102444800")
                        .param("sig", "probe")
                        .remoteAddress("10.0.6.2"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("download:10.0.6.2");
    }

    @Test
    void publicReadPaths_shareOneReadBucket() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/{id}/public/path", id).remoteAddress("10.0.1.5"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/public/children", id).remoteAddress("10.0.1.5"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id).remoteAddress("10.0.1.5"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(3);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.5");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(120);
    }

    @Test
    void accessCheck_whenAuthenticated_isNotRateLimited() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        com.nextdocs.api.auth.entity.User user = com.nextdocs.api.auth.entity.User.builder()
                .id(UUID.randomUUID())
                .email("user@example.com")
                .displayName("Test User")
                .passwordHash("hash")
                .active(true)
                .build();
        UserPrincipal principal = UserPrincipal.from(user);
        SecurityContextHolder.getContext()
                .setAuthentication(new UsernamePasswordAuthenticationToken(principal, null, List.of()));

        // Identified callers are exempt so an owner's polling tab cannot starve
        // guests sharing the same egress IP.
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id).remoteAddress("10.0.1.4"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/documents/{id}/my-access", id).remoteAddress("10.0.1.4"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void accessCheck_withGarbageAuthorizationHeader_isRateLimited() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        // Bearer garbage without a valid UserPrincipal in SecurityContext must NOT bypass rate limiting
        mockMvc.perform(get("/api/v1/documents/{id}/access-check", id)
                        .header("Authorization", "Bearer invalid-garbage-token")
                        .remoteAddress("10.0.1.4"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.4");
        assertThat(rateLimiter.lastMaxRequests).isEqualTo(120);
        assertThat(rateLimiter.lastWindow).isEqualTo(Duration.ofSeconds(60));
    }

    @Test
    void trailingSlashPaths_areCorrectlyClassified() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/" + id + "/public/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");

        mockMvc.perform(patch("/api/v1/documents/" + id + "/public/")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                .content("{}")
                .remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.1.8");

        mockMvc.perform(get("/api/v1/documents/" + id + "/access-check/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");

        mockMvc.perform(get("/api/v1/documents/" + id + "/public/path/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");

        mockMvc.perform(get("/api/v1/documents/" + id + "/public/children/").remoteAddress("10.0.1.8"));
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.8");
    }

    @Test
    void anonymousWrite_withOversizedBody_isRejectedBeforeParsing() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(patch("/api/v1/documents/{id}/public", id)
                        .contentType(org.springframework.http.MediaType.APPLICATION_JSON)
                        .content("x".repeat((int) MAX_TEST_BODY_BYTES + 1))
                        .remoteAddress("10.0.2.1"))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.success").value(false))
                // A JSON snapshot write is not a file upload, so it keeps the generic
                // wording rather than the multipart size-limit message.
                .andExpect(jsonPath("$.error").value("Request payload is too large."));

        // The budget is consumed first, so oversized bodies cannot be used to probe
        // the endpoint for free.
        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.2.1");
    }

    @Test
    void anonymousWrite_withFormContentType_isRejectedBeforeBodyRead() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        // Form bodies are parsed via getParameter/getParts, not the cached byte
        // stream, so they must not reach the byte-bound read at all.
        mockMvc.perform(patch("/api/v1/documents/{id}/public", id)
                        .contentType(org.springframework.http.MediaType.APPLICATION_FORM_URLENCODED)
                        .content("title=" + "x".repeat(16))
                        .remoteAddress("10.0.2.3"))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.success").value(false));

        assertThat(rateLimiter.invocationCount).isEqualTo(1);
        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.2.3");
    }

    @Test
    void anonymousWrite_withMultipartContentType_isRejectedWithoutBuffering() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";
        byte[] body = "x".repeat((int) MAX_TEST_BODY_BYTES + 1).getBytes(java.nio.charset.StandardCharsets.UTF_8);

        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest(
                        "PATCH", "/api/v1/documents/" + id + "/public") {
                    @Override
                    public long getContentLengthLong() {
                        return -1L;
                    }
                };
        request.setContentType("multipart/form-data; boundary=----test");
        request.setContent(body);
        request.setRemoteAddr("10.0.2.4");

        org.springframework.mock.web.MockHttpServletResponse response =
                new org.springframework.mock.web.MockHttpServletResponse();
        jakarta.servlet.FilterChain chain = org.mockito.Mockito.mock(jakarta.servlet.FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(415);
        org.mockito.Mockito.verify(chain, org.mockito.Mockito.never())
                .doFilter(
                        org.mockito.Mockito.any(jakarta.servlet.ServletRequest.class),
                        org.mockito.Mockito.any(jakarta.servlet.ServletResponse.class));
    }

    @Test
    void anonymousWrite_withJsonCharset_isAllowed() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(patch("/api/v1/documents/{id}/public", id)
                        .contentType(
                                org.springframework.http.MediaType.parseMediaType("application/json;charset=UTF-8"))
                        .content("{}")
                        .remoteAddress("10.0.2.5"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("public-write:10.0.2.5");
    }

    @Test
    void anonymousWrite_withUnknownLengthBody_isBoundedByActualBytes() throws Exception {
        // Chunked uploads omit Content-Length, so the declared-length pre-check
        // passes them through: the byte-bound read must still reject them.
        String id = "11111111-1111-1111-1111-111111111111";
        byte[] body = "x".repeat((int) MAX_TEST_BODY_BYTES + 1).getBytes(java.nio.charset.StandardCharsets.UTF_8);

        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest(
                        "PATCH", "/api/v1/documents/" + id + "/public") {
                    @Override
                    public long getContentLengthLong() {
                        return -1L;
                    }
                };
        request.setContent(body);
        request.setRemoteAddr("10.0.2.9");

        org.springframework.mock.web.MockHttpServletResponse response =
                new org.springframework.mock.web.MockHttpServletResponse();
        jakarta.servlet.FilterChain chain = org.mockito.Mockito.mock(jakarta.servlet.FilterChain.class);

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        org.mockito.Mockito.verify(chain, org.mockito.Mockito.never())
                .doFilter(
                        org.mockito.Mockito.any(jakarta.servlet.ServletRequest.class),
                        org.mockito.Mockito.any(jakarta.servlet.ServletResponse.class));
    }

    @Test
    void anonymousWrite_withUnknownLengthSmallBody_isReplayedDownstream() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";
        byte[] body = "{}".getBytes(java.nio.charset.StandardCharsets.UTF_8);

        org.springframework.mock.web.MockHttpServletRequest request =
                new org.springframework.mock.web.MockHttpServletRequest(
                        "PATCH", "/api/v1/documents/" + id + "/public") {
                    @Override
                    public long getContentLengthLong() {
                        return -1L;
                    }
                };
        request.setContent(body);
        request.setRemoteAddr("10.0.2.10");

        org.springframework.mock.web.MockHttpServletResponse response =
                new org.springframework.mock.web.MockHttpServletResponse();
        jakarta.servlet.FilterChain chain = org.mockito.Mockito.mock(jakarta.servlet.FilterChain.class);

        filter.doFilter(request, response, chain);

        org.mockito.ArgumentCaptor<jakarta.servlet.ServletRequest> captor =
                org.mockito.ArgumentCaptor.forClass(jakarta.servlet.ServletRequest.class);
        org.mockito.Mockito.verify(chain)
                .doFilter(captor.capture(), org.mockito.Mockito.any(jakarta.servlet.ServletResponse.class));
        assertThat(captor.getValue().getInputStream().readAllBytes()).isEqualTo(body);
    }

    @Test
    void readPaths_areNotSubjectToTheBodyLimit() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";

        mockMvc.perform(get("/api/v1/documents/{id}/public", id).remoteAddress("10.0.2.2"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.2.2");
    }

    @Test
    void ipv4MappedIpv6_isNormalized() throws Exception {
        String id = "11111111-1111-1111-1111-111111111111";
        mockMvc.perform(get("/api/v1/documents/{id}/public", id).remoteAddress("::ffff:10.0.1.9"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.1.9");
    }

    @Test
    void publicNestedPath_isNotRateLimited() throws Exception {
        mockMvc.perform(get("/api/v1/documents/11111111-1111-1111-1111-111111111111/public/children/extra")
                        .remoteAddress("10.0.1.2"))
                .andReturn();

        assertThat(rateLimiter.invocationCount).isZero();
    }

    @Test
    void xForwardedForHeader_isIgnored_whenRemoteAddressIsNotTrustedProxy() throws Exception {
        // No trusted proxies configured (default) — X-Forwarded-For must not be trusted
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "203.0.113.5, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("auth:10.0.0.1");
    }

    @Test
    void xForwardedForHeader_usesRightmostUntrustedHop_whenRemoteAddressIsTrustedProxy() throws Exception {
        // Configure 10.0.0.1 as a trusted proxy so X-Forwarded-For is honoured
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1");
        filter.initTrustedProxies();

        // Typical chain: the client, then the trusted hop that appended its own address.
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "203.0.113.5, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("auth:203.0.113.5");
    }

    @Test
    void xForwardedForHeader_ignoresClientSuppliedLeadingEntries() throws Exception {
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1");
        filter.initTrustedProxies();

        // The caller prepended 9.9.9.9; the trusted hop appended the real peer address.
        // Rotating the spoofed entry must not hand out a fresh budget per request.
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "9.9.9.9, 203.0.113.5")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());
        assertThat(rateLimiter.lastKey).isEqualTo("auth:203.0.113.5");

        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "8.8.8.8, 203.0.113.5")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());
        assertThat(rateLimiter.lastKey).isEqualTo("auth:203.0.113.5");
    }

    @Test
    void xForwardedForHeader_fallsBackToPeer_whenEveryHopIsATrustedProxy() throws Exception {
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1, 10.0.0.2");
        filter.initTrustedProxies();

        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "10.0.0.2, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("auth:10.0.0.1");
    }

    @Test
    void xForwardedForHeader_skipsGarbageHops() throws Exception {
        ReflectionTestUtils.setField(filter, "trustedProxiesRaw", "10.0.0.1");
        filter.initTrustedProxies();

        // A garbage hop must not become the bucket key: it is skipped and the
        // rightmost valid untrusted address keys the request.
        mockMvc.perform(post("/api/v1/auth/login")
                        .header("X-Forwarded-For", "evil, 203.0.113.5, 10.0.0.1")
                        .remoteAddress("10.0.0.1"))
                .andExpect(status().isOk());

        assertThat(rateLimiter.lastKey).isEqualTo("auth:203.0.113.5");
    }

    @Test
    void malformedPublicPaths_areRateLimitedFailClosed() throws Exception {
        int before = rateLimiter.invocationCount;

        for (String uri : new String[] {
            "/api/v1/documents/%ZZ/public", "/api/v1/documents/%25/public", "/api/v1/documents/%/public",
        }) {
            org.springframework.mock.web.MockHttpServletRequest request =
                    new org.springframework.mock.web.MockHttpServletRequest("GET", uri);
            request.setRemoteAddr("10.0.3.1");
            org.springframework.mock.web.MockHttpServletResponse response =
                    new org.springframework.mock.web.MockHttpServletResponse();
            jakarta.servlet.FilterChain chain = org.mockito.Mockito.mock(jakarta.servlet.FilterChain.class);

            filter.doFilter(request, response, chain);
        }

        assertThat(rateLimiter.invocationCount).isEqualTo(before + 3);
        assertThat(rateLimiter.lastKey).isEqualTo("public-read:10.0.3.1");
    }

    private static final class StubRateLimiter implements RateLimiter {
        private boolean allowed = true;
        private Duration retryAfter = Duration.ofSeconds(3);
        private String lastKey;
        private int lastMaxRequests;
        private Duration lastWindow;
        private int invocationCount;
        private final List<String> keys = new java.util.ArrayList<>();
        private final java.util.Set<String> deniedKeys = new java.util.HashSet<>();

        @Override
        public RateLimiter.Decision allowRequest(String key) {
            invocationCount++;
            lastKey = key;
            keys.add(key);
            return decision(key);
        }

        @Override
        public RateLimiter.Decision allowRequest(String key, int maxRequests, java.time.Duration window) {
            invocationCount++;
            lastKey = key;
            lastMaxRequests = maxRequests;
            lastWindow = window;
            keys.add(key);
            return decision(key);
        }

        private RateLimiter.Decision decision(String key) {
            return allowed && !deniedKeys.contains(key)
                    ? RateLimiter.Decision.allow()
                    : RateLimiter.Decision.deny(retryAfter);
        }
    }

    @RestController
    static class StubController {
        @PostMapping("/api/v1/auth/login")
        ResponseEntity<String> login() {
            return ResponseEntity.ok("ok");
        }

        @PostMapping("/other/endpoint")
        ResponseEntity<String> other() {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/public")
        ResponseEntity<String> getPublic(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @org.springframework.web.bind.annotation.PatchMapping("/api/v1/documents/{id}/public")
        ResponseEntity<String> patchPublic(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/public/path")
        ResponseEntity<String> getPublicPath(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/public/children")
        ResponseEntity<String> getPublicChildren(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/access-check")
        ResponseEntity<String> accessCheck(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/documents/{id}/my-access")
        ResponseEntity<String> myAccess(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/attachments/{id}/url")
        ResponseEntity<String> attachmentUrl(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @GetMapping("/api/v1/attachments/{id}/file")
        ResponseEntity<String> attachmentFile(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }

        @PostMapping("/api/v1/documents/{id}/attachments")
        ResponseEntity<String> uploadAttachment(@PathVariable String id) {
            return ResponseEntity.ok("ok");
        }
    }
}
