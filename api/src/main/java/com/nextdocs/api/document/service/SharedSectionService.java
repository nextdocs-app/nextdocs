package com.nextdocs.api.document.service;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.dto.response.SharedEntry;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.UserSharedOrder;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.repository.SharedSectionCandidate;
import com.nextdocs.api.document.repository.UserSharedOrderRepository;
import com.nextdocs.api.document.util.FractionalIndex;
import com.nextdocs.api.document.util.OrderInterval;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The signed-in Shared section: a per-user view over grants, not a folder.
 *
 * <p>Single-home rule: a document is listed here only when the caller can read it and no
 * browsable container of its own surfaces it. For a nested page the container is the real
 * parent, never the space: an unreadable parent puts the page here even when the caller can
 * browse the space, because a space listing only renders space roots. Otherwise a space root
 * is a space's own entry while the caller can browse that space, and falls back here when it
 * cannot. The rule covers every entry kind with one predicate:
 *
 * <ul>
 *   <li>owned root with an audience,
 *   <li>granted root,
 *   <li>granted page under an unreadable parent,
 *   <li>space root whose space the caller cannot browse.
 * </ul>
 *
 * <p>Order is personal and lives in {@link UserSharedOrder}, never in the
 * document's tree keys. A space page therefore has two independent positions:
 * its place in the space (shared with members) and the caller's place here.
 */
@Service
@RequiredArgsConstructor
public class SharedSectionService {

    private static final int REINDEX_GAP = 8;

