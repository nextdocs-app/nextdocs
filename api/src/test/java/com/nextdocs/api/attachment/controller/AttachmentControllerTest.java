package com.nextdocs.api.attachment.controller;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.when;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.user;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.attachment.dto.response.AttachmentUrlResponse;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.attachment.service.AttachmentService.AttachmentDownload;
import com.nextdocs.api.attachment.storage.StoredAttachment;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import java.io.FileNotFoundException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.AbstractMockHttpServletRequestBuilder;

@WebMvcTest(AttachmentController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class AttachmentControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AttachmentService attachmentService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private UserRepository userRepository;

    private UserPrincipal principal;
    private UUID userId;
    private UUID documentId;
    private UUID attachmentId;

    @BeforeEach
    void setUp() {
        User user = User.builder()
                .email("alice@example.com")
                .displayName("Alice")
                .passwordHash("$2a$12$hash")
                .build();
        userId = UUID.randomUUID();
        user.setId(userId);
        principal = UserPrincipal.from(user);
        documentId = UUID.randomUUID();
        attachmentId = UUID.randomUUID();
    }

    @Test
    void upload_success_returns201() throws Exception {
        when(attachmentService.upload(eq(userId), eq(documentId), any()))
                .thenReturn(new AttachmentResponse(
                        attachmentId,
                        documentId,
                        "a.png",
                        "image/png",
                        3,
                        "/api/v1/attachments/" + attachmentId,
                        OffsetDateTime.now()));

        mockMvc.perform(declaredUpload(multipart("/api/v1/documents/{documentId}/attachments", documentId)
                                .file(new MockMultipartFile("file", "a.png", "image/png", new byte[] {1, 2, 3})))
                        .with(user(principal)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.url").value("/api/v1/attachments/" + attachmentId))
                .andExpect(jsonPath("$.message").value("Attachment uploaded."));
    }

    @Test
    void upload_withoutAuthentication_returns401() throws Exception {
        mockMvc.perform(declaredUpload(multipart("/api/v1/documents/{documentId}/attachments", documentId)
                        .file(new MockMultipartFile("file", "a.png", "image/png", new byte[] {1, 2, 3}))))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void upload_withoutEditAccess_returns403() throws Exception {
        when(attachmentService.upload(eq(userId), eq(documentId), any()))
                .thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        mockMvc.perform(declaredUpload(multipart("/api/v1/documents/{documentId}/attachments", documentId)
                                .file(new MockMultipartFile("file", "a.png", "image/png", new byte[] {1, 2, 3})))
                        .with(user(principal)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void upload_oversizedFile_returns413() throws Exception {
        when(attachmentService.upload(eq(userId), eq(documentId), any()))
                .thenThrow(new ApiException(ErrorCode.PAYLOAD_TOO_LARGE));

        mockMvc.perform(declaredUpload(multipart("/api/v1/documents/{documentId}/attachments", documentId)
                                .file(new MockMultipartFile(
                                        "file", "big.bin", "application/octet-stream", new byte[] {1})))
                        .with(user(principal)))
                .andExpect(status().isPayloadTooLarge())
                .andExpect(jsonPath("$.error").value(ErrorCode.PAYLOAD_TOO_LARGE.defaultMessage()));
    }

    @Test
    void resolveUrl_authenticatedCaller_returnsSignedUrl() throws Exception {
        when(attachmentService.resolveUrl(eq(userId), eq(attachmentId)))
                .thenReturn(new AttachmentUrlResponse(
                        "/api/v1/attachments/" + attachmentId + "/file?exp=4102444800&sig=abc",
                        Instant.now().plusSeconds(3600)));

        mockMvc.perform(get("/api/v1/attachments/{id}/url", attachmentId).with(user(principal)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url")
                        .value("/api/v1/attachments/" + attachmentId + "/file?exp=4102444800&sig=abc"));
    }

    @Test
    void resolveUrl_anonymousPublicDocument_returnsSignedUrl() throws Exception {
        when(attachmentService.resolveUrl(isNull(), eq(attachmentId)))
                .thenReturn(new AttachmentUrlResponse(
                        "/api/v1/attachments/" + attachmentId + "/file?exp=4102444800&sig=abc",
                        Instant.now().plusSeconds(3600)));

        mockMvc.perform(get("/api/v1/attachments/{id}/url", attachmentId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));
    }

    @Test
    void resolveUrl_unreadableAttachment_returns404() throws Exception {
        // Pin the principal identity: the authenticated branch must pass the caller's
        // id, not null, so an anonymous/authenticated mix-up cannot pass this test.
        when(attachmentService.resolveUrl(eq(userId), eq(attachmentId)))
                .thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/attachments/{id}/url", attachmentId).with(user(principal)))
                .andExpect(status().isNotFound());
    }

    @Test
    void download_streamsContentWithHardeningHeaders() throws Exception {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("report.pdf", "application/pdf", content);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "application/pdf"))
                .andExpect(header().string("Content-Disposition", containsString("inline")))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Content-Security-Policy", "default-src 'none'; sandbox"))
                .andExpect(header().string(HttpHeaders.ACCEPT_RANGES, "bytes"))
                // no-store alone forbids all storage; a private directive alongside it is redundant.
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andExpect(content().bytes(content));
    }

    @Test
    void download_pngFile_isInlined() throws Exception {
        // Raster images are the feature's headline block type: deleting image/png from
        // the allowlist must turn this inline into an attachment.
        stubDownload("photo.png", "image/png", "hello".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("inline")));
    }

    @Test
    void download_videoFile_isInlined() throws Exception {
        // The feature's headline block types must stay inline or the editor's <video>
        // element downloads the file instead of playing it.
        stubDownload("clip.mp4", "video/mp4", "hello".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("inline")));
    }

    @Test
    void download_audioFile_isInlined() throws Exception {
        stubDownload("song.mp3", "audio/mpeg", "hello".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("inline")));
    }

    @Test
    void download_exoticMediaContainer_isNotInlined() throws Exception {
        // The content type is client-supplied: an allowlisted prefix must not smuggle a
        // scriptable or unhandled container into the inline path.
        stubDownload("clip.wmv", "video/x-ms-wmv", "hello".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("attachment")));
    }

    @Test
    void download_nonMediaFile_isNotInlined() throws Exception {
        byte[] content = "PK".getBytes(StandardCharsets.UTF_8);
        stubDownload("archive.zip", "application/zip", content);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("attachment")));
    }

    @Test
    void download_svgFile_isNotInlined() throws Exception {
        stubDownload("logo.svg", "image/svg+xml", "<svg/>".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("attachment")));
    }

    @Test
    void download_htmlFile_isNotInlined() throws Exception {
        stubDownload("page.html", "text/html", "<script>alert(1)</script>".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("attachment")));
    }

    @Test
    void download_malformedRange_returns200FullContent() throws Exception {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("clip.mp4", "video/mp4", content);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=oops"))
                .andExpect(status().isOk())
                .andExpect(header().doesNotExist(HttpHeaders.CONTENT_RANGE))
                .andExpect(content().bytes(content));
    }

    @Test
    void upload_withoutFilePart_returns400() throws Exception {
        mockMvc.perform(declaredUpload(multipart("/api/v1/documents/{documentId}/attachments", documentId))
                        .with(user(principal)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void download_withoutSignature_returns400() throws Exception {
        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void download_rangeRequest_returnsPartialContent() throws Exception {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("clip.mp4", "video/mp4", content);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=0-1"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string(HttpHeaders.CONTENT_RANGE, "bytes 0-1/" + content.length))
                .andExpect(content().bytes(new byte[] {content[0], content[1]}));
    }

    @Test
    void download_unsatisfiableRange_returns416() throws Exception {
        stubDownload("clip.mp4", "video/mp4", "hello".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=100-200"))
                .andExpect(status().isRequestedRangeNotSatisfiable())
                .andExpect(header().string(HttpHeaders.CONTENT_RANGE, "bytes */5"));
    }

    @Test
    void download_headRequest_returnsHeadersWithoutBody() throws Exception {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("clip.mp4", "video/mp4", content);

        mockMvc.perform(head("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "video/mp4"))
                .andExpect(header().string(HttpHeaders.ACCEPT_RANGES, "bytes"))
                .andExpect(header().longValue(HttpHeaders.CONTENT_LENGTH, content.length))
                .andExpect(content().bytes(new byte[0]));
    }

    @Test
    void download_headRangeRequest_returnsPartialHeadersWithoutBody() throws Exception {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("clip.mp4", "video/mp4", content);

        mockMvc.perform(head("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=1-3"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string(HttpHeaders.CONTENT_RANGE, "bytes 1-3/" + content.length))
                .andExpect(header().longValue(HttpHeaders.CONTENT_LENGTH, 3))
                .andExpect(content().bytes(new byte[0]));
    }

    @Test
    void download_suffixRange_returnsTheLastBytes() throws Exception {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("clip.mp4", "video/mp4", content);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=-2"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string(HttpHeaders.CONTENT_RANGE, "bytes 3-4/" + content.length))
                .andExpect(content().bytes(new byte[] {content[3], content[4]}));
    }

    @Test
    void download_openEndedRange_returnsTheRemainder() throws Exception {
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("clip.mp4", "video/mp4", content);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=2-"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string(HttpHeaders.CONTENT_RANGE, "bytes 2-4/" + content.length))
                .andExpect(content().bytes(new byte[] {content[2], content[3], content[4]}));
    }

    @Test
    void download_multiRange_servesTheFirstRangeOnly() throws Exception {
        // A multipart/byteranges response is out of scope; pin first-range-wins so the
        // silent truncation is a decided behavior rather than an accident.
        byte[] content = "hello".getBytes(StandardCharsets.UTF_8);
        stubDownload("clip.mp4", "video/mp4", content);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=0-1,3-4"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string(HttpHeaders.CONTENT_RANGE, "bytes 0-1/" + content.length))
                .andExpect(content().bytes(new byte[] {content[0], content[1]}));
    }

    @Test
    void download_waveAudioFile_isInlined() throws Exception {
        stubDownload("sound.wav", "audio/wave", "hello".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("inline")));
    }

    @Test
    void download_waveVendorAudioFile_isInlined() throws Exception {
        stubDownload("sound.wav", "audio/vnd.wave", "hello".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Disposition", containsString("inline")));
    }

    @Test
    void download_invalidSignature_returns404() throws Exception {
        when(attachmentService.load(eq(attachmentId), anyLong(), anyString()))
                .thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "tampered"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void download_fileRemovedBeforeStreaming_returns404() throws Exception {
        // Delete-vs-download race: the row and its size still exist, but the file is gone
        // when the controller opens it. That is a missing resource, not a server fault.
        stubDownloadFrom(missingFile(), "clip.mp4", "video/mp4", 5);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.success").value(false));
    }

    @Test
    void download_rangeRequestWithFileRemoved_returns404() throws Exception {
        stubDownloadFrom(missingFile(), "clip.mp4", "video/mp4", 5);

        mockMvc.perform(get("/api/v1/attachments/{id}/file", attachmentId)
                        .param("exp", "4102444800")
                        .param("sig", "valid")
                        .header(HttpHeaders.RANGE, "bytes=0-1"))
                .andExpect(status().isNotFound());
    }

    /**
     * MockMvc multipart probes carry no body, so getContentLengthLong() reports -1 and the
     * rate-limit filter (rightly) refuses an undeclared multipart upload. Give the probe an
     * empty declared body so it exercises the controller, not the transport guard.
     */
    private static <T extends AbstractMockHttpServletRequestBuilder<T>> T declaredUpload(T builder) {
        return builder.with(request -> {
            request.setContent(new byte[0]);
            return request;
        });
    }

    /** A stored file whose bytes vanished between the metadata read and the open. */
    private static Resource missingFile() throws Exception {
        Resource resource = org.mockito.Mockito.mock(Resource.class);
        when(resource.getInputStream()).thenThrow(new FileNotFoundException("gone"));
        return resource;
    }

    private void stubDownloadFrom(Resource resource, String fileName, String contentType, long sizeBytes) {
        Attachment attachment = Attachment.builder()
                .id(attachmentId)
                .fileName(fileName)
                .contentType(contentType)
                .sizeBytes(sizeBytes)
                .build();
        when(attachmentService.load(eq(attachmentId), anyLong(), anyString()))
                .thenReturn(new AttachmentDownload(attachment, new StoredAttachment(resource, sizeBytes, true)));
    }

    private void stubDownload(String fileName, String contentType, byte[] content) {
        Attachment attachment = Attachment.builder()
                .id(attachmentId)
                .fileName(fileName)
                .contentType(contentType)
                .sizeBytes(content.length)
                .build();
        StoredAttachment stored = new StoredAttachment(new ByteArrayResource(content), content.length, true);
        when(attachmentService.load(eq(attachmentId), anyLong(), anyString()))
                .thenReturn(new AttachmentDownload(attachment, stored));
    }
}
