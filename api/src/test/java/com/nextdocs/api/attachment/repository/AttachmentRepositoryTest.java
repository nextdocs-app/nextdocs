package com.nextdocs.api.attachment.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;

import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.repository.DocumentRepository;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

/**
 * Entity-mapping and derived-query tests for {@link AttachmentRepository}. Each query gets
 * its own test so a regression names the query that broke instead of failing one mega-assertion.
 *
 * <p>Empty-id collections are deliberately not exercised here: {@code AttachmentService}
 * guards them before the repository is reached (tested there), which is what keeps the
 * Postgres {@code IN ()} binding difference off the critical path.
 */
@SpringBootTest
@Transactional
class AttachmentRepositoryTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private AttachmentRepository attachmentRepository;

    private User user;
    private Document active;
    private Document trashed;

    @BeforeEach
    void setUp() {
        user = userRepository.saveAndFlush(
                User.builder().email("alice@example.com").displayName("Alice").build());
        active = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Active")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
        trashed = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Trashed")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC).minusDays(60))
                .build());
    }

    @Test
    void findStorageKeysByDocumentIds_returnsKeysForEveryRequestedDocument() {
        Attachment activeAttachment = save(active);
        Attachment trashedAttachment = save(trashed);

        assertThat(attachmentRepository.findStorageKeysByDocumentIds(List.of(active.getId(), trashed.getId())))
                .containsExactlyInAnyOrder(activeAttachment.getStorageKey(), trashedAttachment.getStorageKey());
        assertThat(attachmentRepository.findStorageKeysByDocumentIds(List.of(active.getId())))
                .containsExactly(activeAttachment.getStorageKey());
    }

    @Test
    void findStorageKeysForExpiredTrash_returnsOnlyDocsPastTheCutoff() {
        Attachment freshTrash = save(trashed);
        Document recentlyTrashed = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Recently trashed")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC).minusDays(5))
                .build());
        Attachment recentAttachment = save(recentlyTrashed);

        OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC).minusDays(30);

        assertThat(attachmentRepository.findStorageKeysForExpiredTrash(cutoff))
                .containsExactly(freshTrash.getStorageKey())
                .doesNotContain(recentAttachment.getStorageKey());
    }

    @Test
    void findStorageKeysForExpiredTrash_excludesActiveDocuments() {
        save(active);

        assertThat(attachmentRepository.findStorageKeysForExpiredTrash(OffsetDateTime.now(ZoneOffset.UTC)))
                .isEmpty();
    }

    @Test
    void deleteForExpiredTrash_removesOnlyExpiredRows() {
        save(trashed);
        Document recentlyTrashed = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Recently trashed")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .deletedAt(OffsetDateTime.now(ZoneOffset.UTC).minusDays(5))
                .build());
        Attachment recentAttachment = save(recentlyTrashed);

        OffsetDateTime cutoff = OffsetDateTime.now(ZoneOffset.UTC).minusDays(30);

        assertEquals(1, attachmentRepository.deleteForExpiredTrash(cutoff));
        assertThat(attachmentRepository.findById(recentAttachment.getId())).isPresent();
    }

    @Test
    void deleteByDocumentIds_removesRowsAndReturnsCount() {
        save(active);
        save(trashed);

        assertEquals(1, attachmentRepository.deleteByDocumentIds(List.of(active.getId())));
        assertEquals(0, attachmentRepository.deleteByDocumentIds(List.of(active.getId())));
    }

    private Attachment save(Document document) {
        return attachmentRepository.saveAndFlush(
                attachment(user, document, document.getId() + "/" + UUID.randomUUID()));
    }

    private static Attachment attachment(User uploader, Document document, String storageKey) {
        return Attachment.builder()
                .id(UUID.randomUUID())
                .document(document)
                .uploadedBy(uploader)
                .fileName("file.bin")
                .contentType("application/octet-stream")
                .sizeBytes(3)
                .storageKey(storageKey)
                .sha256("0".repeat(64))
                .build();
    }
}
