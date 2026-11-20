package com.nextdocs.api.document.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.SharedEntry;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.UserSharedOrder;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.SharedSectionCandidate;
import com.nextdocs.api.document.repository.UserSharedOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SharedSectionServiceTest {

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private UserSharedOrderRepository userSharedOrderRepository;

    @Mock
    private UserRepository userRepository;

    private SharedSectionService service;

    private UUID userId;

    @BeforeEach
    void setUp() {
        service = new SharedSectionService(documentRepository, userSharedOrderRepository, userRepository);
        userId = UUID.randomUUID();
    }

    private SharedSectionCandidate candidate(
            UUID id, UUID parentId, UUID spaceId, String title, OffsetDateTime createdAt) {
        return new SharedSectionCandidate(
                id, parentId, spaceId, title, createdAt, OffsetDateTime.now(), DocumentAccessLevel.VIEW, false);
    }

    private SharedSectionCandidate candidate(
            UUID id, UUID parentId, UUID spaceId, String title, DocumentAccessLevel accessLevel) {
        return new SharedSectionCandidate(
                id, parentId, spaceId, title, OffsetDateTime.now(), OffsetDateTime.now(), accessLevel, false);
    }

    private SharedSectionCandidate candidate(
            UUID id, UUID parentId, UUID spaceId, String title, DocumentAccessLevel accessLevel, boolean owner) {
        return new SharedSectionCandidate(
                id, parentId, spaceId, title, OffsetDateTime.now(), OffsetDateTime.now(), accessLevel, owner);
    }

    private SharedSectionCandidate candidate(UUID id, UUID parentId, UUID spaceId, String title) {
        return candidate(id, parentId, spaceId, title, OffsetDateTime.now());
    }

    private SharedEntry entry(UUID id, UUID parentId, UUID spaceId, String title, String orderKey) {
        return new SharedEntry(
                id,
                parentId,
                spaceId,
                title,
                OffsetDateTime.now(),
                OffsetDateTime.now(),
                orderKey,
                DocumentAccessLevel.VIEW,
                false);
    }

    @Test
    void listProjectsTheCandidateAccessAndOrdersByTheCallersSharedKey() {
        UUID keyedId = UUID.randomUUID();
        UUID unkeyedId = UUID.randomUUID();
        OffsetDateTime base = OffsetDateTime.now();
        SharedSectionCandidate keyed = candidate(keyedId, null, null, "Keyed");
        SharedSectionCandidate unkeyed = candidate(unkeyedId, null, null, "Unkeyed");
        when(documentRepository.findSharedSectionCandidates(userId)).thenReturn(List.of(unkeyed, keyed));
        when(userSharedOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {keyedId, "a0"}));

        List<SharedEntry> entries = service.list(userId);

        assertEquals(
                List.of(keyedId, unkeyedId),
                entries.stream().map(SharedEntry::id).toList());
        assertEquals("a0", entries.get(0).orderKey());
        assertNull(entries.get(1).orderKey());
        assertEquals(DocumentAccessLevel.VIEW, entries.get(0).accessLevel());
    }

    @Test
    void listKeepsOwnershipSeparateFromAnOwnerLevelGrant() {
        UUID ownedRootId = UUID.randomUUID();
        UUID grantedAtOwnerId = UUID.randomUUID();
        when(documentRepository.findSharedSectionCandidates(userId))
                .thenReturn(List.of(
                        candidate(ownedRootId, null, null, "Mine", DocumentAccessLevel.OWNER, true),
                        candidate(
                                grantedAtOwnerId,
                                UUID.randomUUID(),
                                null,
                                "Shared at OWNER",
                                DocumentAccessLevel.OWNER,
                                false)));

        List<SharedEntry> entries = service.list(userId);

        SharedEntry mine = entries.stream()
                .filter(entry -> entry.id().equals(ownedRootId))
                .findFirst()
                .orElseThrow();
        SharedEntry granted = entries.stream()
                .filter(entry -> entry.id().equals(grantedAtOwnerId))
                .findFirst()
                .orElseThrow();
        assertEquals(DocumentAccessLevel.OWNER, mine.accessLevel());
        assertTrue(mine.owner());
        assertEquals(DocumentAccessLevel.OWNER, granted.accessLevel());
        assertFalse(granted.owner());
        assertFalse(granted.withOrderKey("a0").owner());
    }

    @Test
    void listReturnsEmptyWithoutCandidates() {
        when(documentRepository.findSharedSectionCandidates(userId)).thenReturn(List.of());

        assertTrue(service.list(userId).isEmpty());
        verify(userSharedOrderRepository, never()).findOrderKeysByUserIdAndDocumentIds(any(), any());
    }

    @Test
    void ensureOrdersAppendsKeysOnlyForTheReferencedPages() {
        OffsetDateTime base = OffsetDateTime.now();
        UUID keyedId = UUID.randomUUID();
        UUID movedId = UUID.randomUUID();
        UUID siblingId = UUID.randomUUID();

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document moved =
                Document.builder().id(movedId).user(user).title("Moved").build();
        Document sibling =
                Document.builder().id(siblingId).user(user).title("Sibling").build();

        when(documentRepository.findSharedSectionCandidates(userId))
                .thenReturn(List.of(
                        candidate(keyedId, null, null, "Keyed", base),
                        candidate(movedId, null, null, "Moved", base.plusSeconds(1)),
                        candidate(siblingId, null, null, "Sibling", base.plusSeconds(2))));
        when(userSharedOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {keyedId, "a1"}))
                .thenReturn(List.of());
        when(userSharedOrderRepository.findAllOrderKeysByUserId(userId)).thenReturn(List.of("a1"));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(documentRepository.getReferenceById(movedId)).thenReturn(moved);
        when(documentRepository.getReferenceById(siblingId)).thenReturn(sibling);

        List<SharedEntry> result = service.ensureOrders(userId, movedId, siblingId, null);

        assertEquals(
                List.of("a1", "a2", "a3"),
                result.stream().map(SharedEntry::orderKey).toList());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<UserSharedOrder>> captor = ArgumentCaptor.forClass(List.class);
        verify(userSharedOrderRepository).saveAllAndFlush(captor.capture());
        List<UserSharedOrder> rows = captor.getValue();
        assertEquals(2, rows.size());
        assertEquals(movedId, rows.get(0).getDocument().getId());
        assertEquals("a2", rows.get(0).getOrderKey());
        assertEquals(siblingId, rows.get(1).getDocument().getId());
        assertEquals("a3", rows.get(1).getOrderKey());
        // The batched key lookup replaces one existence query per inserted row.
        verify(userSharedOrderRepository, never()).existsByUser_IdAndOrderKey(any(), any());
    }

    @Test
    void ensureOrdersLeavesUnreferencedKeylessPagesAlone() {
        UUID keyedId = UUID.randomUUID();
        UUID unkeyedId = UUID.randomUUID();
        when(documentRepository.findSharedSectionCandidates(userId))
                .thenReturn(
                        List.of(candidate(keyedId, null, null, "Keyed"), candidate(unkeyedId, null, null, "Unkeyed")));
        when(userSharedOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {keyedId, "a1"}));

        List<SharedEntry> result = service.ensureOrders(userId, keyedId, null, null);

        assertEquals("a1", result.get(0).orderKey());
        assertNull(result.get(1).orderKey());
        verify(userSharedOrderRepository, never()).saveAllAndFlush(any());
        // A complete required set is the common case on a reorder: it must not take the
        // per-user lock that only the insert path needs.
        verify(documentRepository, never()).findAllForOrderInsert(any());
        verify(userRepository, never()).findByIdForUpdate(any());
    }

    @Test
    void ensureOrdersReusesARowInsertedWhileTheListingRan() {
        UUID docId = UUID.randomUUID();
        when(documentRepository.findSharedSectionCandidates(userId))
                .thenReturn(List.of(candidate(docId, null, null, "A")));
        // The listing ran before the lock and saw no key; the read under the lock does.
        // Without the second read both tabs would insert and one would fail on
        // uq_user_shared_orders_user_doc with a 500.
        when(userSharedOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.of())
                .thenReturn(List.<Object[]>of(new Object[] {docId, "a1"}));
        when(userRepository.findById(userId))
                .thenReturn(Optional.of(
                        User.builder().id(userId).passwordHash("$2a$12$hash").build()));

        List<SharedEntry> result = service.ensureOrders(userId, docId, null, null);

        assertEquals("a1", result.get(0).orderKey());
        verify(userSharedOrderRepository, never()).saveAllAndFlush(any());
    }

    @Test
    void ensureOrderRowIsIdempotent() {

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(UUID.randomUUID()).user(user).build();
        when(userSharedOrderRepository.existsByUser_IdAndDocument_Id(userId, document.getId()))
                .thenReturn(true);

        service.ensureOrderRow(user, document);

        verify(userSharedOrderRepository, never()).saveAndFlush(any());
        // An existing row needs no insert, so it must not serialize against this user's
        // other Shared writes.
        verify(documentRepository, never()).findAllForOrderInsert(any());
        verify(userRepository, never()).findByIdForUpdate(any());
    }

    @Test
    void ensureOrderRowPlacesTheNewSharedRootBeforeItsFirstSibling() {

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(UUID.randomUUID()).user(user).build();
        when(userSharedOrderRepository.existsByUser_IdAndDocument_Id(userId, document.getId()))
                .thenReturn(false);
        when(userSharedOrderRepository.findMinOrderKeyByUserId(userId, document.getId()))
                .thenReturn(Optional.of("a5"));

        service.ensureOrderRow(user, document);

        ArgumentCaptor<UserSharedOrder> captor = ArgumentCaptor.forClass(UserSharedOrder.class);
        verify(userSharedOrderRepository).saveAndFlush(captor.capture());
        assertTrue(captor.getValue().getOrderKey().compareTo("a5") < 0);
        verify(userRepository).findByIdForUpdate(userId);
    }

    @Test
    void ensureOrderRowSerializesTheKeyCalculationPerUserAfterThePageLock() {

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(UUID.randomUUID()).user(user).build();
        when(userSharedOrderRepository.existsByUser_IdAndDocument_Id(userId, document.getId()))
                .thenReturn(false);
        when(userSharedOrderRepository.findMinOrderKeyByUserId(userId, document.getId()))
                .thenReturn(Optional.empty());

        service.ensureOrderRow(user, document);

        // Two pages granted to the same user at once both read the section top; only the
        // account lock makes the second one see the first one's key. It is requested last so
        // a transaction that holds it never waits for a page another one is holding.
        InOrder locks = inOrder(documentRepository, userRepository);
        locks.verify(documentRepository).findAllForOrderInsert(List.of(document.getId()));
        locks.verify(userRepository).findByIdForUpdate(userId);
    }

    @Test
    void ensureOrderRowReusesARowAnotherTabInsertedWhileItWaitedForTheLock() {

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(UUID.randomUUID()).user(user).build();
        // Missing before the lock, present after it: the other transaction committed
        // while this one waited, so inserting again would be the 500 this test guards.
        when(userSharedOrderRepository.existsByUser_IdAndDocument_Id(userId, document.getId()))
                .thenReturn(false)
                .thenReturn(true);

        service.ensureOrderRow(user, document);

        verify(userSharedOrderRepository, never()).saveAndFlush(any());
        verify(userRepository).findByIdForUpdate(userId);
    }

    @Test
    void ensureOrderRowsInsertsOnlyTheMissingPagesUnderOnePairOfLocks() {

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document existing = Document.builder().id(UUID.randomUUID()).user(user).build();
        Document firstMissing =
                Document.builder().id(UUID.randomUUID()).user(user).build();
        Document secondMissing =
                Document.builder().id(UUID.randomUUID()).user(user).build();
        List<UUID> missingIds = List.of(firstMissing.getId(), secondMissing.getId()).stream()
                .sorted()
                .toList();

        when(userSharedOrderRepository.findExistingDocumentIdsByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.of(existing.getId()))
                .thenReturn(List.of());
        when(userSharedOrderRepository.findAllOrderKeysByUserId(userId)).thenReturn(List.of("a5"));
        when(userSharedOrderRepository.findMinOrderKeyByUserId(eq(userId), any()))
                .thenReturn(Optional.of("a5"));
        List<UserSharedOrder> rows = new ArrayList<>();
        when(userSharedOrderRepository.saveAllAndFlush(any())).thenAnswer(invocation -> {
            Iterable<UserSharedOrder> saved = invocation.getArgument(0);
            saved.forEach(rows::add);
            return List.of();
        });

        service.ensureOrderRows(user, List.of(existing, firstMissing, secondMissing));

        assertEquals(
                missingIds, rows.stream().map(row -> row.getDocument().getId()).toList());
        assertTrue(rows.get(0).getOrderKey().compareTo("a5") < 0);
        assertTrue(rows.get(0).getOrderKey().compareTo(rows.get(1).getOrderKey()) < 0);

        // One page lock for the whole batch, and one account lock after it: the ordering
        // that keeps a single insert deadlock-free has to survive the batch form.
        InOrder locks = inOrder(documentRepository, userRepository);
        locks.verify(documentRepository).findAllForOrderInsert(missingIds);
        locks.verify(userRepository).findByIdForUpdate(userId);
    }

    @Test
    void ensureOrderRowsSkipsRowsAnotherTabInsertedWhileItWaitedForTheLock() {

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document first = Document.builder().id(UUID.randomUUID()).user(user).build();
        Document second = Document.builder().id(UUID.randomUUID()).user(user).build();
        List<UUID> ids =
                List.of(first.getId(), second.getId()).stream().sorted().toList();

        // Missing before the lock, present after it: the other transaction committed its
        // rows while this one waited, so inserting again would trip the unique key.
        when(userSharedOrderRepository.findExistingDocumentIdsByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.of())
                .thenReturn(ids);

        service.ensureOrderRows(user, List.of(first, second));

        verify(userSharedOrderRepository, never()).saveAllAndFlush(any());
        verify(userRepository).findByIdForUpdate(userId);
    }

    @Test
    void ensureOrderRowsSkipsTheLocksWhenEveryPageAlreadyHasARow() {

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        Document document = Document.builder().id(UUID.randomUUID()).user(user).build();
        when(userSharedOrderRepository.findExistingDocumentIdsByUserIdAndDocumentIds(userId, List.of(document.getId())))
                .thenReturn(List.of(document.getId()));

        service.ensureOrderRows(user, List.of(document));

        verify(userSharedOrderRepository, never()).saveAllAndFlush(any());
        verify(documentRepository, never()).findAllForOrderInsert(any());
        verify(userRepository, never()).findByIdForUpdate(any());
    }

    @Test
    void reindexParksRowsBeforeAssigningSpacedKeys() {
        UserSharedOrder first = UserSharedOrder.builder().orderKey("a1").build();
        UserSharedOrder second = UserSharedOrder.builder().orderKey("a2").build();
        UserSharedOrder third = UserSharedOrder.builder().orderKey("a3").build();
        when(userSharedOrderRepository.findAllForReindex(userId)).thenReturn(List.of(first, second, third));

        List<List<String>> savedKeys = new ArrayList<>();
        when(userSharedOrderRepository.saveAllAndFlush(any())).thenAnswer(invocation -> {
            Iterable<UserSharedOrder> rows = invocation.getArgument(0);
            List<String> snapshot = new ArrayList<>();
            rows.forEach(row -> snapshot.add(row.getOrderKey()));
            savedKeys.add(snapshot);
            return List.of();
        });

        service.reindex(userId);

        assertEquals(2, savedKeys.size());
        assertEquals(List.of("~shared-reindex-0", "~shared-reindex-1", "~shared-reindex-2"), savedKeys.get(0));
        assertEquals(List.of(FractionalIndex.nKeysBetweenSpaced(null, null, 3, 8)), savedKeys.get(1));
        savedKeys.get(1).forEach(key -> assertTrue(FractionalIndex.isValidOrderKey(key)));
    }

    @Test
    void isInSectionReadsOneCandidateInsteadOfTheWholeListing() {
        UUID docId = UUID.randomUUID();
        when(documentRepository.findSharedSectionCandidate(userId, docId))
                .thenReturn(Optional.of(candidate(docId, null, null, "Mine")));

        assertTrue(service.isInSection(userId, docId));
        verify(documentRepository, never()).findSharedSectionCandidates(any());
    }

    @Test
    void isInSectionIsFalseWithoutACandidate() {
        UUID docId = UUID.randomUUID();
        when(documentRepository.findSharedSectionCandidate(userId, docId)).thenReturn(Optional.empty());

        assertFalse(service.isInSection(userId, docId));
    }

    @Test
    void neighborKeyRejectsASiblingOutsideTheSection() {
        UUID docId = UUID.randomUUID();
        UUID siblingId = UUID.randomUUID();
        SharedEntry entry = entry(docId, null, null, "Mine", "a0");

        ApiException ex =
                assertThrows(ApiException.class, () -> service.neighborKey(userId, List.of(entry), siblingId, docId));

        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
        assertTrue(ex.getMessage().contains("not in the Shared section"));
    }

    @Test
    void ensureOrdersRepairsAStoredKeyNoIntervalAccepts() {
        UUID legacyKeyDoc = UUID.randomUUID();

        User user = User.builder().id(userId).passwordHash("$2a$12$hash").build();
        // A timestamp left by the pre-fractional backfill: it sorts, but no interval can
        // be computed around it, so it would answer CONFLICT on every later reorder.
        String legacyKey = "2024-01-01T10:00:00.000000Z";
        UserSharedOrder legacyRow = UserSharedOrder.builder()
                .id(UUID.randomUUID())
                .orderKey(legacyKey)
                .build();

        when(documentRepository.findSharedSectionCandidates(userId))
                .thenReturn(List.of(candidate(legacyKeyDoc, null, null, "Legacy")));
        when(userSharedOrderRepository.findOrderKeysByUserIdAndDocumentIds(eq(userId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {legacyKeyDoc, legacyKey}));
        when(userRepository.findById(userId)).thenReturn(Optional.of(user));
        when(userSharedOrderRepository.findByUser_IdAndDocument_Id(userId, legacyKeyDoc))
                .thenReturn(Optional.of(legacyRow));
        when(userSharedOrderRepository.findAllOrderKeysByUserId(userId)).thenReturn(List.of(legacyKey));

        List<SharedEntry> result = service.ensureOrders(userId, legacyKeyDoc, null, null);

        String repaired = result.get(0).orderKey();
        assertTrue(FractionalIndex.isValidOrderKey(repaired));
        assertNotEquals(legacyKey, repaired);
        assertEquals(repaired, legacyRow.getOrderKey());
        verify(userSharedOrderRepository).saveAllAndFlush(any());
    }

    @Test
    void keyBetweenSiblingsWidensTheIntervalToTheRealNeighbour() {
        UUID prevId = UUID.randomUUID();
        UUID nextId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        // The client asked for [a0, a2], but another page already holds a1: a key taken
        // between the requested pair alone could equal it.
        List<SharedEntry> entries = List.of(
                entry(prevId, null, null, "Prev", "a0"),
                entry(nextId, null, null, "Next", "a2"),
                entry(docId, null, null, "Moved", null));
        when(userSharedOrderRepository.findMinOrderKeyGreaterThan(userId, "a0", docId))
                .thenReturn(Optional.of("a1"));

        String key = service.keyBetweenSiblings(userId, entries, docId, prevId, nextId);

        assertTrue(key.compareTo("a0") > 0);
        assertTrue(key.compareTo("a1") < 0);
    }

    @Test
    void keyBetweenSiblingsKeepsTheKeyBelowARequestedNextTheNamespaceNoLongerHolds() {
        UUID prevId = UUID.randomUUID();
        UUID nextId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        // The client asked to drop before `next`, which was purged after the listing ran.
        // The nearest live key above `prev` is now a4; placing after it would move the page
        // past the slot the caller chose.
        List<SharedEntry> entries = List.of(
                entry(prevId, null, null, "Prev", "a1"),
                entry(nextId, null, null, "Next", "a3"),
                entry(docId, null, null, "Moved", "a0"));
        when(userSharedOrderRepository.findMinOrderKeyGreaterThan(userId, "a1", docId))
                .thenReturn(Optional.of("a4"));

        String key = service.keyBetweenSiblings(userId, entries, docId, prevId, nextId);

        assertTrue(key.compareTo("a1") > 0);
        assertTrue(key.compareTo("a3") < 0);
    }

    @Test
    void keyBetweenSiblingsAnswersConflictWhenANeighbourHasNoKeyYet() {
        UUID prevId = UUID.randomUUID();
        UUID docId = UUID.randomUUID();
        List<SharedEntry> entries =
                List.of(entry(prevId, null, null, "Prev", null), entry(docId, null, null, "Moved", "a1"));

        ApiException ex = assertThrows(
                ApiException.class, () -> service.keyBetweenSiblings(userId, entries, docId, prevId, null));

        assertEquals(ErrorCode.CONFLICT, ex.getErrorCode());
    }

    @Test
    void neighborKeyRejectsSelfReference() {
        UUID docId = UUID.randomUUID();
        ApiException ex = assertThrows(ApiException.class, () -> service.neighborKey(userId, List.of(), docId, docId));
        assertEquals(ErrorCode.VALIDATION_FAILED, ex.getErrorCode());
    }
}
