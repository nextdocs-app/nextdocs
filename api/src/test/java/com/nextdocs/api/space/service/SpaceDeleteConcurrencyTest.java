package com.nextdocs.api.space.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.GlobalExceptionHandler;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.document.service.PermissionService;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Delete takes the space row lock, and a waiting page attach now loses with 404 before it
 * can write. The FK RESTRICT backstop is for the inner write when a caller skipped that
 * lock, so this racer drives {@link DocumentService#assignSpace} after the delete has
 * already removed the row, and asserts the constraint violation reaches the client as
 * 409 rather than 500.
 */
@SpringBootTest
class SpaceDeleteConcurrencyTest {

    @MockitoSpyBean
    private SpaceAccessService spaceAccessService;

    // The native permission function is Postgres-only; this racer cares about the FK,
    // so the page grant is stubbed and the real write still reaches the constraint.
    @MockitoBean
    private PermissionService permissionService;

    @Autowired
    private DocumentService documentService;

    @Autowired
    private SpaceRepository spaceRepository;

    @Autowired
    private SpaceMemberRepository spaceMemberRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PlatformTransactionManager transactionManager;

    private MockMvc mockMvc;

    private User actor;
    private Workspace workspace;
    private Space space;
    private Document page;

    @BeforeEach
    void seedSpaceAndPage() {
        actor = userRepository.saveAndFlush(User.builder()
                .email("space-delete-race-actor@example.com")
                .displayName("Actor")
                .build());
        workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("Race").build());
        workspaceMemberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(actor)
                .role(WorkspaceRole.OWNER)
                .build());
        space = spaceRepository.saveAndFlush(Space.builder()
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .build());
        page = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(actor)
                .title("Page")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
        mockMvc = MockMvcBuilders.standaloneSetup(new AttachProbe(documentService))
                .setControllerAdvice(new GlobalExceptionHandler())
                .build();
    }

    @AfterEach
    void removeCreatedRows() {
        documentRepository.deleteAll();
        spaceMemberRepository.deleteAll();
        spaceRepository.deleteAll();
        workspaceMemberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void attachThatWritesAfterDeleteGetsConflictFromTheFkBackstop() throws Exception {
        CountDownLatch deleteCommitted = new CountDownLatch(1);
        // Hold the write until the delete commits; otherwise H2 can accept the update
        // against the still-uncommitted row and never run the FK check.
        when(permissionService.requireEditAccess(actor.getId(), page.getId())).thenAnswer(invocation -> {
            await(deleteCommitted);
            return page;
        });
        when(permissionService.resolveAccess(actor.getId(), page.getId())).thenReturn(DocumentAccessLevel.OWNER);

        CountDownLatch precheckDone = new CountDownLatch(1);
        AtomicInteger checks = new AtomicInteger();
        doAnswer(invocation -> {
                    Object result = invocation.callRealMethod();
                    if (checks.incrementAndGet() == 1) {
                        precheckDone.countDown();
                    }
                    return result;
                })
                .when(spaceAccessService)
                .requireActiveAdministration(actor.getId(), space.getId());

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            AtomicReference<Future<Integer>> outcome = new AtomicReference<>();
            try {
                new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                    Space locked =
                            spaceRepository.findByIdForUpdate(space.getId()).orElseThrow();
                    spaceRepository.delete(locked);
                    // The DELETE is uncommitted but has already removed the row the FK
                    // will check; the attach's pre-check still reads the old version.
                    spaceRepository.flush();

                    outcome.set(pool.submit(() -> mockMvc.perform(post("/probe/attach")
                                    .param("actorId", actor.getId().toString())
                                    .param("spaceId", space.getId().toString())
                                    .param("documentId", page.getId().toString()))
                            .andReturn()
                            .getResponse()
                            .getStatus()));
                    await(precheckDone);
                });
            } finally {
                deleteCommitted.countDown();
            }

            assertThat(outcome.get().get(30, TimeUnit.SECONDS)).isEqualTo(409);
        } finally {
            pool.shutdownNow();
        }

        assertThat(documentRepository.findById(page.getId()).orElseThrow().getSpace())
                .isNull();
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(10, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }

    /**
     * Bypasses {@code SpaceService.attachPage} on purpose: its row lock closes the window
     * this test needs, while the raw write keeps the FK backstop reachable.
     */
    @RestController
    static class AttachProbe {

        private final DocumentService documentService;

        AttachProbe(DocumentService documentService) {
            this.documentService = documentService;
        }

        @PostMapping("/probe/attach")
        ResponseEntity<Void> attach(
                @RequestParam UUID actorId, @RequestParam UUID spaceId, @RequestParam UUID documentId) {
            documentService.assignSpace(actorId, documentId, spaceId);
            return ResponseEntity.noContent().build();
        }
    }
}
