package com.nextdocs.api.attachment.controller;

import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.attachment.dto.response.AttachmentUrlResponse;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.attachment.service.AttachmentService.AttachmentDownload;
import com.nextdocs.api.auth.security.UserPrincipal;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.response.ApiResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.Resource;
import org.springframework.http.CacheControl;
import org.springframework.http.ContentDisposition;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpRange;
import org.springframework.http.HttpStatus;
import org.springframework.http.InvalidMediaTypeException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.StreamUtils;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

@Tag(name = "Attachments", description = "File uploads for image, video, audio, and file blocks")
@RestController
@RequiredArgsConstructor
@SecurityRequirement(name = "bearerAuth")
public class AttachmentController {

    /** Request-mapping paths, exposed so tests can reference the real strings instead of
     * copies that silently drift from the mappings below. */
    public static final String UPLOAD_PATH = "/api/v1/documents/{documentId}/attachments";

    public static final String URL_PATH = "/api/v1/attachments/{id}/url";
    public static final String FILE_PATH = "/api/v1/attachments/{id}/file";

    private final AttachmentService attachmentService;

    @Operation(
            summary = "Upload an attachment",
            description = "Stores a file for a document the caller can edit and returns the "
                    + "storage-independent URL to put in a block. Requires EDIT access.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "201",
                        description = "Attachment stored"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "400",
                        description = "Empty or invalid file"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "401",
                        description = "Authentication required"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "403",
                        description = "Caller lacks EDIT access"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Document not found"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "413",
                        description = "File exceeds the configured size limit")
            })
    @PostMapping(value = UPLOAD_PATH, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ApiResponse<AttachmentResponse>> upload(
            @AuthenticationPrincipal UserPrincipal principal,
            @PathVariable UUID documentId,
            @RequestPart("file") MultipartFile file) {
        UserPrincipal caller = Objects.requireNonNull(principal, "Authentication is required to upload.");
        AttachmentResponse response = attachmentService.upload(caller.getId(), documentId, file);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.ok(response, "Attachment uploaded."));
    }

    @Operation(
            summary = "Create a signed download URL",
            description = "Returns a short-lived URL that authorizes downloading a single attachment. "
                    + "Requires read access to the owning document; anonymous callers are allowed for "
                    + "documents shared as ANYONE_WITH_LINK. Browser media elements cannot send "
                    + "Authorization headers, which is why this indirection exists.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Signed URL returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Attachment not found or not readable by the caller")
            })
    @SecurityRequirements({})
    @GetMapping(URL_PATH)
    public ResponseEntity<ApiResponse<AttachmentUrlResponse>> resolveUrl(
            @AuthenticationPrincipal UserPrincipal principal, @PathVariable UUID id) {
        UUID userId = principal != null ? principal.getId() : null;
        return ResponseEntity.ok(ApiResponse.ok(attachmentService.resolveUrl(userId, id)));
    }

    @Operation(
            summary = "Download an attachment",
            description = "Streams stored bytes for a valid, unexpired signature. Supports range "
                    + "requests so audio and video blocks can seek.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "File content"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "206",
                        description = "Partial content for a range request"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Unknown attachment or invalid/expired signature")
            })
    @SecurityRequirements({})
    @GetMapping(FILE_PATH)
    public void download(
            @PathVariable UUID id,
            @RequestParam long exp,
            @RequestParam String sig,
            @RequestHeader(value = HttpHeaders.RANGE, required = false) String rangeHeader,
            HttpServletRequest request,
            HttpServletResponse response)
            throws IOException {
        AttachmentDownload download = attachmentService.load(id, exp, sig);
        Resource resource = download.stored().resource();
        long contentLength = download.stored().sizeBytes();
        HttpHeaders headers =
                buildDownloadHeaders(download.attachment(), download.stored().rangesSupported());
        headers.forEach((name, values) -> values.forEach(value -> response.addHeader(name, value)));

        List<HttpRange> ranges = parseRanges(rangeHeader);
        if (ranges != null && download.stored().rangesSupported()) {
            HttpRange range = ranges.get(0);
            long start = range.getRangeStart(contentLength);
            if (start >= contentLength) {
                response.setStatus(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE.value());
                response.setHeader(HttpHeaders.CONTENT_RANGE, "bytes */" + contentLength);
                return;
            }
            long end = range.getRangeEnd(contentLength);
            long rangeLength = end - start + 1;
            response.setStatus(HttpStatus.PARTIAL_CONTENT.value());
            response.setHeader(HttpHeaders.CONTENT_RANGE, "bytes " + start + "-" + end + "/" + contentLength);
            response.setContentLengthLong(rangeLength);
            if (isHeadRequest(request)) {
                return;
            }
            try (InputStream inputStream = openStoredFile(resource)) {
                StreamUtils.copyRange(inputStream, response.getOutputStream(), start, end);
            }
            return;
        }

        response.setStatus(HttpStatus.OK.value());
        response.setContentLengthLong(contentLength);
        if (isHeadRequest(request)) {
            return;
        }
        try (InputStream inputStream = openStoredFile(resource)) {
            StreamUtils.copy(inputStream, response.getOutputStream());
        }
    }

    /**
     * Opens the stored file for streaming. A file removed between the storage check and the
     * open (a purge racing the download) is a 404, not a 500: the row said the file exists,
     * so its absence is a missing resource. Failures after the stream is open propagate -
     * by then the status line is on the wire and the response can no longer change.
     */
    private static InputStream openStoredFile(Resource resource) {
        try {
            return resource.getInputStream();
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
    }

    private static boolean isHeadRequest(HttpServletRequest request) {
        return "HEAD".equalsIgnoreCase(request.getMethod());
    }

    /** Returns {@code null} when there is no usable range header; malformed ranges are ignored. */
    private static List<HttpRange> parseRanges(String rangeHeader) {
        if (rangeHeader == null || rangeHeader.isBlank()) {
            return null;
        }
        try {
            List<HttpRange> ranges = HttpRange.parseRanges(rangeHeader);
            return ranges.isEmpty() ? null : ranges;
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private static HttpHeaders buildDownloadHeaders(Attachment attachment, boolean rangesSupported) {
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(parseContentType(attachment.getContentType()));
        // Inline only for media a browser renders safely; everything else downloads, so a
        // user-uploaded HTML/SVG file can never execute on the API origin.
        ContentDisposition.Builder disposition = isInlineSafe(attachment.getContentType())
                ? ContentDisposition.inline()
                : ContentDisposition.attachment();
        headers.setContentDisposition(disposition
                .filename(attachment.getFileName(), StandardCharsets.UTF_8)
                .build());
        headers.set("X-Content-Type-Options", "nosniff");
        // Neutralizes script execution for anything the browser might render inline.
        headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
        if (rangesSupported) {
            // Tells media clients seeking is supported before they attempt a Range request.
            headers.set(HttpHeaders.ACCEPT_RANGES, "bytes");
        }
        // Signed URLs already carry an expiry, and the editor re-mints them through
        // /url (re-running the permission check), so downloaded bytes must never sit in
        // shared caches or proxies past the TTL. no-store alone forbids all storage, so
        // no private/shared directive is needed alongside it.
        headers.setCacheControl(CacheControl.noStore());
        return headers;
    }

    private static MediaType parseContentType(String contentType) {
        try {
            return MediaType.parseMediaType(contentType);
        } catch (InvalidMediaTypeException ex) {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }

    /** Raster image types a browser can render without executing embedded scripts. */
    private static final Set<String> INLINE_IMAGE_TYPES =
            Set.of("image/png", "image/jpeg", "image/gif", "image/webp", "image/avif");

    /** Common media containers browsers play natively; anything else downloads. */
    private static final Set<String> INLINE_VIDEO_TYPES = Set.of("video/mp4", "video/webm", "video/ogg");

    private static final Set<String> INLINE_AUDIO_TYPES = Set.of(
            "audio/mpeg",
            "audio/ogg",
            "audio/wav",
            "audio/webm",
            "audio/mp4",
            "audio/aac",
            "audio/flac",
            "audio/x-wav",
            "audio/wave",
            "audio/vnd.wave");

    private static boolean isInlineSafe(String contentType) {
        String type = contentType == null ? "" : contentType.toLowerCase(Locale.ROOT);
        // Explicit allowlists keep SVG (scriptable XML) and exotic media containers on the
        // attachment path even if the sandbox/CSP headers are ever weakened or stripped by
        // a proxy. The stored content type is client-supplied, so a prefix match would let
        // an attacker smuggle a scriptable type under a `video/` or `audio/` prefix.
        return INLINE_IMAGE_TYPES.contains(type)
                || INLINE_VIDEO_TYPES.contains(type)
                || INLINE_AUDIO_TYPES.contains(type)
                || type.equals("application/pdf");
    }
}
