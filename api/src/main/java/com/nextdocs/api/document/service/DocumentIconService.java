package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.validation.IconCatalog;
import com.nextdocs.api.document.validation.IconSlugs;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import lombok.Getter;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

/**
 * Serves the builtin page-icon catalog from files vendored under
 * {@code src/main/resources/icons} (see that directory's README).
 *
 * <p>SVGs are loaded once at startup so a missing or unreadable file fails the
 * boot instead of surfacing as a 500 on first render, and per-request serving
 * is a map lookup. The set is small (under a thousand currentColor glyphs).
 *
 * <p>Source files live under {@code src/main/resources/icons} alongside the
 * upstream license and a machine-readable name list carrying the attribution.
 */
@Service
public class DocumentIconService implements IconCatalog {

    public static final String CATALOG_SOURCE = "https://www.streamlinehq.com/icons/ultimate-bold-free";
    public static final String CATALOG_LICENSE =
            "CC BY 4.0 by Streamline (https://creativecommons.org/licenses/by/4.0/)";

    /** One picker section: the category id keys the section, icons are catalog slugs in display order. */
    public record IconCategory(String id, String label, List<String> icons) {}

    private final ObjectMapper objectMapper;

    @Getter
    private Set<String> slugs = Set.of();

    @Getter
    private List<IconCategory> categories = List.of();

    private Map<String, byte[]> svgBySlug = Map.of();

    /**
     * All glyphs as slug to SVG text, decoded once at startup from the same
     * bytes served per glyph. Backs the single-request bundle download so the
     * picker grid renders without one HTTP request per icon.
     */
    @Getter
    private Map<String, String> bundle = Map.of();

    /**
     * SHA-256 over the sorted bundle bytes, exposed as the HTTP ETag for the
     * bundle and glyph endpoints (both serve exactly these bytes).
     */
    @Getter
    private String bundleVersion = "missing";

    /**
     * SHA-256 over the catalog representation (names plus categories), exposed
     * as the ETag for the list endpoint. Separate from the bundle hash: a
     * recategorization changes the list JSON without touching any glyph bytes,
     * and sharing one hash would 304 a changed catalog.
     */
    @Getter
    private String catalogVersion = "missing";

    public DocumentIconService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    @PostConstruct
    void loadCatalog() {
        JsonNode catalog = readJson("icons/icons.json");
        JsonNode names = catalog.get("names");
        if (names == null || !names.isArray() || names.isEmpty()) {
            throw new IllegalStateException("Builtin icon catalog is missing its name list.");
        }
        Map<String, byte[]> loaded = new LinkedHashMap<>();
        for (JsonNode name : names) {
            String slug = name.asString();
            if (!IconSlugs.isWellFormed(slug)) {
                throw new IllegalStateException("Builtin icon catalog contains an invalid slug: " + slug);
            }
            loaded.put(slug, readSvg(slug));
        }
        slugs = Collections.unmodifiableSet(loaded.keySet());
        svgBySlug = Collections.unmodifiableMap(loaded);
        categories = loadCategories(catalog, loaded.keySet());
        Map<String, String> decoded = new LinkedHashMap<>();
        loaded.forEach((slug, bytes) -> decoded.put(slug, new String(bytes, StandardCharsets.UTF_8)));
        bundle = Collections.unmodifiableMap(decoded);
        bundleVersion = computeBundleVersion(loaded);
        catalogVersion = computeCatalogVersion(catalog);
    }

