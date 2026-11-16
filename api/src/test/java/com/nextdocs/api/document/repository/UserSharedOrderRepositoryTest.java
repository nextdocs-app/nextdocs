package com.nextdocs.api.document.repository;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.UserSharedOrder;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.transaction.annotation.Transactional;

@SpringBootTest
@Transactional
class UserSharedOrderRepositoryTest {

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private DocumentRepository documentRepository;

    @Autowired
    private UserSharedOrderRepository userSharedOrderRepository;

    @Test
    void findAllForReindex_includesRowsForTrashedDocuments() {
        User user = userRepository.saveAndFlush(
                User.builder().email("alice@example.com").displayName("Alice").build());

        Document active = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Active")
                .build());

        Document trashed = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Trashed")
                .deletedAt(OffsetDateTime.now())
                .build());

        userSharedOrderRepository.saveAndFlush(UserSharedOrder.builder()
                .user(user)
                .document(active)
                .orderKey("a0")
                .build());
        userSharedOrderRepository.saveAndFlush(UserSharedOrder.builder()
                .user(user)
                .document(trashed)
                .orderKey("a1")
                .build());

        List<UserSharedOrder> rows = userSharedOrderRepository.findAllForReindex(user.getId());

        // A trashed row still occupies (user_id, order_key), so reindexing live rows
        // without it can collide with a key the section no longer renders.
        assertThat(rows).hasSize(2);
        assertThat(rows)
                .extracting(o -> o.getDocument().getId())
                .containsExactlyInAnyOrder(active.getId(), trashed.getId());
    }

    @Test
    void neighbourQueriesIncludeRowsForTrashedDocuments() {
        User user = userRepository.saveAndFlush(
                User.builder().email("alice@example.com").displayName("Alice").build());
        Document active = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Active")
                .build());
        Document trashed = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(user)
                .title("Trashed")
                .deletedAt(OffsetDateTime.now())
                .build());
        userSharedOrderRepository.saveAndFlush(UserSharedOrder.builder()
                .user(user)
                .document(active)
                .orderKey("a0")
                .build());
        userSharedOrderRepository.saveAndFlush(UserSharedOrder.builder()
                .user(user)
                .document(trashed)
                .orderKey("a1")
                .build());
        UUID movedId = UUID.randomUUID();

        // A trashed row still holds (user_id, order_key) until purge. A neighbour read that
        // skipped it would put a new key on top of it and trip the unique constraint.
        assertThat(userSharedOrderRepository.findMaxOrderKeyByUserId(user.getId(), movedId))
                .contains("a1");
        assertThat(userSharedOrderRepository.findMaxOrderKeyLessThan(user.getId(), "a2", movedId))
                .contains("a1");
        assertThat(userSharedOrderRepository.findMinOrderKeyGreaterThan(user.getId(), "a0", movedId))
                .contains("a1");
        assertThat(userSharedOrderRepository.findMinOrderKeyByUserId(user.getId(), movedId))
                .contains("a0");
    }

    @Test
    void findAllForReindex_isScopedToSingleUser() {
        User user = userRepository.saveAndFlush(
                User.builder().email("alice@example.com").displayName("Alice").build());
        User other = userRepository.saveAndFlush(
                User.builder().email("bob@example.com").displayName("Bob").build());

        Document userDoc = documentRepository.saveAndFlush(
                Document.builder().id(UUID.randomUUID()).user(user).title("Doc").build());
        Document otherDoc = documentRepository.saveAndFlush(Document.builder()
                .id(UUID.randomUUID())
                .user(other)
                .title("Other")
                .build());

        UUID orderId = userSharedOrderRepository
                .saveAndFlush(UserSharedOrder.builder()
                        .user(user)
                        .document(userDoc)
                        .orderKey("a0")
                        .build())
                .getId();
        userSharedOrderRepository.saveAndFlush(UserSharedOrder.builder()
                .user(other)
                .document(otherDoc)
                .orderKey("a0")
                .build());

        List<UserSharedOrder> rows = userSharedOrderRepository.findAllForReindex(user.getId());

        assertThat(rows).hasSize(1);
        assertThat(rows.get(0).getId()).isEqualTo(orderId);
    }
}
