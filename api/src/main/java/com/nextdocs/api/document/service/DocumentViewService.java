package com.nextdocs.api.document.service;

import com.nextdocs.api.document.dto.response.DocumentViewerResponse;
import com.nextdocs.api.document.entity.DocumentView;
import com.nextdocs.api.document.repository.DocumentViewRepository;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.user.repository.UserRepository;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataAccessException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Slf4j
@Service
@RequiredArgsConstructor
public class DocumentViewService {

    private final DocumentViewRepository repository;
    private final UserRepository userRepository;
    private final PermissionService permissionService;

    /**
     * Records that {@code userId} looked at {@code documentId}.
     *
     * <p>Deliberately not transactional: each repository call owns its transaction, so a
     * failed write (a concurrent first visit racing the unique constraint) can be
     * swallowed here instead of marking an outer transaction rollback-only and failing
     * the view request anyway. View history is decoration — losing one refresh is fine.
     */
    public void recordView(UUID documentId, UUID userId) {
        try {
            DocumentView view = repository
                    .findByDocumentIdAndUserId(documentId, userId)
                    .orElseGet(() -> DocumentView.builder()
                            .documentId(documentId)
                            .userId(userId)
                            .build());
            view.setLastViewedAt(OffsetDateTime.now(ZoneOffset.UTC));
            repository.save(view);
        } catch (DataAccessException exception) {
            log.warn("Could not update view history for document {}: {}", documentId, exception.getMessage());
        }
    }

    /**
     * The people who have opened the document recently, newest visit first.
     *
     * <p>The gate is here, next to the data, exactly like the collaborator roster: whoever
     * may read the document may see its view history, which is how a link holder or a
     * public-space reader shows up in the group they are part of. A stranger is masked as
     * not found. History is not sharing, so the rows carry no access level and no email,
     * and a person whose access was revoked after reading keeps their place: "viewed" is
     * a fact about the past, not a permission.
     */
    @Transactional(readOnly = true)
    public List<DocumentViewerResponse> viewers(UUID requesterId, UUID documentId) {
        permissionService.requireReadAccessIncludingTrash(requesterId, documentId);

        List<DocumentView> rows = repository.findTop50ByDocumentIdOrderByLastViewedAtDescIdAsc(documentId);
        if (rows.isEmpty()) {
            return List.of();
        }

        List<UUID> userIds =
                rows.stream().map(DocumentView::getUserId).distinct().toList();
        Map<UUID, User> usersById = new HashMap<>();
        for (User user : userRepository.findAllById(userIds)) {
            usersById.put(user.getId(), user);
        }

        List<DocumentViewerResponse> viewers = new ArrayList<>(rows.size());
        for (DocumentView row : rows) {
            // The foreign key cascades on account deletion, so a missing account means the
            // row is orphaned rather than deleted: drop it instead of rendering a blank
            // avatar. A deactivated account still names itself - it really did read this.
            User user = usersById.get(row.getUserId());
            if (user == null) {
                continue;
            }
            viewers.add(new DocumentViewerResponse(
                    user.getId(), user.getDisplayName(), user.getAvatarUrl(), row.getLastViewedAt()));
        }
        return viewers;
    }
}
