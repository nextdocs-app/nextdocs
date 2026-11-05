package com.nextdocs.api.workspace.service;

import com.nextdocs.api.audit.entity.AccessAuditAction;
import com.nextdocs.api.audit.service.AccessAuditService;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.workspace.dto.request.WorkspaceGroupRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceGroupResponse;
import com.nextdocs.api.workspace.entity.WorkspaceGroup;
import com.nextdocs.api.workspace.entity.WorkspaceGroupMember;
import com.nextdocs.api.workspace.repository.WorkspaceGroupMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceGroupRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Flat workspace groups.
 *
 * <p>Groups are grant principals for pages, not an administrative layer. Any workspace
 * member can read the group directory; only an owner or admin may change it. Adding a
 * member is validated against the workspace roster so a group can never become a
 * cross-workspace grant by accepting an arbitrary user id.
 */
@Service
@RequiredArgsConstructor
public class WorkspaceGroupService {

    private final WorkspaceGroupRepository groupRepository;
    private final WorkspaceGroupMemberRepository memberRepository;
    private final WorkspaceMemberRepository workspaceMemberRepository;
    private final UserRepository userRepository;
    private final WorkspaceAccessService accessService;
    private final AccessAuditService auditService;

    @Transactional(readOnly = true)
    public List<WorkspaceGroupResponse> list(UUID actorId) {
        WorkspaceAccessService.Membership membership = accessService.requireMember(actorId);
        List<WorkspaceGroup> groups = groupRepository.findAllByWorkspace_IdOrderByNameAsc(
                membership.workspace().getId());
        if (groups.isEmpty()) {
            return List.of();
        }
        Map<UUID, List<User>> membersByGroup = membersByGroup(groups);
        return groups.stream()
                .map(group -> toResponse(group, membersByGroup.getOrDefault(group.getId(), List.of())))
                .toList();
    }

