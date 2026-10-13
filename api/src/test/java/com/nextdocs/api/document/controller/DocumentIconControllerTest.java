package com.nextdocs.api.document.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.service.DocumentIconService;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(DocumentIconController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class DocumentIconControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DocumentIconService iconService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private UserRepository userRepository;

    @Test
    @DisplayName("Anonymous callers get the catalog with attribution without a 401")
    void list_isPublicAndCarriesAttribution() throws Exception {
        when(iconService.getSlugs()).thenReturn(Set.of("add-circle-bold"));
        when(iconService.getCategories())
                .thenReturn(List.of(new DocumentIconService.IconCategory(
                        "interface-essential", "Interface Essential", List.of("add-circle-bold"))));

        mockMvc.perform(get(DocumentIconController.LIST_PATH))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.names[0]").value("add-circle-bold"))
                .andExpect(jsonPath("$.data.categories[0].id").value("interface-essential"))
                .andExpect(jsonPath("$.data.categories[0].label").value("Interface Essential"))
                .andExpect(jsonPath("$.data.categories[0].icons[0]").value("add-circle-bold"))
                .andExpect(jsonPath("$.data.source").value(DocumentIconService.CATALOG_SOURCE))
                .andExpect(jsonPath("$.data.license").value(DocumentIconService.CATALOG_LICENSE))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("public")));
    }

    @Test
    @DisplayName("Anonymous callers get the glyph bundle with attribution without a 401")
    void bundle_isPublicAndCarriesAttribution() throws Exception {
        when(iconService.getBundle()).thenReturn(Map.of("add-circle-bold", "<svg></svg>"));

        mockMvc.perform(get(DocumentIconController.BUNDLE_PATH))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.icons['add-circle-bold']").value("<svg></svg>"))
                .andExpect(jsonPath("$.data.source").value(DocumentIconService.CATALOG_SOURCE))
                .andExpect(jsonPath("$.data.license").value(DocumentIconService.CATALOG_LICENSE))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("public")));
    }

    @Test
    @DisplayName("Anonymous callers get a glyph with daily caching and inert-svg headers")
    void load_isPublicWithSafeHeaders() throws Exception {
        byte[] svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 16 16\"></svg>"
                .getBytes(StandardCharsets.UTF_8);
        when(iconService.loadSvg("add-circle-bold")).thenReturn(svg);

        mockMvc.perform(get(DocumentIconController.SVG_PATH, "add-circle-bold"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/svg+xml"))
                .andExpect(header().string("Cache-Control", org.hamcrest.Matchers.containsString("public")))
                .andExpect(header().string(
                                "Cache-Control",
                                org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("immutable"))))
                .andExpect(header().string("X-Content-Type-Options", "nosniff"))
                .andExpect(header().string("Content-Security-Policy", "default-src 'none'; sandbox"))
                .andExpect(content().bytes(svg));
    }

    @Test
    @DisplayName("Unknown glyphs are 404, not 500")
    void load_unknownName_returns404() throws Exception {
        when(iconService.loadSvg("nope")).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get(DocumentIconController.SVG_PATH, "nope")).andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("Unknown glyphs are 404 even with a matching If-None-Match")
    void load_unknownNameWithEtag_returns404() throws Exception {
        when(iconService.getBundleVersion()).thenReturn("bundle-hash");
        when(iconService.loadSvg("nope")).thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        mockMvc.perform(get(DocumentIconController.SVG_PATH, "nope").header("If-None-Match", "\"bundle-hash\""))
                .andExpect(status().isNotFound());
    }

    @Test
    @DisplayName("Matching If-None-Match returns 304 with the ETag on every representation")
    void conditionalGet_matchingEtag_returns304() throws Exception {
        when(iconService.getCatalogVersion()).thenReturn("catalog-hash");
        when(iconService.getBundleVersion()).thenReturn("bundle-hash");
        when(iconService.loadSvg("add-circle-bold")).thenReturn("<svg></svg>".getBytes(StandardCharsets.UTF_8));

        mockMvc.perform(get(DocumentIconController.LIST_PATH).header("If-None-Match", "\"catalog-hash\""))
                .andExpect(status().isNotModified())
                .andExpect(header().string("ETag", "\"catalog-hash\""));

        mockMvc.perform(get(DocumentIconController.BUNDLE_PATH).header("If-None-Match", "\"bundle-hash\""))
                .andExpect(status().isNotModified())
                .andExpect(header().string("ETag", "\"bundle-hash\""));

        mockMvc.perform(get(DocumentIconController.SVG_PATH, "add-circle-bold")
                        .header("If-None-Match", "\"bundle-hash\""))
                .andExpect(status().isNotModified())
                .andExpect(header().string("ETag", "\"bundle-hash\""));
    }

    @Test
    @DisplayName("Weak and list validators 304 too, not just an exact match")
    void conditionalGet_nonExactValidator_returns304() throws Exception {
        when(iconService.getBundleVersion()).thenReturn("bundle-hash");

        // A CDN or an aggregating client sends these shapes; an exact string
        // comparison would re-send the ~830KB bundle to both.
        mockMvc.perform(get(DocumentIconController.BUNDLE_PATH).header("If-None-Match", "\"other\", W/\"bundle-hash\""))
                .andExpect(status().isNotModified());

        mockMvc.perform(get(DocumentIconController.BUNDLE_PATH).header("If-None-Match", "W/\"bundle-hash\""))
                .andExpect(status().isNotModified());
    }

    @Test
    @DisplayName("Mismatched ETag returns 200 with the ETag")
    void conditionalGet_mismatchedEtag_returns200() throws Exception {
        when(iconService.getCatalogVersion()).thenReturn("catalog-hash");
        when(iconService.getSlugs()).thenReturn(Set.of("add-circle-bold"));
        when(iconService.getCategories()).thenReturn(List.of());

        mockMvc.perform(get(DocumentIconController.LIST_PATH).header("If-None-Match", "\"stale\""))
                .andExpect(status().isOk())
                .andExpect(header().string("ETag", "\"catalog-hash\""));
    }
}
