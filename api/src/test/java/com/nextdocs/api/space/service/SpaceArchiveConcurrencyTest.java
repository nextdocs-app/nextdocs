package com.nextdocs.api.space.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.doAnswer;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.space.dto.request.SpaceMemberCreateRequest;
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
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
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
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * Archive holds the space row lock. An attach or member add that read the space before
 * waiting for that lock must re-read it, or it writes into a space that is already
 * frozen. Mocked tests cannot observe persisted row state, so these racers hold the
 * lock in one real transaction and let the mutation wait in another.
 */
@SpringBootTest
class SpaceArchiveConcurrencyTest {

    @MockitoSpyBean
    private SpaceService spaceService;

    @MockitoSpyBean
    private SpaceAccessService spaceAccessService;

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

    private User actor;
    private User target;
    private Workspace workspace;
    private Space space;
    private Document page;

    @BeforeEach
    void seedSpaceAndPage() {
        actor = userRepository.saveAndFlush(User.builder()
                .email("space-race-actor@example.com")
                .displayName("Actor")
                .build());
        target = userRepository.saveAndFlush(User.builder()
                .email("space-race-target@example.com")
                .displayName("Target")
                .build());
        workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("Race").build());
        workspaceMember(actor, WorkspaceRole.OWNER);
        workspaceMember(target, WorkspaceRole.MEMBER);
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
    }

    @AfterEach
    void removeCreatedRows() {
        // Documents first: fk_documents_space is RESTRICT, so a leaked attach would
        // otherwise fail cleanup instead of failing the assertion above.
        documentRepository.deleteAll();
        spaceMemberRepository.deleteAll();
        spaceRepository.deleteAll();
        workspaceMemberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    @Test
    void archiveThatCommitsFirstMakesAWaitingAttachReturnConflict() throws Exception {
        CountDownLatch attachEntered = new CountDownLatch(1);
        doAnswer(invocation -> {
                    attachEntered.countDown();
                    return invocation.callRealMethod();
                })
                .when(spaceService)
                .attachPage(actor.getId(), space.getId(), page.getId());

        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            AtomicReference<Future<ErrorCode>> outcome = new AtomicReference<>();
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                holdArchiveLock();

                outcome.set(pool.submit(() -> {
                    try {
                        spaceService.attachPage(actor.getId(), space.getId(), page.getId());
                        return null;
                    } catch (ApiException ex) {
                        return ex.getErrorCode();
                    }
                }));
                // attachPage has entered and is about to ask for the lock the
                // archive holds; committing now makes it the loser.
                await(attachEntered);
            });

            assertThat(outcome.get().get(30, TimeUnit.SECONDS)).isEqualTo(ErrorCode.CONFLICT);
        } finally {
            pool.shutdownNow();
        }

        assertThat(documentRepository.findById(page.getId()).orElseThrow().getSpace())
                .isNull();
    }

    @Test
    void archiveThatCommitsAfterTheMemberPrecheckStillBlocksTheAdd() throws Exception {
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
            AtomicReference<Future<ErrorCode>> outcome = new AtomicReference<>();
            new TransactionTemplate(transactionManager).executeWithoutResult(status -> {
                holdArchiveLock();

                outcome.set(pool.submit(() -> {
                    try {
                        spaceService.addMember(
                                actor.getId(),
                                space.getId(),
                                new SpaceMemberCreateRequest(
                                        "space-race-target@example.com", DocumentAccessLevel.EDIT));
                        return null;
                    } catch (ApiException ex) {
                        return ex.getErrorCode();
                    }
                }));
                // The add's pre-check already loaded the old, unarchived row; the
                // post-lock check has to refresh it before deciding.
                await(precheckDone);
            });

            assertThat(outcome.get().get(30, TimeUnit.SECONDS)).isEqualTo(ErrorCode.CONFLICT);
        } finally {
            pool.shutdownNow();
        }

        assertThat(spaceMemberRepository.existsBySpace_IdAndUser_Id(space.getId(), target.getId()))
                .isFalse();
    }

    /** Holds the space row lock with an uncommitted archive until the transaction ends. */
    private void holdArchiveLock() {
        Space locked = spaceRepository.findByIdForUpdate(space.getId()).orElseThrow();
        locked.setArchivedAt(OffsetDateTime.now(ZoneOffset.UTC));
        spaceRepository.saveAndFlush(locked);
    }

    private WorkspaceMember workspaceMember(User user, WorkspaceRole role) {
        return workspaceMemberRepository.saveAndFlush(WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(role)
                .build());
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(10, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(ex);
        }
    }
}
