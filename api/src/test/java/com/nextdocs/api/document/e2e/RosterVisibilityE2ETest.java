package com.nextdocs.api.document.e2e;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.PostgresTestSupport;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.security.JwtTokenProvider;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The roster and sharing-settings visibility rule, over HTTP against PostgreSQL.
 *
 * <p>A workspace member whose only channel is a public link keeps their workspace identity:
 * they see the page's direct roster and its resolved sharing settings. A reader from another
 * workspace has the link but no identity here, so the same endpoints answer 404 instead of
 * leaking who can open the page. The service tests mock the permission gate, so only this
 * test pins the controller + resolver + SQL combination.
 *
 * <p>The schema is a throwaway migration schema, like the search end-to-end suite. H2 cannot
 * run {@code resolve_effective_access}, so this test must not fall back to it. The root
 * listing is covered here for the same reason: its access filter is a SQL function call.
 */
@SpringBootTest
@AutoConfigureMockMvc
class RosterVisibilityE2ETest {

    private static final String SCHEMA =
            "e2e_roster_" + UUID.randomUUID().toString().replace("-", "");

    @DynamicPropertySource
    static void postgres(DynamicPropertyRegistry registry) {
        String url = PostgresTestSupport.resolveUrl();
        String separator = url.contains("?") ? "&" : "?";
        registry.add("spring.datasource.url", () -> url + separator + "currentSchema=" + SCHEMA + ",public");
        registry.add("spring.datasource.username", PostgresTestSupport::resolveUsername);
        registry.add("spring.datasource.password", PostgresTestSupport::resolvePassword);
        registry.add("spring.flyway.enabled", () -> "true");
        registry.add("spring.flyway.schemas", () -> SCHEMA);
        registry.add("spring.flyway.default-schema", () -> SCHEMA);
        registry.add("spring.jpa.hibernate.ddl-auto", () -> "none");
        registry.add("app.search.enabled", () -> "false");
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
    private DocumentRepository documentRepository;

    @Autowired
    private SpaceRepository spaceRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository memberRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Test
    void workspaceMemberWithOnlyLinkAccessSeesTheRosterAndSettings() throws Exception {
        Workspace workspace = workspace("Roster visibility");
        Actor owner = actor("owner", workspace, WorkspaceRole.OWNER);
        Actor member = actor("member", workspace, WorkspaceRole.MEMBER);
        UUID documentId = createDocument(owner, "Link-only member");
        shareByLink(owner, documentId);

        // No grant and no workspace audience: VIEW can only come from the link.
        mockMvc.perform(get("/api/v1/documents/{id}/my-access", documentId).header("Authorization", bearer(member)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.allowed").value(true))
                .andExpect(jsonPath("$.data.accessLevel").value("VIEW"));

        mockMvc.perform(get("/api/v1/documents/{id}/collaborators", documentId).header("Authorization", bearer(member)))
                .andExpect(status().isOk())
                .andExpect(
                        jsonPath("$.data[0].userId").value(owner.user().getId().toString()));

        mockMvc.perform(get("/api/v1/documents/{id}/sharing", documentId).header("Authorization", bearer(member)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.generalAccessMode").value("ANYONE_WITH_LINK"))
                .andExpect(jsonPath("$.data.linkAccessLevel").value("VIEW"));
    }

    @Test
    void linkOnlyOutsiderCanOpenThePageButGets404ForRosterAndSettings() throws Exception {
        Workspace workspace = workspace("Roster home");
        Actor owner = actor("owner", workspace, WorkspaceRole.OWNER);
        Workspace otherWorkspace = workspace("Roster elsewhere");
        Actor outsider = actor("outsider", otherWorkspace, WorkspaceRole.MEMBER);
        UUID documentId = createDocument(owner, "Link-only outsider");
        shareByLink(owner, documentId);

        // Prove the link is a real access channel first, so a 404 below is the roster mask
        // and not merely "this page was never readable".
        mockMvc.perform(get("/api/v1/documents/{id}/my-access", documentId).header("Authorization", bearer(outsider)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.allowed").value(true))
                .andExpect(jsonPath("$.data.accessLevel").value("VIEW"));

        mockMvc.perform(get("/api/v1/documents/{id}/collaborators", documentId)
                        .header("Authorization", bearer(outsider)))
                .andExpect(status().isNotFound());

        mockMvc.perform(get("/api/v1/documents/{id}/sharing", documentId).header("Authorization", bearer(outsider)))
                .andExpect(status().isNotFound());
    }

    @Test
    void rootListingResolvesAccessInSqlAndOmitsLinkOnlyReads() throws Exception {
        Workspace workspace = workspace("Root listing");
        Actor owner = actor("owner", workspace, WorkspaceRole.OWNER);
        Actor member = actor("member", workspace, WorkspaceRole.MEMBER);
        UUID documentId = createDocument(owner, "Root listing page");
        shareByLink(owner, documentId);

        // The owner reaches the page through their OWNER grant; the listing query resolves
        // that level in SQL before pagination.
        mockMvc.perform(get("/api/v1/documents")
                        .param("parentId", "root")
                        .param("scope", "all")
                        .header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content[0].id").value(documentId.toString()));

        // A link is a separate channel: it opens the page, but it does not file the page
        // into the member's Private or Shared navigation.
        mockMvc.perform(get("/api/v1/documents")
                        .param("parentId", "root")
                        .param("scope", "all")
                        .header("Authorization", bearer(member)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content").isEmpty());
    }

    @Test
    void rootListingOmitsPagesFiledIntoASpace() throws Exception {
        Workspace workspace = workspace("Root listing spaces");
        Actor owner = actor("owner", workspace, WorkspaceRole.OWNER);
        UUID standaloneId = createDocument(owner, "Standalone root");
        UUID spacePageId = createDocument(owner, "Space page");

        Space space = spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build());
        Document spacePage = documentRepository.findById(spacePageId).orElseThrow();
        spacePage.setSpace(space);
        spacePage.setSiblingOrderKey("a0");
        documentRepository.saveAndFlush(spacePage);

        // The all-roots listing is for pages outside spaces; the space page is reached
        // through the space listing instead.
        mockMvc.perform(get("/api/v1/documents")
                        .param("parentId", "root")
                        .param("scope", "all")
                        .header("Authorization", bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.content.length()").value(1))
                .andExpect(jsonPath("$.data.content[0].id").value(standaloneId.toString()));
    }

    private Workspace workspace(String name) {
        return workspaceRepository.saveAndFlush(Workspace.builder().name(name).build());
    }

    private Actor actor(String role, Workspace workspace, WorkspaceRole workspaceRole) {
        String suffix = UUID.randomUUID().toString();
        User user = userRepository.saveAndFlush(User.builder()
                .email(role + "-" + suffix + "@example.com")
                .displayName(role)
                .passwordHash("$2a$12$hash")
                .build());
        memberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(workspaceRole)
                .build());
        return new Actor(user, jwtTokenProvider.generateAccessToken(user.getId(), user.getEmail()));
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

    private void shareByLink(Actor actor, UUID documentId) throws Exception {
        mockMvc.perform(patch("/api/v1/documents/{id}/sharing", documentId)
                        .header("Authorization", bearer(actor))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"generalAccessMode\":\"ANYONE_WITH_LINK\",\"linkAccessLevel\":\"VIEW\"}"))
                .andExpect(status().isOk());
    }

    private static String bearer(Actor actor) {
        return "Bearer " + actor.token();
    }

    private record Actor(User user, String token) {}
}
