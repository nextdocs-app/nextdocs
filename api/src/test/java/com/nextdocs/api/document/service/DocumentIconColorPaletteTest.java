package com.nextdocs.api.document.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;

/**
 * The icon palette is written down three times: the validator's accepted set, the
 * {@code chk_documents_icon_color} list in {@code V18}, and the picker's list on the
 * web. Nothing at runtime ties them together, and the drift is quiet in both
 * directions: a key added to the validator but missing from the migration fails every
 * write with a constraint violation, and one missing from the web list renders as the
 * default color with no error at all. This test turns either into a build failure.
 */
class DocumentIconColorPaletteTest {

    private static final String MIGRATION_RESOURCE = "db/migration/V18__document_icon_color.sql";

    /**
     * The picker's palette. The API never consumes it, so the path is resolved
     * relative to this module and, failing that, to the repository root, which is
     * the working directory when Maven runs with an explicit {@code -f}.
     */
    private static final List<Path> WEB_PALETTE_CANDIDATES = List.of(
            Path.of("..", "web", "lib", "document-icon.util.ts"), Path.of("web", "lib", "document-icon.util.ts"));

    private static final Pattern SQL_COLOR = Pattern.compile("'([a-z]+)'");
    private static final Pattern WEB_COLOR = Pattern.compile("id:\\s*'([^']+)'");

    @Test
    void paletteAgreesAcrossValidatorMigrationAndWeb() throws IOException {
        Set<String> validator = DocumentIconCoverApplier.ALLOWED_ICON_COLORS;
        Set<String> migration = paletteOf(readMigration(), "chk_documents_icon_color", SQL_COLOR);
        Set<String> web = paletteOf(readWebPalette(), "ICON_COLORS", WEB_COLOR);

        // Guard the extraction itself: a refactor that stops matching has to fail here
        // rather than quietly compare two empty sets.
        assertThat(validator).isNotEmpty();
        assertThat(migration).isNotEmpty();
        assertThat(web).isNotEmpty();

        // "default" is a real choice: the picker offers it and the validator accepts
        // it, then normalizes it to NULL before the row is written. It is therefore
        // absent from the migration, which holds only storable keys.
        assertThat(validator).contains("default");
        assertThat(web).contains("default");
        assertThat(migration).doesNotContain("default");
        assertThat(web).isEqualTo(validator);

        Set<String> storable =
                validator.stream().filter(color -> !"default".equals(color)).collect(Collectors.toSet());
        assertThat(migration).isEqualTo(storable);
    }

    /** Palette named from {@code marker} onward, so unrelated quoted text cannot leak in. */
    private static Set<String> paletteOf(String source, String marker, Pattern pattern) {
        int from = source.indexOf(marker);
        if (from < 0) {
            throw new IllegalStateException("Palette marker is gone from the source: " + marker);
        }
        Set<String> palette = new LinkedHashSet<>();
        Matcher matcher = pattern.matcher(source.substring(from));
        while (matcher.find()) {
            palette.add(matcher.group(1));
        }
        return palette;
    }

    private static String readMigration() throws IOException {
        try (InputStream in =
                DocumentIconColorPaletteTest.class.getClassLoader().getResourceAsStream(MIGRATION_RESOURCE)) {
            if (in == null) {
                throw new IllegalStateException("Migration is missing from the test classpath: " + MIGRATION_RESOURCE);
            }
            return new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    private static String readWebPalette() throws IOException {
        for (Path candidate : WEB_PALETTE_CANDIDATES) {
            Path absolute = candidate.toAbsolutePath().normalize();
            if (Files.isReadable(absolute)) {
                return Files.readString(absolute, StandardCharsets.UTF_8);
            }
        }
        throw new IllegalStateException("Web icon palette is unreadable; tried "
                + WEB_PALETTE_CANDIDATES.stream()
                        .map(path -> path.toAbsolutePath().normalize().toString())
                        .collect(Collectors.joining(", ")));
    }
}