    @Transactional
    public WorkspaceGroupResponse create(UUID actorId, WorkspaceGroupRequest request) {
        WorkspaceAccessService.Membership membership = accessService.requireAdmin(actorId);
        String name = normalizeName(request.name());
        if (groupRepository.existsByWorkspace_IdAndNameIgnoreCase(
                membership.workspace().getId(), name)) {
            throw new ApiException(ErrorCode.CONFLICT, "A group with that name already exists.");
        }

        WorkspaceGroup group = WorkspaceGroup.builder()
                .workspace(membership.workspace())
                .name(name)
                .build();
        try {
            group = groupRepository.saveAndFlush(group);
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "A group with that name already exists.");
        }
        replaceMembers(group, request.memberIds());
        auditService.record(
                membership.workspace().getId(),
                null,
                null,
                actorId,
                AccessAuditAction.GROUP_CREATE,
                "GROUP",
                group.getId(),
                "name=" + name);
        return toResponse(group, membersOf(group.getId()));
    }

    @Transactional
    public WorkspaceGroupResponse update(UUID actorId, UUID groupId, WorkspaceGroupRequest request) {
        WorkspaceAccessService.Membership membership = accessService.requireAdmin(actorId);
        WorkspaceGroup group = requireGroup(membership.workspace().getId(), groupId);
        String name = normalizeName(request.name());
        if (!name.equalsIgnoreCase(group.getName())
                && groupRepository.existsByWorkspace_IdAndNameIgnoreCase(
                        membership.workspace().getId(), name)) {
            throw new ApiException(ErrorCode.CONFLICT, "A group with that name already exists.");
        }
        group.setName(name);
        try {
            group = groupRepository.saveAndFlush(group);
        } catch (DataIntegrityViolationException ex) {
            throw new ApiException(ErrorCode.CONFLICT, "A group with that name already exists.");
        }
        replaceMembers(group, request.memberIds());
        auditService.record(
                membership.workspace().getId(),
                null,
                null,
                actorId,
                AccessAuditAction.GROUP_UPDATE,
                "GROUP",
                group.getId(),
                "name=" + name);
        return toResponse(group, membersOf(group.getId()));
    }

    @Transactional
    public void delete(UUID actorId, UUID groupId) {
        WorkspaceAccessService.Membership membership = accessService.requireAdmin(actorId);
        WorkspaceGroup group = requireGroup(membership.workspace().getId(), groupId);
        // Page grants referencing this group cascade at the database boundary; deleting
        // the group first keeps the H2 entity-created test schema consistent too.
        memberRepository.deleteById_GroupId(group.getId());
        groupRepository.delete(group);
        auditService.record(
                membership.workspace().getId(),
                null,
                null,
                actorId,
                AccessAuditAction.GROUP_DELETE,
                "GROUP",
                group.getId(),
                "name=" + group.getName());
    }

    private WorkspaceGroup requireGroup(UUID workspaceId, UUID groupId) {
        return groupRepository
                .findByIdAndWorkspace_Id(groupId, workspaceId)
                .orElseThrow(() -> new ApiException(ErrorCode.NOT_FOUND, "Group not found."));
    }

    private void replaceMembers(WorkspaceGroup group, List<UUID> requestedUserIds) {
        LinkedHashSet<UUID> userIds =
                requestedUserIds == null ? new LinkedHashSet<>() : new LinkedHashSet<>(requestedUserIds);
        // Validate every member before deleting the current roster, so an invalid id
        // fails without relying on transaction rollback to restore the old list.
        if (!userIds.isEmpty()
                && !new HashSet<>(workspaceMemberRepository.findUserIdsByWorkspaceIdAndUserIdIn(
                                group.getWorkspace().getId(), userIds))
                        .containsAll(userIds)) {
            throw new ApiException(ErrorCode.NOT_FOUND, "Every group member must belong to the workspace.");
        }
        memberRepository.deleteById_GroupId(group.getId());
        for (UUID userId : userIds) {
            memberRepository.save(new WorkspaceGroupMember(group.getId(), userId));
        }
    }

    private Map<UUID, List<User>> membersByGroup(List<WorkspaceGroup> groups) {
        return membersByGroupIds(groups.stream().map(WorkspaceGroup::getId).toList());
    }

    private List<User> membersOf(UUID groupId) {
        return membersByGroupIds(List.of(groupId)).getOrDefault(groupId, List.of());
    }

    /** One member-row query plus one user query for any number of groups. */
    private Map<UUID, List<User>> membersByGroupIds(List<UUID> groupIds) {
        Map<UUID, List<User>> result =
                groupIds.stream().collect(Collectors.toMap(Function.identity(), ignored -> new ArrayList<>()));
        Map<UUID, List<UUID>> userIdsByGroup = memberRepository.findAllById_GroupIdIn(groupIds).stream()
                .collect(Collectors.groupingBy(
                        member -> member.getId().getGroupId(),
                        Collectors.mapping(member -> member.getId().getUserId(), Collectors.toList())));
        List<UUID> allUserIds = userIdsByGroup.values().stream()
                .flatMap(List::stream)
                .distinct()
                .toList();
        Map<UUID, User> users = userRepository.findAllById(allUserIds).stream()
                .collect(Collectors.toMap(User::getId, Function.identity()));
        userIdsByGroup.forEach((groupId, userIds) -> result.put(
                groupId,
                userIds.stream()
                        .map(users::get)
                        .filter(java.util.Objects::nonNull)
                        .sorted(Comparator.comparing(WorkspaceGroupService::displayName))
                        .toList()));
        return result;
    }

    private static WorkspaceGroupResponse toResponse(WorkspaceGroup group, List<User> members) {
        return new WorkspaceGroupResponse(
                group.getId(),
                group.getName(),
                members.stream()
                        .map(user -> new WorkspaceGroupResponse.Member(
                                user.getId(), user.getEmail(), user.getDisplayName(), user.getAvatarUrl()))
                        .toList(),
                group.getCreatedAt(),
                group.getUpdatedAt());
    }

    private static String normalizeName(String raw) {
        String name = raw == null ? "" : raw.strip();
        if (name.isEmpty()) {
            throw new ApiException(ErrorCode.VALIDATION_FAILED, "Group name must not be blank.");
        }
        return name;
    }

    private static String displayName(User user) {
        return user.getDisplayName() == null ? user.getEmail() : user.getDisplayName();
    }
}