    private static String computeBundleVersion(Map<String, byte[]> loaded) {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            loaded.entrySet().stream().sorted(Map.Entry.comparingByKey()).forEach(entry -> {
                digest.update(entry.getKey().getBytes(StandardCharsets.UTF_8));
                digest.update((byte) 0);
                digest.update(entry.getValue());
                digest.update((byte) 0);
            });
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable in this JVM.", ex);
        }
    }

    private static String computeCatalogVersion(JsonNode catalog) {
        try {
            var digest = java.security.MessageDigest.getInstance("SHA-256");
            digest.update(catalog.toString().getBytes(StandardCharsets.UTF_8));
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (java.security.NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is unavailable in this JVM.", ex);
        }
    }

    private static List<IconCategory> loadCategories(JsonNode catalog, Set<String> slugs) {
        JsonNode categories = catalog.get("categories");
        if (categories == null || !categories.isArray() || categories.isEmpty()) {
            throw new IllegalStateException("Builtin icon catalog is missing its category list.");
        }
        List<IconCategory> parsed = new ArrayList<>();
        Set<String> categorized = new HashSet<>();
        for (JsonNode category : categories) {
            JsonNode id = category.get("id");
            JsonNode label = category.get("label");
            JsonNode icons = category.get("icons");
            String categoryId = id != null ? id.asString() : null;
            if (!IconSlugs.isWellFormed(categoryId)) {
                throw new IllegalStateException("Builtin icon catalog contains an invalid category id: " + categoryId);
            }
            String categoryLabel = label != null ? label.asString().strip() : "";
            if (categoryLabel.isEmpty()) {
                throw new IllegalStateException("Builtin icon catalog category is missing its label: " + categoryId);
            }
            if (icons == null || !icons.isArray() || icons.isEmpty()) {
                throw new IllegalStateException("Builtin icon catalog category is empty: " + categoryId);
            }
            List<String> members = new ArrayList<>();
            for (JsonNode icon : icons) {
                String slug = icon.asString();
                if (!slugs.contains(slug)) {
                    throw new IllegalStateException(
                            "Builtin icon catalog category references an unknown icon: " + slug);
                }
                if (!categorized.add(slug)) {
                    throw new IllegalStateException("Builtin icon catalog lists an icon twice: " + slug);
                }
                members.add(slug);
            }
            parsed.add(new IconCategory(categoryId, categoryLabel, List.copyOf(members)));
        }
        if (!categorized.equals(slugs)) {
            throw new IllegalStateException("Builtin icon catalog categories do not cover every icon.");
        }
        return List.copyOf(parsed);
    }

    /** Whether {@code slug} names a catalogued icon. Malformed input is simply invalid, never an error. */
    @Override
    public boolean isValidSlug(String slug) {
        return slug != null && slugs.contains(slug);
    }

    /**
     * Sanitized SVG bytes for {@code slug}, or throws NOT_FOUND for unknown names.
     * Returns a defensive copy: callers receive the stored array itself would let
     * one accidental mutation corrupt every later response.
     */
    public byte[] loadSvg(String slug) {
        byte[] svg = IconSlugs.isWellFormed(slug) ? svgBySlug.get(slug) : null;
        if (svg == null) {
            throw new ApiException(ErrorCode.NOT_FOUND);
        }
        return svg.clone();
    }

    private JsonNode readJson(String path) {
        try (InputStream in = new ClassPathResource(path).getInputStream()) {
            return objectMapper.readTree(in);
        } catch (IOException ex) {
            throw new IllegalStateException("Builtin icon catalog is unreadable: " + path, ex);
        }
    }

    // Lowercase: extracted names are lowercased before comparison so camelCase
    // source attributes (viewBox, clipPath) match.
    private static final Set<String> SAFE_SVG_TAGS = Set.of(
            "svg",
            "g",
            "path",
            "circle",
            "rect",
            "line",
            "polyline",
            "polygon",
            "ellipse",
            "defs",
            "clippath",
            "title",
            "desc");

    private static final Set<String> SAFE_SVG_ATTRS = Set.of(
            "xmlns",
            "viewbox",
            "d",
            "fill",
            "stroke",
            "stroke-width",
            "stroke-linecap",
            "stroke-linejoin",
            "fill-rule",
            "clip-rule",
            "cx",
            "cy",
            "r",
            "x",
            "y",
            "x1",
            "y1",
            "x2",
            "y2",
            "points",
            "transform",
            "opacity",
            "id",
            "width",
            "height",
            "clip-path");

    private static final Pattern TAG_PATTERN = Pattern.compile("<([a-zA-Z][a-zA-Z0-9-]*)[\\s/>]");
    private static final Pattern ATTR_PATTERN = Pattern.compile("([a-zA-Z-]+)\\s*=");
    private static final Pattern EVENT_HANDLER_PATTERN = Pattern.compile("on\\w+\\s*=");
    private static final Pattern NAMESPACED_TAG_PATTERN = Pattern.compile("<[a-zA-Z]+:");

    private static byte[] readSvg(String slug) {
        try (InputStream in = new ClassPathResource("icons/svg/" + slug + ".svg").getInputStream()) {
            byte[] bytes = in.readAllBytes();
            if (bytes.length == 0) {
                throw new IllegalStateException("Builtin icon SVG is empty: " + slug);
            }
            // Vendored files are sanitized ASCII; fail fast if one is not.
            // Allowlist validation below makes vendor-time sanitization
            // self-enforcing: a regenerated file that reintroduces scripts,
            // styles, animation, external references, or event handlers fails
            // the boot instead of reaching clients.
            String text = new String(bytes, StandardCharsets.UTF_8).strip();
            if (!text.startsWith("<svg ") || !text.endsWith("</svg>")) {
                throw new IllegalStateException("Builtin icon SVG has an unexpected shape: " + slug);
            }
            assertSvgSafe(slug, text);
            return bytes;
        } catch (IOException ex) {
            throw new IllegalStateException("Builtin icon SVG is unreadable: " + slug, ex);
        }
    }

    static void assertSvgSafe(String slug, String text) {
        String lower = text.toLowerCase(java.util.Locale.ROOT);
        if (lower.contains("<script")
                || lower.contains("<style")
                || lower.contains("<iframe")
                || lower.contains("<object")
                || lower.contains("<embed")
                || lower.contains("<form")
                || lower.contains("<image")
                || lower.contains("<use")
                || lower.contains("<animate")
                || lower.contains("<set")
                || lower.contains("foreignobject")
                || lower.contains("href")
                || lower.contains("xlink")
                || lower.contains("src=")
                || lower.contains("javascript:")
                || lower.contains("data:")
                || lower.contains("vbscript:")
                || lower.contains("expression(")
                || lower.contains("url(")
                || EVENT_HANDLER_PATTERN.matcher(lower).find()
                || NAMESPACED_TAG_PATTERN.matcher(text).find()) {
            throw new IllegalStateException("Builtin icon SVG contains active content: " + slug);
        }
        var tagMatcher = TAG_PATTERN.matcher(text);
        while (tagMatcher.find()) {
            String tag = tagMatcher.group(1).toLowerCase(java.util.Locale.ROOT);
            if (!SAFE_SVG_TAGS.contains(tag)) {
                throw new IllegalStateException("Builtin icon SVG contains an unexpected tag <" + tag + ">: " + slug);
            }
        }
        var attrMatcher = ATTR_PATTERN.matcher(text);
        while (attrMatcher.find()) {
            String attr = attrMatcher.group(1).toLowerCase(java.util.Locale.ROOT);
            if (!SAFE_SVG_ATTRS.contains(attr)) {
                throw new IllegalStateException(
                        "Builtin icon SVG contains an unexpected attribute " + attr + ": " + slug);
            }
        }
    }
}
