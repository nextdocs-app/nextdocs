package com.nextdocs.api.document.controller;

import com.nextdocs.api.common.response.ApiResponse;
import com.nextdocs.api.document.dto.response.DocumentIconBundleResponse;
import com.nextdocs.api.document.dto.response.DocumentIconCatalogResponse;
import com.nextdocs.api.document.dto.response.DocumentIconCategoryResponse;
import com.nextdocs.api.document.service.DocumentIconService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirements;
import io.swagger.v3.oas.annotations.tags.Tag;
import java.util.List;
import java.util.concurrent.TimeUnit;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.WebRequest;

@Tag(name = "Document icons", description = "Builtin page-icon catalog")
@RestController
@RequestMapping("/api/v1/icons")
@RequiredArgsConstructor
@SecurityRequirements({})
public class DocumentIconController {

    /** Route shapes, exposed so security tests reference the real strings. */
    public static final String LIST_PATH = "/api/v1/icons";

    public static final String BUNDLE_PATH = "/api/v1/icons/bundle";

    public static final String SVG_PATH = "/api/v1/icons/{name}";

    private final DocumentIconService iconService;

    /**
     * Conditional-GET gate for a representation keyed by {@code version}.
     *
     * <p>Goes through the container's validator matching instead of comparing the header
     * to our own ETag string: a literal equality only ever matches the one strong value a
     * browser echoes back, so a weak validator or a comma-separated list — what a CDN or
     * an aggregating client sends — never 304s and re-downloads the ~830KB bundle.
     *
     * <p>{@code *} is not treated as a match: it asserts "the representation exists",
     * which a glyph name that may 404 cannot promise from here.
     */
    private static boolean notModified(WebRequest request, String version) {
        return request.checkNotModified("\"" + version + "\"");
    }

    @Operation(
            summary = "List builtin icons",
            description = "Returns the slugs usable as builtin page-icon values, plus the "
                    + "upstream source and license attribution. No authentication required.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Icon catalog returned")
            })
    @GetMapping
    public ResponseEntity<ApiResponse<DocumentIconCatalogResponse>> list(WebRequest request) {
        if (notModified(request, iconService.getCatalogVersion())) {
            return ResponseEntity.status(304).build();
        }
        List<String> names = List.copyOf(iconService.getSlugs());
        List<DocumentIconCategoryResponse> categories = iconService.getCategories().stream()
                .map(category -> new DocumentIconCategoryResponse(category.id(), category.label(), category.icons()))
                .toList();
        DocumentIconCatalogResponse catalog = new DocumentIconCatalogResponse(
                names, categories, DocumentIconService.CATALOG_SOURCE, DocumentIconService.CATALOG_LICENSE);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePublic())
                .eTag("\"" + iconService.getCatalogVersion() + "\"")
                .body(ApiResponse.ok(catalog));
    }

    @Operation(
            summary = "Load every builtin icon",
            description = "Returns all catalogued glyphs as slug to sanitized SVG text, "
                    + "plus the upstream source and license attribution, so the picker grid "
                    + "renders without one HTTP request per icon. No authentication required.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "Icon bundle returned")
            })
    @GetMapping("/bundle")
    public ResponseEntity<ApiResponse<DocumentIconBundleResponse>> bundle(WebRequest request) {
        if (notModified(request, iconService.getBundleVersion())) {
            return ResponseEntity.status(304).build();
        }
        DocumentIconBundleResponse bundle = new DocumentIconBundleResponse(
                iconService.getBundle(), DocumentIconService.CATALOG_SOURCE, DocumentIconService.CATALOG_LICENSE);
        return ResponseEntity.ok()
                .cacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePublic())
                .eTag("\"" + iconService.getBundleVersion() + "\"")
                .body(ApiResponse.ok(bundle));
    }

    @Operation(
            summary = "Load a builtin icon",
            description = "Returns the sanitized SVG for one catalogued icon. The files are "
                    + "currentColor glyphs, so they inherit the surrounding "
                    + "text color. No authentication required.",
            responses = {
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "200",
                        description = "SVG returned"),
                @io.swagger.v3.oas.annotations.responses.ApiResponse(
                        responseCode = "404",
                        description = "Unknown icon name")
            })
    @GetMapping("/{name}")
    public ResponseEntity<byte[]> load(@PathVariable String name, WebRequest request) {
        byte[] svg = iconService.loadSvg(name);
        if (notModified(request, iconService.getBundleVersion())) {
            return ResponseEntity.status(304).build();
        }
        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.parseMediaType("image/svg+xml"));
        // Glyphs are versioned by the bundle ETag with daily revalidation, so an
        // updated vendor file propagates. The sandbox CSP keeps the SVG inert
        // even if a proxy strips the content type.
        headers.setCacheControl(CacheControl.maxAge(1, TimeUnit.DAYS).cachePublic());
        headers.setETag("\"" + iconService.getBundleVersion() + "\"");
        headers.set("X-Content-Type-Options", "nosniff");
        headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
        return ResponseEntity.ok().headers(headers).body(svg);
    }
}
