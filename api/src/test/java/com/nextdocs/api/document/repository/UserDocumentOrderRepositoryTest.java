package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.UserDocumentOrder;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class UserDocumentOrderRepositoryTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private UserDocumentOrderRepository userDocumentOrderRepository;

    @Test
    void findAllForReindex_includesRowsForTrashedDocuments() {
        User user = userRepository.saveAndFlush(
                User.builder().email("alice@example.com").displayName("Alice").build());

        Document active = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Active")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());

        Document trashed = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Trashed")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .deletedAt(OffsetDateTime.now())
                .build());

        userDocumentOrderRepository.saveAndFlush(UserDocumentOrder.builder()
                .user(user)
                .document(active)
                .orderKey("a0")
                .build());
        userDocumentOrderRepository.saveAndFlush(UserDocumentOrder.builder()
                .user(user)
                .document(trashed)
                .orderKey("a1")
                .build());

        List<UserDocumentOrder> rows = userDocumentOrderRepository.findAllForReindex(user.getId());

        assertThat(rows).hasSize(2);
        assertThat(rows)
                .extracting(o -> o.getDocument().getId())
                .containsExactlyInAnyOrder(active.getId(), trashed.getId());
    }

    @Test
    void findAllForReindex_isScopedToSingleUser() {
        User user = userRepository.saveAndFlush(
                User.builder().email("alice@example.com").displayName("Alice").build());
        User other = userRepository.saveAndFlush(
                User.builder().email("bob@example.com").displayName("Bob").build());

        Document userDoc = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Doc")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());
        Document otherDoc = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(other)
                .title("Other")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build());

        UUID orderId = userDocumentOrderRepository
                .saveAndFlush(UserDocumentOrder.builder()
                        .user(user)
                        .document(userDoc)
                        .orderKey("a0")
                        .build())
                .getId();
        userDocumentOrderRepository.saveAndFlush(UserDocumentOrder.builder()
                .user(other)
                .document(otherDoc)
                .orderKey("a0")
                .build());

        List<UserDocumentOrder> rows = userDocumentOrderRepository.findAllForReindex(user.getId());

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getId()).isEqualTo(orderId);
    }
}