    private final DocumentRepository documentRepository;
    private final UserSharedOrderRepository userSharedOrderRepository;
    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public List<SharedEntry> list(UUID userId) {
        List<SharedSectionCandidate> candidates = documentRepository.findSharedSectionCandidates(userId);
        if (candidates.isEmpty()) {
            return List.of();
        }

        List<UUID> candidateIds =
                candidates.stream().map(SharedSectionCandidate::id).toList();
        Map<UUID, String> orderKeys = fetchOrderKeys(userId, candidateIds);

        List<SharedEntry> entries = candidates.stream()
                .map(candidate -> new SharedEntry(
                        candidate.id(),
                        candidate.parentId(),
                        candidate.spaceId(),
                        candidate.title(),
                        candidate.createdAt(),
                        candidate.updatedAt(),
                        orderKeys.get(candidate.id()),
                        candidate.accessLevel(),
                        candidate.owner()))
                .collect(Collectors.toCollection(ArrayList::new));

        // Ordered entries first, by the caller's Shared key; entries without a row yet keep
        // a stable created-order fallback until the first reorder assigns them one.
        entries.sort(Comparator.comparing(SharedEntry::orderKey, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(SharedEntry::createdAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(SharedEntry::id));
        return entries;
    }

    /**
     * Whether one document currently belongs to this caller's Shared section. The
     * candidate query already resolves effective access and the single-home predicate,
     * so this is one key lookup and never a section scan.
     */
    @Transactional(readOnly = true)
    public boolean isInSection(UUID userId, UUID documentId) {
        return documentRepository.findSharedSectionCandidate(userId, documentId).isPresent();
    }

    /**
     * Gives the pages a reorder actually references a Shared row, in current display
     * order, before the move resolves neighbours. Only the moved page and the requested
     * siblings are written: a keyless page the caller did not drag keeps its null
     * fallback until a later reorder touches it. Runs inside the reorder transaction,
     * never on a read path.
     *
     * @return the same entries with a usable key, including the ones just inserted
     */
    @Transactional
    public List<SharedEntry> ensureOrders(UUID userId, UUID documentId, UUID prevSiblingId, UUID nextSiblingId) {
        List<SharedEntry> entries = list(userId);
        if (entries.isEmpty()) {
            return entries;
        }

        Set<UUID> requiredIds = Stream.of(documentId, prevSiblingId, nextSiblingId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());
        List<SharedEntry> required = entries.stream()
                .filter(entry -> requiredIds.contains(entry.id()))
                .toList();
        // A sibling outside the section stays unresolved: neighborKey rejects it below
        // instead of inventing a position between two unrelated namespaces.
        if (required.isEmpty()) {
            return entries;
        }
        // A listed entry that already carries a usable key has its row, and the lock below
        // is only needed by the write path. Reordering a settled section stays lock-free.
        if (required.stream().allMatch(entry -> isUsable(entry.orderKey()))) {
            return entries;
        }

        // The listing above is unlocked, so a row inserted while it ran is only visible
        // after the lock. Re-read only the referenced ids under it: two tabs doing their
        // first reorder would otherwise both decide the section has no key for the same
        // page and collide on (user, document) instead of appending different keys.
        List<UUID> referencedIds = required.stream().map(SharedEntry::id).toList();
        lockForOrderInsert(referencedIds);
        lockOrderNamespace(userId);
        User user = requireUser(userId);
        Map<UUID, String> existing = fetchOrderKeys(userId, referencedIds);
        // A row can exist for a page that is not currently listed (an owner keeps a
        // Shared position across an unshare), so every stored key has to stay free.
        Set<String> usedKeys = new HashSet<>(userSharedOrderRepository.findAllOrderKeysByUserId(userId));
        // Keyless entries sort last, so every new key must follow the highest key that
        // is already displayed or stored.
        String previous = Stream.concat(entries.stream().map(SharedEntry::orderKey), existing.values().stream())
                .filter(SharedSectionService::isUsable)
                .max(Comparator.naturalOrder())
                .orElse(null);

        Map<UUID, String> assigned = new HashMap<>();
        List<UserSharedOrder> rows = new ArrayList<>();
        for (SharedEntry entry : required) {
            String stored = existing.get(entry.id());
            if (isUsable(stored)) {
                assigned.put(entry.id(), stored);
                continue;
            }
            if (stored != null) {
                // A stored key that {@link FractionalIndex#isValidOrderKey} rejects (a
                // hand-edited or truncated row, or one written by an older writer) can never
                // anchor a neighbour: re-space it here instead of failing every later reorder
                // against it. A concurrent delete leaves nothing to repair, and the insert
                // below recreates the row.
                UserSharedOrder unusable = userSharedOrderRepository
                        .findByUser_IdAndDocument_Id(userId, entry.id())
                        .orElse(null);
                if (unusable != null) {
                    String key = nextFreeKey(previous, usedKeys);
                    unusable.setOrderKey(key);
                    rows.add(unusable);
                    assigned.put(entry.id(), key);
                    previous = key;
                    continue;
                }
            }
            String key = nextFreeKey(previous, usedKeys);
            rows.add(UserSharedOrder.builder()
                    .user(user)
                    .document(documentRepository.getReferenceById(entry.id()))
                    .orderKey(key)
                    .build());
            assigned.put(entry.id(), key);
            previous = key;
        }
        if (!rows.isEmpty()) {
            userSharedOrderRepository.saveAllAndFlush(rows);
        }

        return entries.stream()
                .map(entry -> assigned.containsKey(entry.id()) ? entry.withOrderKey(assigned.get(entry.id())) : entry)
                .toList();
    }

    /** Re-spaces this user's Shared rows only. Private order is never touched. */
    @Transactional
    public void reindex(UUID userId) {
        List<UserSharedOrder> rows = userSharedOrderRepository.findAllForReindex(userId);
        if (rows.isEmpty()) {
            return;
        }
        // Park first: a final key can equal a row's current key, and the
        // (user, order_key) unique constraint rejects that transient state.
        for (int i = 0; i < rows.size(); i++) {
            rows.get(i).setOrderKey("~shared-reindex-" + i);
        }
        userSharedOrderRepository.saveAllAndFlush(rows);

        String[] newKeys = FractionalIndex.nKeysBetweenSpaced(null, null, rows.size(), REINDEX_GAP);
        for (int i = 0; i < rows.size(); i++) {
            rows.get(i).setOrderKey(newKeys[i]);
        }
        userSharedOrderRepository.saveAllAndFlush(rows);
    }

    /**
     * The key of a Shared-section neighbour. A sibling that is not in this section is
     * a client bug, not a position conflict: reject it instead of computing a key
     * between two unrelated namespaces.
     */
    @Transactional(readOnly = true)
    public String neighborKey(UUID userId, List<SharedEntry> entries, UUID siblingId, UUID excludedId) {
        if (siblingId == null) {
            return null;
        }
        if (siblingId.equals(excludedId)) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "A document cannot be its own sibling reference.");
        }
        SharedEntry sibling = entries.stream()
                .filter(entry -> entry.id().equals(siblingId))
                .findFirst()
                .orElseThrow(() -> new ApiException(
                        ErrorCode.VALIDATION_FAILED, "Sibling document is not in the Shared section: " + siblingId));
        if (isUsable(sibling.orderKey())) {
            return sibling.orderKey();
        }
        throw new ApiException(ErrorCode.CONFLICT, "The Shared section position changed. Please retry.");
    }

