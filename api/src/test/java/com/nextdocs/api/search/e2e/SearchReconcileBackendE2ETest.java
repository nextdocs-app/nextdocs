package com.nextdocs.api.search.e2e;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.PostgresTestSupport;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.realtime.client.YhubClient;
import com.nextdocs.api.search.config.SearchProperties;
import com.nextdocs.api.search.repository.DocumentSearchRepository;
import com.nextdocs.api.search.schedule.DocumentSearchReconcileJob;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.sun.net.httpserver.HttpServer;
import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.ObjectMapper;

/**
 * End-to-end coverage of the reconcile crawl against real PostgreSQL and a stand-in
 * realtime service on a loopback port.
 *
 * <p>The unit test mocks the repository and the client, so it cannot catch the failure
 * this class exists for: choosing documents in Postgres, then asking the real HTTP client
 * to re-extract them with a batch size the realtime service accepts. A crawler that
 * batches over that cap is rejected wholesale, and the documents it exists to repair are
 * never repaired.
 */
@SpringBootTest
@AutoConfigureMockMvc
class SearchReconcileBackendE2ETest {

    private static final String SCHEMA =
            "e2e_reindex_" + UUID.randomUUID().toString().replace("-", "");
    private static final BlockingQueue<CapturedCall> CALLS = new LinkedBlockingQueue<>();
    private static final AtomicBoolean FAIL_EVERY_CALL = new AtomicBoolean(false);

    private static HttpServer realtime;

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
        registry.add("app.search.enabled", () -> "true");
        // This suite drives the crawl itself; the scheduled bean must stay out of the way.
        registry.add("app.search.reconcile-interval-ms", () -> "3600000");
        registry.add("app.search.reconcile-initial-delay-ms", () -> "3600000");
        registry.add("app.yhub.purge-interval-ms", () -> "3600000");
    }

    @BeforeAll
    static void startRealtime() throws IOException {
        realtime = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        realtime.createContext("/api/search-reindex/v1/nextdocs", exchange -> {
            String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            CALLS.add(new CapturedCall(exchange.getRequestHeaders().getFirst("Authorization"), body));
            exchange.sendResponseHeaders(FAIL_EVERY_CALL.get() ? 500 : 200, -1);
            exchange.close();
        });
        realtime.start();
    }

    @AfterAll
    static void stopRealtime() throws SQLException {
        if (realtime != null) {
            realtime.stop(0);
        }
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
    private DocumentSearchRepository searchRepository;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private ObjectMapper objectMapper;

    @Value("${app.yhub.service-token}")
    private String serviceToken;

    @Test
    void theCrawlSendsStaleIdsInBoundedBatchesAndRetriesAFailedPass() throws Exception {
        Actor owner = owner();
        Set<UUID> created =
                Set.of(createDocument(owner, "One"), createDocument(owner, "Two"), createDocument(owner, "Three"));

        // The same value the realtime service caps the endpoint with; one batch per request.
        SearchProperties properties = new SearchProperties();
        properties.setMaxReindexDocs(2);

        job(properties).reconcile();

        CapturedCall first = CALLS.poll(5, TimeUnit.SECONDS);
        CapturedCall second = CALLS.poll(5, TimeUnit.SECONDS);
        assertThat(first).isNotNull();
        assertThat(second).isNotNull();
        // Three stale documents, two per batch: no third request, and none over the cap.
        assertThat(CALLS.poll(1, TimeUnit.SECONDS)).isNull();

        // The client sends batches asynchronously, so arrival order is not guaranteed:
        // assert the batch sizes as a multiset rather than assuming first-then-second.
        List<CapturedCall> calls = List.of(first, second);
        assertThat(calls).allSatisfy(call -> assertThat(call.authorization()).isEqualTo("Bearer " + serviceToken));
        List<List<UUID>> batches =
                calls.stream().map(call -> docIds(call.body())).toList();
        assertThat(batches.stream().map(List::size).toList()).containsExactlyInAnyOrder(2, 1);
        assertThat(batches.stream().flatMap(List::stream).toList()).containsExactlyInAnyOrderElementsOf(created);
        // A clean wrap resets the cursor so the next pass starts from the beginning.
        assertThat(searchRepository.readCursor()).isNull();

        // A realtime instance that answers 5xx must not silently drop the work: the crawl
        // tolerates the failure and the documents stay stale for the next pass.
        FAIL_EVERY_CALL.set(true);
        try {
            CALLS.clear();
            job(properties).reconcile();

            assertThat(CALLS.poll(5, TimeUnit.SECONDS)).isNotNull();
            assertThat(searchRepository.selectStaleAfter(null, 10_000)).containsAll(created);
        } finally {
            FAIL_EVERY_CALL.set(false);
        }
    }

    private DocumentSearchReconcileJob job(SearchProperties properties) {
        String baseUrl = "http://127.0.0.1:" + realtime.getAddress().getPort();
        return new DocumentSearchReconcileJob(
                properties, searchRepository, new YhubClient(baseUrl, serviceToken, objectMapper));
    }

    private Actor owner() {
        String suffix = UUID.randomUUID().toString();
        User user = userRepository.saveAndFlush(User.builder()
                .email("owner-" + suffix + "@example.com")
                .displayName("Owner")
                .passwordHash("$2a$12$hash")
                .build());
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("Reindex e2e").build());
        memberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(WorkspaceRole.OWNER)
                .build());
        return new Actor(user, jwtTokenProvider.generateAccessToken(user.getId(), user.getEmail()));
    }

    private UUID createDocument(Actor actor, String title) throws Exception {
        UUID documentId = UUID.randomUUID();
        mockMvc.perform(post("/api/v1/documents")
                        .header("Authorization", "Bearer " + actor.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"id\":\"" + documentId + "\",\"title\":\"" + title + "\"}"))
                .andExpect(status().isCreated());
        return documentId;
    }

    private List<UUID> docIds(String body) {
        Map<?, ?> parsed = objectMapper.readValue(body, Map.class);
        return ((List<?>) parsed.get("docids"))
                .stream().map(id -> UUID.fromString(id.toString())).toList();
    }

    private record Actor(User user, String token) {}

    private record CapturedCall(String authorization, String body) {}
}
