package com.nextdocs.api.search.e2e;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.PostgresTestSupport;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.document.entity.AccessGrant;
import com.nextdocs.api.document.entity.AccessGrantEffect;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.AccessGrantRepository;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * End-to-end coverage of search against a real PostgreSQL database and the real migration
 * set. The unit and {@code @WebMvcTest} suites mock the repository, so they cannot see the
 * cross-layer contract this class pins: the write paths (create, rename, content-updated)
 * producing a projection the read path can actually rank, and the reconcile crawl agreeing
 * with that projection.
 *
 * <p>Each test gets its own workspace inside a throwaway schema, and the Flyway migration
 * that creates the projection runs for real. H2 never sees this code.
 */
@SpringBootTest
@AutoConfigureMockMvc
class SearchBackendE2ETest {

    private static final String SCHEMA =
            "e2e_search_" + UUID.randomUUID().toString().replace("-", "");

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        String url = PostgresTestSupport.resolveUrl();
        String separator = url.contains("?") ? "&" : "?";
        // public stays on the path so the unaccent dictionary resolves from this schema.
        registry.add("spring.datasource.url", () -> url + separator + "currentSchema=" + SCHEMA + ",public");
        registry.add("spring.datasource.username", PostgresTestSupport::resolveUsername);
        registry.add("spring.datasource.password", PostgresTestSupport::resolvePassword);
        // The migrations own the schema here, exactly as in production.
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.flyway.default-schema", () -> SCHEMA);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("app.search.enabled", () -> "true");
        // The background crawl must not race the assertions; the reconcile suite drives it.
        registry.add("app.search.reconcile-initial-delay-ms", () -> "3600000");
        registry.add("app.yhub.purge-interval-ms", () -> "3600000");
    }

    @AfterAll
    static void dropSchema() throws SQLException {
        try (Connection connection = PostgresTestSupport.connect(
                        PostgresTestSupport.resolveUrl(),
                        PostgresTestSupport.resolveUsername(),
                        PostgresTestSupport.resolvePassword());
                Statement statement = connection.createStatement()) {
            statement.execute("DROP SCHEMA IF EXISTS " + SCHEMA + " CASCADE");
        }
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository memberRepository;

    @Autowired
    private AccessGrantRepository accessGrantRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private DocumentSearchRepository searchRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private NamedParameterJdbcTemplate jdbc;

    @Value("${app.yhub.service-token}")
    private String serviceToken;

    @Test
    void aNewPageIsSearchableByTitleBeforeItsBodyIsIndexed() throws Exception {
        Actor owner = owner();
        UUID documentId = createDocument(owner, "Quarterly planning");

        // The title listener wrote a title-only row: no body has been read from Yhub yet.
        assertThat(indexedAt(documentId)).isNull();

        mockMvc.perform(get("/api/v1/search/suggest").param("q", "quarter").header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].documentId").value(documentId.toString()));

        mockMvc.perform(get("/api/v1/search").param("q", "quarterly").header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].documentId").value(documentId.toString()))
                // Matched the live title, so there is no indexed snippet to return.
                .andExpect(jsonPath("$.data.items[0].snippet").isEmpty());
    }

    @Test
    void aContentUpdateIndexesTheBodyAndLeavesTheCrawlNothingToDo() throws Exception {
        Actor owner = owner();
        UUID documentId = createDocument(owner, "Launch notes");

        contentUpdated(documentId, "forecast budget approved", false);

        mockMvc.perform(get("/api/v1/search").param("q", "forecast").header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].documentId").value(documentId.toString()));

        // The projection carries the same document version as the sort key. If it were
        // stamped later (or the sort key earlier), every edit would look stale and the
        // crawl would re-extract pages that were just indexed.
        assertThat(indexedAt(documentId)).isAfterOrEqualTo(updatedAt(documentId));
        assertThat(searchRepository.selectStaleAfter(null, 10_000)).doesNotContain(documentId);
    }

    @Test
    void aReindexRepairsAMissedExtractionWithoutMovingTheSortKey() throws Exception {
        Actor owner = owner();
        UUID documentId = createDocument(owner, "Extraction gap");

        // A compaction that produced no text: the sort key moves, the body does not.
        contentUpdated(documentId, null, false);
        assertThat(searchRepository.selectStaleAfter(null, 10_000)).contains(documentId);

        OffsetDateTime sortKeyBeforeReindex = updatedAt(documentId);

        // The crawl's re-read: it indexes but must not count as an edit, or the document
        // would be newer than its own projection on every pass and the crawl never ends.
        contentUpdated(documentId, "recovered body", true);

        assertThat(updatedAt(documentId)).isEqualTo(sortKeyBeforeReindex);
        assertThat(indexedAt(documentId)).isAfterOrEqualTo(sortKeyBeforeReindex);
        assertThat(searchRepository.selectStaleAfter(null, 10_000)).doesNotContain(documentId);
    }

    @Test
    void aRenameUpdatesTheTitleAndKeepsTheIndexedBody() throws Exception {
        Actor owner = owner();
        UUID documentId = createDocument(owner, "Original title");
        contentUpdated(documentId, "body about budgets", false);

        mockMvc.perform(patch("/api/v1/documents/{id}", documentId)
                        .header("Authorization", bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"title\":\"Renamed title\"}"))
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/v1/search").param("q", "renamed").header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].documentId").value(documentId.toString()));

        // The title vector is rebuilt from documents.title, so the old title no longer
        // matches...
        mockMvc.perform(get("/api/v1/search").param("q", "original").header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty());
        // ...while the body projection survives the rename.
        mockMvc.perform(get("/api/v1/search").param("q", "budgets").header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].documentId").value(documentId.toString()));
    }

    @Test
    void aGrantAndRevokeChangeVisibilityWithoutReindexing() throws Exception {
        Actor owner = owner();
        Actor member = member(owner.workspace());
        UUID documentId = createDocument(owner, "Restricted plan");
        contentUpdated(documentId, "hidden roadmap", false);

        // The page is RESTRICTED, so a workspace member resolves no access to it.
        assertSearchEmpty(member, "roadmap");

        AccessGrant grant = accessGrantRepository.saveAndFlush(AccessGrant.builder()
                .workspace(owner.workspace())
                .document(documentRepository.getReferenceById(documentId))
                .user(member.user())
                .effect(AccessGrantEffect.ALLOW)
                .accessLevel(DocumentAccessLevel.VIEW)
                .createdBy(owner.user())
                .build());

        assertSearchHits(member, "roadmap", documentId);

        accessGrantRepository.delete(grant);
        accessGrantRepository.flush();

        // Same projection row, different ACL: the resolver runs inside the query, so no
        // reindex is needed for a revoke to take effect.
        assertSearchEmpty(member, "roadmap");
        assertSearchHits(owner, "roadmap", documentId);
    }

    @Test
    void aTrashedPageDropsOutOfSearch() throws Exception {
        Actor owner = owner();
        UUID documentId = createDocument(owner, "Obsolete plan");
        contentUpdated(documentId, "obsolete body", false);

        assertSearchHits(owner, "obsolete", documentId);

        mockMvc.perform(delete("/api/v1/documents/{id}", documentId).header("Authorization", bearer(owner)))
                .andExpect(status().isNoContent());

        assertSearchEmpty(owner, "obsolete");
    }

    private Actor owner() {
        String suffix = UUID.randomUUID().toString();
        User user = userRepository.saveAndFlush(User.builder()
                .email("owner-" + suffix + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("Search e2e").build());
        memberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(WorkspaceRole.OWNER)
                .build());
        return new Actor(user, workspace, jwtTokenProvider.generateAccessToken(user.getId(), user.getEmail()));
    }

    private Actor member(Workspace workspace) {
        String suffix = UUID.randomUUID().toString();
        User user = userRepository.saveAndFlush(User.builder()
                .email("member-" + suffix + "@example.com")
                .displayName("Member")
                .passwordHash("$2a$12$hash")
                .build());
        memberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(WorkspaceRole.MEMBER)
                .build());
        return new Actor(user, workspace, jwtTokenProvider.generateAccessToken(user.getId(), user.getEmail()));
    }

    private UUID createDocument(Actor actor, String title) throws Exception {
        UUID documentId = UUID.randomUUID();
        mockMvc.perform(post("/api/v1/documents")
                        .header("Authorization", bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"" + documentId + "\",\"title\":\"" + title + "\"}"))
                .andExpect(status().isCreated());
        return documentId;
    }

    /**
     * Mirrors what the realtime service sends: a text-less compaction omits the body
     * entirely and carries only the query parameter.
     */
    private void contentUpdated(UUID documentId, String text, boolean reindex) throws Exception {
        String body = text == null
                ? (reindex ? "{\"documentId\":\"" + documentId + "\",\"reindex\":true}" : null)
                : "{\"documentId\":\"" + documentId + "\",\"text\":\"" + text + "\",\"reindex\":" + reindex + "}";
        var request = post("/api/v1/internal/realtime/content-updated")
                .param("documentId", documentId.toString())
                .header("X-Yhub-Service", serviceToken);
        if (body != null) {
            request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        mockMvc.perform(request).andExpect(status().isOk());
    }

    private void assertSearchHits(Actor actor, String query, UUID documentId) throws Exception {
        mockMvc.perform(get("/api/v1/search").param("q", query).header("Authorization", bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items[0].documentId").value(documentId.toString()));
    }

    private void assertSearchEmpty(Actor actor, String query) throws Exception {
        mockMvc.perform(get("/api/v1/search").param("q", query).header("Authorization", bearer(actor)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.items").isEmpty());
    }

    private OffsetDateTime indexedAt(UUID documentId) {
        return jdbc.queryForObject(
                "SELECT indexed_at FROM document_search WHERE document_id = :id",
                Map.of("id", documentId),
                OffsetDateTime.class);
    }

    private OffsetDateTime updatedAt(UUID documentId) {
        return jdbc.queryForObject(
                "SELECT updated_at FROM documents WHERE id = :id", Map.of("id", documentId), OffsetDateTime.class);
    }

    private static String bearer(Actor actor) {
        return "Bearer " + actor.token();
    }

    private record Actor(User user, Workspace workspace, String token) {}
}