    /**
     * The key that places one section entry between the two siblings a drag named. Both
     * neighbours are section entries, so a keyless one answers CONFLICT instead of
     * inventing a position, and the interval is widened to the real neighbours below it
     * so a key cannot land on a row the client does not render.
     */
    @Transactional(readOnly = true)
    public String keyBetweenSiblings(
            UUID userId, List<SharedEntry> entries, UUID documentId, UUID prevSiblingId, UUID nextSiblingId) {
        String prevKey = neighborKey(userId, entries, prevSiblingId, documentId);
        String nextKey = neighborKey(userId, entries, nextSiblingId, documentId);
        return OrderInterval.placeBetween(prevKey, nextKey, new OrderInterval.Neighbors() {
            @Override
            public String after(String key) {
                return successorOf(userId, key, documentId).orElse(null);
            }

            @Override
            public String before(String key) {
                return predecessorOf(userId, key, documentId).orElse(null);
            }

            @Override
            public String last() {
                return maxKey(userId, documentId).orElse(null);
            }
        });
    }

    @Transactional(readOnly = true)
    public Optional<String> maxKey(UUID userId, UUID excludedId) {
        return userSharedOrderRepository
                .findMaxOrderKeyByUserId(userId, excludedId)
                .filter(SharedSectionService::isUsable);
    }

    @Transactional(readOnly = true)
    public Optional<String> predecessorOf(UUID userId, String key, UUID excludedId) {
        return userSharedOrderRepository
                .findMaxOrderKeyLessThan(userId, key, excludedId)
                .filter(SharedSectionService::isUsable);
    }

    @Transactional(readOnly = true)
    public Optional<String> successorOf(UUID userId, String key, UUID excludedId) {
        return userSharedOrderRepository
                .findMinOrderKeyGreaterThan(userId, key, excludedId)
                .filter(SharedSectionService::isUsable);
    }

    /**
     * Gives one document a Shared position at the top of the section. Used when a
     * grant creates the caller's entry; the listing can otherwise render an entry
     * without a key until the first reorder.
     *
     * <p>The race is two different pages granted to the same user at the same time, not
     * only one page granted twice: both compute the top key from the same section and the
     * second insert trips uq_user_shared_orders_user_order_key, inside a caller (a grant
     * write) that has no position retry. The document lock keeps this page from being
     * inserted twice; the user lock is what serializes the key calculation across pages.
     */
    @Transactional
    public void ensureOrderRow(User user, Document document) {
        if (userSharedOrderRepository.existsByUser_IdAndDocument_Id(user.getId(), document.getId())) {
            return;
        }
        lockForOrderInsert(List.of(document.getId()));
        lockOrderNamespace(user.getId());
        if (userSharedOrderRepository.existsByUser_IdAndDocument_Id(user.getId(), document.getId())) {
            return;
        }
        String minKey = userSharedOrderRepository
                .findMinOrderKeyByUserId(user.getId(), document.getId())
                .filter(SharedSectionService::isUsable)
                .orElse(null);
        userSharedOrderRepository.saveAndFlush(UserSharedOrder.builder()
                .user(user)
                .document(document)
                .orderKey(nextFreeKey(user.getId(), null, minKey))
                .build());
    }

    /**
     * The batch form of {@link #ensureOrderRow}: one page lock and one account lock for
     * a set of pages, instead of paying both per page. Restore and the sharing reconcile
     * both walk many pages for the same user, and the lock ordering is what makes the
     * batch safe: every page lock is taken before the account lock, exactly as a single
     * insert does.
     *
     * <p>Only pages without a row are inserted. The check runs again under the locks,
     * because another tab can insert a row while this transaction waits for the account.
     */
    @Transactional
    public void ensureOrderRows(User user, Collection<Document> documents) {
        if (documents == null || documents.isEmpty()) {
            return;
        }
        Map<UUID, Document> byId = new HashMap<>();
        for (Document document : documents) {
            if (document != null) {
                byId.putIfAbsent(document.getId(), document);
            }
        }
        if (byId.isEmpty()) {
            return;
        }
        List<UUID> ids = byId.keySet().stream().sorted().toList();
        Set<UUID> existing = new HashSet<>(
                userSharedOrderRepository.findExistingDocumentIdsByUserIdAndDocumentIds(user.getId(), ids));
        List<UUID> missing = ids.stream().filter(id -> !existing.contains(id)).toList();
        if (missing.isEmpty()) {
            return;
        }
        lockForOrderInsert(missing);
        lockOrderNamespace(user.getId());
        Set<UUID> existingAfterLock = new HashSet<>(
                userSharedOrderRepository.findExistingDocumentIdsByUserIdAndDocumentIds(user.getId(), missing));
        List<Document> stillMissing = missing.stream()
                .filter(id -> !existingAfterLock.contains(id))
                .map(byId::get)
                .toList();
        if (stillMissing.isEmpty()) {
            return;
        }

        // New rows go above the current top, in input order. Every stored key stays free,
        // including a row for a page that is not currently listed, so the key allocation
        // has to look at all of them rather than only at the section listing.
        Set<String> usedKeys = new HashSet<>(userSharedOrderRepository.findAllOrderKeysByUserId(user.getId()));
        String upperBound = userSharedOrderRepository
                .findMinOrderKeyByUserId(user.getId(), stillMissing.get(0).getId())
                .filter(SharedSectionService::isUsable)
                .orElse(null);
        String[] keys = new String[stillMissing.size()];
        for (int i = keys.length - 1; i >= 0; i--) {
            keys[i] = nextFreeKeyBefore(upperBound, usedKeys);
            upperBound = keys[i];
        }

        List<UserSharedOrder> rows = new ArrayList<>(stillMissing.size());
        for (int i = 0; i < stillMissing.size(); i++) {
            rows.add(UserSharedOrder.builder()
                    .user(user)
                    .document(stillMissing.get(i))
                    .orderKey(keys[i])
                    .build());
        }
        userSharedOrderRepository.saveAllAndFlush(rows);
    }

