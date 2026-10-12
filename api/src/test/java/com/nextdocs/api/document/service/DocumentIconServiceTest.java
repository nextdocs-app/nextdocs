package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

class DocumentIconServiceTest {

    private DocumentIconService service;

    @BeforeEach
    void setUp() {
        service = new DocumentIconService(new ObjectMapper());
        service.loadCatalog();
    }

    @Test
    void catalog_loadsFullVendoredSet() {
        assertEquals(995, service.getSlugs().size());
        assertTrue(service.isValidSlug("add-circle-bold"));
        assertTrue(service.isValidSlug("smiley-smile-1"));
    }

    @Test
    void catalog_groupsEveryIconIntoSections() {
        assertEquals(31, service.getCategories().size());
        DocumentIconService.IconCategory first = service.getCategories().get(0);
        assertEquals("interface-essential", first.id());
        assertEquals("Interface Essential", first.label());
        assertTrue(first.icons().contains("add-circle-bold"));
        long covered = service.getCategories().stream()
                .flatMap(category -> category.icons().stream())
                .count();
        assertEquals(service.getSlugs().size(), covered);
        assertTrue(service.getCategories().stream()
                .flatMap(category -> category.icons().stream())
                .allMatch(service::isValidSlug));
    }

    @Test
    void isValidSlug_rejectsUnknownAndMalformed() {
        assertTrue(!service.isValidSlug("no-such-icon"));
        assertTrue(!service.isValidSlug(null));
        assertTrue(!service.isValidSlug("../icons"));
        assertTrue(!service.isValidSlug("home.svg"));
        assertTrue(!service.isValidSlug(""));
    }

    @Test
    void bundle_coversEverySlugWithTheServedBytes() {
        assertEquals(service.getSlugs(), service.getBundle().keySet());
        String svg = service.getBundle().get("add-circle-bold");
        String served = new String(service.loadSvg("add-circle-bold"), java.nio.charset.StandardCharsets.UTF_8);
        assertEquals(served, svg);
        assertTrue(svg.strip().startsWith("<svg "));
    }

    @Test
    void loadSvg_returnsSanitizedGlyph() {
        byte[] svg = service.loadSvg("add-circle-bold");
        String text = new String(svg, java.nio.charset.StandardCharsets.UTF_8).strip();

        assertTrue(text.startsWith("<svg "));
        assertTrue(text.endsWith("</svg>"));
        // Glyphs paint with currentColor so they inherit the surrounding text color.
        assertTrue(text.contains("currentColor"));
        assertTrue(!text.contains("#000000"));
        // The xmlns declaration is the only URL left: no external references,
        // scripts, or event handlers survived vendoring.
        assertEquals(1, text.split("http", -1).length - 1, "unexpected external reference in vendored SVG");
        assertTrue(!text.toLowerCase().contains("script"));
        assertTrue(!text.contains("onload="));
    }

    @Test
    void loadSvg_unknownName_isNotFound() {
        ApiException ex = assertThrows(ApiException.class, () -> service.loadSvg("no-such-icon"));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }

    @Test
    void assertSvgSafe_rejectsActiveContent() {
        String open = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\">";
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe("evil", open + "<script>alert(1)</script></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe("evil", open + "<style>.a{fill:red}</style></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe("evil", open + "<animate attributeName=\"x\"/></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe("evil", open + "<use href=\"#a\"/></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe("evil", open + "<image href=\"x\"/></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe(
                        "evil", open + "<path d=\"M0 0h1\" onclick=\"evil()\"/></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe("evil", open + "<svg:script/></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe("evil", open + "<unknown-tag/></svg>"));
        assertThrows(
                IllegalStateException.class,
                () -> DocumentIconService.assertSvgSafe(
                        "evil", open + "<path d=\"M0 0h1\" style=\"fill:red\"/></svg>"));
    }

    @Test
    void loadSvg_returnsDefensiveCopy() {
        byte[] first = service.loadSvg("add-circle-bold");
        first[0] = (byte) 0x58;
        byte[] second = service.loadSvg("add-circle-bold");
        assertTrue(new String(second, java.nio.charset.StandardCharsets.UTF_8)
                .strip()
                .startsWith("<svg "));
    }

    @Test
    void loadSvg_traversal_isNotFound() {
        ApiException ex = assertThrows(ApiException.class, () -> service.loadSvg("../../etc/passwd"));
        assertEquals(ErrorCode.NOT_FOUND, ex.getErrorCode());
    }
}