    /**
     * Row-locks the pages this caller is about to place, in id order.
     *
     * <p>uq_user_shared_orders_user_doc names the page, so the page row is what keeps two
     * tabs from inserting the same (user, document) row. The ascending order is what keeps
     * overlapping drags from deadlocking (a lock query would otherwise follow the client's
     * order), and {@link #lockOrderNamespace} is always taken after it: (user, order_key) is
     * unique across pages, so the page lock alone does not serialize key computation.
     */
    private void lockForOrderInsert(Collection<UUID> documentIds) {
        List<UUID> ordered = documentIds.stream()
                .filter(Objects::nonNull)
                .distinct()
                .sorted()
                .toList();
        if (!ordered.isEmpty()) {
            documentRepository.findAllForOrderInsert(ordered);
        }
    }

    /**
     * Row-locks the account whose Shared key space is about to be written, so two
     * concurrent inserts cannot both compute the same top key. Callers hold no position
     * retry, so the duplicate has to be prevented rather than repaired.
     *
     * <p>Always taken after the document locks: a transaction that holds it has already
     * locked every page it will insert for, and so never waits for a document while
     * another transaction waits for this lock.
     */
    private void lockOrderNamespace(UUID userId) {
        userRepository.findByIdForUpdate(userId);
    }

    /**
     * The same lock for a caller that writes its own row: a reorder reads an interval from
     * the section and then saves the moved row, and a grant seeding this user's section at
     * that moment computes its top key from the same listing. Call it after {@link
     * #ensureOrders}, so the document locks it may take still come first.
     */
    public void lockOrderWrites(UUID userId) {
        lockOrderNamespace(userId);
    }

    private User requireUser(UUID userId) {
        return userRepository
                .findById(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "User not found: " + userId));
    }

    private Map<UUID, String> fetchOrderKeys(UUID userId, List<UUID> documentIds) {
        if (documentIds.isEmpty()) {
            return Map.of();
        }
        Map<UUID, String> keys = new HashMap<>();
        for (Object[] row : userSharedOrderRepository.findOrderKeysByUserIdAndDocumentIds(userId, documentIds)) {
            keys.put((UUID) row[0], (String) row[1]);
        }
        return keys;
    }

    /** A key gap that no longer exists is a position conflict, never a 500. */
    private String nextFreeKey(String previous, Set<String> usedKeys) {
        try {
            String candidate = FractionalIndex.keyBetween(previous, null);
            while (!usedKeys.add(candidate)) {
                candidate = FractionalIndex.keyBetween(previous, candidate);
            }
            return candidate;
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "The Shared section position changed. Please retry.");
        }
    }

    /** A key gap that no longer exists is a position conflict, never a 500. */
    private String nextFreeKey(UUID userId, String previous, String next) {
        try {
            String candidate = FractionalIndex.keyBetween(previous, next);
            while (userSharedOrderRepository.existsByUser_IdAndOrderKey(userId, candidate)) {
                candidate = FractionalIndex.keyBetween(previous, candidate);
            }
            return candidate;
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "The Shared section position changed. Please retry.");
        }
    }

    /** A free key below an existing upper bound, for a batch that inserts at the top. */
    private static String nextFreeKeyBefore(String upperBound, Set<String> usedKeys) {
        try {
            String candidate = FractionalIndex.keyBetween(null, upperBound);
            while (!usedKeys.add(candidate)) {
                candidate = FractionalIndex.keyBetween(null, candidate);
            }
            return candidate;
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "The Shared section position changed. Please retry.");
        }
    }

    private static boolean isUsable(String key) {
        return key != null && FractionalIndex.isValidOrderKey(key);
    }
}
