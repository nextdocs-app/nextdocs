package com.nextdocs.api.space.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.space.dto.request.SpaceCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberAccessUpdateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceUpdateRequest;
import com.nextdocs.api.space.dto.response.SpaceMemberResponse;
import com.nextdocs.api.space.dto.response.SpaceResponse;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class SpaceServiceTest {

    @Mock
    private SpaceRepository spaceRepository;

    @Mock
    private SpaceMemberRepository memberRepository;

    @Mock
    private DocumentRepository documentRepository;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    @Mock
    private WorkspaceMemberRepository workspaceMemberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private SpaceAccessService spaceAccessService;

    @Mock
    private DocumentService documentService;

    @Mock
    private PageIconValidator pageIconValidator;

    private SpaceService spaceService;

    private Workspace workspace;
    private User actor;
    private UUID actorId;
    private Space space;

    @BeforeEach
    void setUp() {
        spaceService = new SpaceService(
                spaceRepository,
                memberRepository,
                documentRepository,
                workspaceAccessService,
                workspaceMemberRepository,
                userRepository,
                spaceAccessService,
                documentService,
                pageIconValidator);

        workspace = Workspace.builder().id(UUID.randomUUID()).name("NextDocs").build();
        actor = User.builder().email("owner@example.com").displayName("Owner").build();
        actorId = UUID.randomUUID();
        actor.setId(actorId);
        space = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Engineering")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .createdAt(OffsetDateTime.now())
                .updatedAt(OffsetDateTime.now())
                .build();
    }

    private void callerIsWorkspaceMember(WorkspaceRole role) {
        WorkspaceMember membership = WorkspaceMember.builder()
                .workspace(workspace)
                .user(actor)
                .role(role)
                .build();
        when(workspaceAccessService.requireMember(actorId))
                .thenReturn(new WorkspaceAccessService.Membership(workspace, membership));
    }

    private void callerAdministers(DocumentAccessLevel level) {
        lenient()
                .when(spaceAccessService.requireAdministration(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, level));
    }

    private SpaceMember member(User user, DocumentAccessLevel level) {
        return SpaceMember.builder()
                .space(space)
                .user(user)
                .accessLevel(level)
                .createdAt(OffsetDateTime.now())
                .build();
    }

    @Test
    void createSpace_makesTheCreatorTheFirstOwner() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        when(spaceRepository.save(any(Space.class))).thenAnswer(invocation -> {
            Space saved = invocation.getArgument(0);
            saved.setId(space.getId());
            saved.setCreatedAt(OffsetDateTime.now());
            saved.setUpdatedAt(OffsetDateTime.now());
            return saved;
        });

        SpaceResponse response =
                spaceService.createSpace(actorId, new SpaceCreateRequest("Engineering", null, null, null));

        ArgumentCaptor<SpaceMember> memberCaptor = ArgumentCaptor.forClass(SpaceMember.class);
        verify(memberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getUser()).isSameAs(actor);
        assertThat(memberCaptor.getValue().getAccessLevel()).isEqualTo(DocumentAccessLevel.OWNER);

        assertThat(response.name()).isEqualTo("Engineering");
        assertThat(response.accessMode()).isEqualTo(SpaceAccessMode.CUSTOM);
        assertThat(response.everyoneAccessLevel()).isEqualTo(DocumentAccessLevel.VIEW);
        assertThat(response.myAccessLevel()).isEqualTo(DocumentAccessLevel.OWNER);
        assertThat(response.canAdminister()).isTrue();
        assertThat(response.memberCount()).isEqualTo(1);
    }

    @Test
    void createSpace_publicKeepsTheChosenEveryoneLevel() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        when(spaceRepository.save(any(Space.class))).thenAnswer(invocation -> invocation.getArgument(0));

        SpaceResponse response = spaceService.createSpace(
                actorId,
                new SpaceCreateRequest("Engineering", null, SpaceAccessMode.PUBLIC, DocumentAccessLevel.COMMENT));

        assertThat(response.accessMode()).isEqualTo(SpaceAccessMode.PUBLIC);
        assertThat(response.everyoneAccessLevel()).isEqualTo(DocumentAccessLevel.COMMENT);
    }

    @Test
    void createSpace_rejectsOwnershipAsTheEveryoneLevel() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);

        assertThatThrownBy(() -> spaceService.createSpace(
                        actorId,
                        new SpaceCreateRequest("Engineering", null, SpaceAccessMode.PUBLIC, DocumentAccessLevel.OWNER)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        verify(spaceRepository, never()).save(any(Space.class));
    }

    @Test
    void createSpace_rejectsABlankName() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);

        assertThatThrownBy(() -> spaceService.createSpace(actorId, new SpaceCreateRequest("   ", null, null, null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void listMembers_returnsTheRosterThroughTheRosterGate() {
        when(spaceAccessService.requireRoster(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(memberRepository.findAllBySpace_IdOrderByCreatedAtAsc(space.getId()))
                .thenReturn(List.of(member(actor, DocumentAccessLevel.OWNER)));

        List<SpaceMemberResponse> roster = spaceService.listMembers(actorId, space.getId());

        assertThat(roster).extracting(SpaceMemberResponse::email).containsExactly("owner@example.com");
        assertThat(roster).extracting(SpaceMemberResponse::accessLevel).containsExactly(DocumentAccessLevel.OWNER);
    }

    @Test
    void getSpace_projectsTheCallersLevelAndCounts() {
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(3L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(7L);

        SpaceResponse response = spaceService.getSpace(actorId, space.getId());

        assertThat(response.myAccessLevel()).isEqualTo(DocumentAccessLevel.OWNER);
        assertThat(response.memberCount()).isEqualTo(3);
        assertThat(response.pageCount()).isEqualTo(7);
        assertThat(response.canAdminister()).isTrue();
    }

    @Test
    void updateSpace_appliesOnlyTheProvidedFields() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(spaceRepository.save(any(Space.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(spaceAccessService.resolveLevel(actorId, space)).thenReturn(DocumentAccessLevel.OWNER);
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(2L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(0L);

        SpaceResponse response = spaceService.updateSpace(
                actorId,
                space.getId(),
                new SpaceUpdateRequest("Platform", null, SpaceAccessMode.PUBLIC, DocumentAccessLevel.EDIT));

        assertThat(response.name()).isEqualTo("Platform");
        assertThat(response.accessMode()).isEqualTo(SpaceAccessMode.PUBLIC);
        assertThat(response.everyoneAccessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
    }

    @Test
    void addMember_resolvesAnExistingWorkspaceMemberByEmail() {
        callerAdministers(DocumentAccessLevel.OWNER);
        User bob = User.builder().email("bob@example.com").displayName("Bob").build();
        bob.setId(UUID.randomUUID());
        when(userRepository.findByEmail("bob@example.com")).thenReturn(Optional.of(bob));
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspace.getId(), bob.getId()))
                .thenReturn(Optional.of(WorkspaceMember.builder()
                        .workspace(workspace)
                        .user(bob)
                        .role(WorkspaceRole.MEMBER)
                        .build()));
        when(memberRepository.existsBySpace_IdAndUser_Id(space.getId(), bob.getId()))
                .thenReturn(false);
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(memberRepository.findAllBySpace_IdOrderByCreatedAtAsc(space.getId()))
                .thenReturn(List.of(member(bob, DocumentAccessLevel.EDIT)));

        List<SpaceMemberResponse> roster = spaceService.addMember(
                actorId, space.getId(), new SpaceMemberCreateRequest("bob@example.com", DocumentAccessLevel.EDIT));

        assertThat(roster).hasSize(1);
        assertThat(roster.get(0).accessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
        ArgumentCaptor<SpaceMember> captor = ArgumentCaptor.forClass(SpaceMember.class);
        verify(memberRepository).save(captor.capture());
        assertThat(captor.getValue().getAccessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
        assertThat(captor.getValue().getGrantedBy()).isSameAs(actor);
    }

    @Test
    void addMember_rejectsSomeoneWhoIsNotInTheWorkspace() {
        callerAdministers(DocumentAccessLevel.OWNER);
        User stranger = User.builder()
                .email("stranger@example.com")
                .displayName("Stranger")
                .build();
        stranger.setId(UUID.randomUUID());
        when(userRepository.findByEmail("stranger@example.com")).thenReturn(Optional.of(stranger));
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspace.getId(), stranger.getId()))
                .thenReturn(Optional.empty());

        assertThatThrownBy(() -> spaceService.addMember(
                        actorId,
                        space.getId(),
                        new SpaceMemberCreateRequest("stranger@example.com", DocumentAccessLevel.VIEW)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void addMember_rejectsAnExistingMemberInsteadOfSilentlyChangingTheirLevel() {
        callerAdministers(DocumentAccessLevel.OWNER);
        User bob = User.builder().email("bob@example.com").displayName("Bob").build();
        bob.setId(UUID.randomUUID());
        when(userRepository.findByEmail("bob@example.com")).thenReturn(Optional.of(bob));
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspace.getId(), bob.getId()))
                .thenReturn(Optional.of(WorkspaceMember.builder()
                        .workspace(workspace)
                        .user(bob)
                        .role(WorkspaceRole.MEMBER)
                        .build()));
        when(memberRepository.existsBySpace_IdAndUser_Id(space.getId(), bob.getId()))
                .thenReturn(true);

        assertThatThrownBy(() -> spaceService.addMember(
                        actorId,
                        space.getId(),
                        new SpaceMemberCreateRequest("bob@example.com", DocumentAccessLevel.VIEW)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
    }

    @Test
    void addMember_rejectsNoAccessAsAMembershipLevel() {
        callerAdministers(DocumentAccessLevel.OWNER);

        assertThatThrownBy(() -> spaceService.addMember(
                        actorId,
                        space.getId(),
                        new SpaceMemberCreateRequest("bob@example.com", DocumentAccessLevel.NO_ACCESS)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void updateMemberAccess_refusesToDemoteTheLastOwner() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(memberRepository.findBySpace_IdAndUser_Id(space.getId(), actorId))
                .thenReturn(Optional.of(member(actor, DocumentAccessLevel.OWNER)));
        when(memberRepository.countBySpace_IdAndAccessLevel(space.getId(), DocumentAccessLevel.OWNER))
                .thenReturn(1L);

        assertThatThrownBy(() -> spaceService.updateMemberAccess(
                        actorId, space.getId(), actorId, new SpaceMemberAccessUpdateRequest(DocumentAccessLevel.EDIT)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(memberRepository, never()).save(any(SpaceMember.class));
    }

    @Test
    void updateMemberAccess_promotesAnotherMemberToOwner() {
        callerAdministers(DocumentAccessLevel.OWNER);
        User bob = User.builder().email("bob@example.com").displayName("Bob").build();
        bob.setId(UUID.randomUUID());
        SpaceMember bobRow = member(bob, DocumentAccessLevel.EDIT);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(memberRepository.findBySpace_IdAndUser_Id(space.getId(), bob.getId()))
                .thenReturn(Optional.of(bobRow));
        when(memberRepository.save(bobRow)).thenReturn(bobRow);
        when(memberRepository.findAllBySpace_IdOrderByCreatedAtAsc(space.getId()))
                .thenReturn(List.of(member(actor, DocumentAccessLevel.OWNER), bobRow));

        List<SpaceMemberResponse> roster = spaceService.updateMemberAccess(
                actorId, space.getId(), bob.getId(), new SpaceMemberAccessUpdateRequest(DocumentAccessLevel.OWNER));

        assertThat(bobRow.getAccessLevel()).isEqualTo(DocumentAccessLevel.OWNER);
        assertThat(roster).extracting(SpaceMemberResponse::accessLevel).contains(DocumentAccessLevel.OWNER);
    }

    @Test
    void removeMember_refusesToLetTheLastOwnerLeave() {
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(memberRepository.findBySpace_IdAndUser_Id(space.getId(), actorId))
                .thenReturn(Optional.of(member(actor, DocumentAccessLevel.OWNER)));
        when(memberRepository.countBySpace_IdAndAccessLevel(space.getId(), DocumentAccessLevel.OWNER))
                .thenReturn(1L);

        assertThatThrownBy(() -> spaceService.removeMember(actorId, space.getId(), actorId))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(memberRepository, never()).delete(any(SpaceMember.class));
    }

    @Test
    void removeMember_allowsAMemberToLeave() {
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.VIEW));
        SpaceMember ownRow = member(actor, DocumentAccessLevel.VIEW);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(memberRepository.findBySpace_IdAndUser_Id(space.getId(), actorId)).thenReturn(Optional.of(ownRow));
        when(memberRepository.findAllBySpace_IdOrderByCreatedAtAsc(space.getId()))
                .thenReturn(List.of());

        spaceService.removeMember(actorId, space.getId(), actorId);

        verify(memberRepository).delete(ownRow);
    }

    @Test
    void deleteSpace_refusesAPopulatedSpaceUnlessPagesAreDeletedToo() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(documentRepository.findAllBySpace_IdAndParentIsNullAndDeletedAtIsNull(space.getId()))
                .thenReturn(List.of(Document.builder()
                        .id(UUID.randomUUID())
                        .user(actor)
                        .title("Page")
                        .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                        .build()));

        assertThatThrownBy(() -> spaceService.deleteSpace(actorId, space.getId(), false))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(spaceRepository, never()).delete(any(Space.class));
        verify(documentService, never()).trashSubtree(any(Document.class));
    }

    @Test
    void deleteSpace_trashesThePagesWhenExplicitlyAsked() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        Document page = Document.builder()
                .id(UUID.randomUUID())
                .user(actor)
                .title("Page")
                .yjsState("seed".getBytes(StandardCharsets.UTF_8))
                .build();
        when(documentRepository.findAllBySpace_IdAndParentIsNullAndDeletedAtIsNull(space.getId()))
                .thenReturn(List.of(page));

        spaceService.deleteSpace(actorId, space.getId(), true);

        verify(documentService).trashSubtree(page);
        verify(spaceRepository).delete(space);
    }

    @Test
    void deleteSpace_deletesAnEmptySpaceWithoutTrashingAnything() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(documentRepository.findAllBySpace_IdAndParentIsNullAndDeletedAtIsNull(space.getId()))
                .thenReturn(List.of());

        spaceService.deleteSpace(actorId, space.getId(), false);

        verify(documentService, never()).trashSubtree(any(Document.class));
        verify(spaceRepository).delete(space);
    }

    @Test
    void listSpaces_givesAMemberTheirOwnSpacesAndEveryPublicOne() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        Space publicSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Handbook")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        when(spaceRepository.findAllVisibleToUser(workspace.getId(), actorId)).thenReturn(List.of(space, publicSpace));
        when(memberRepository.findAllByUser_Id(actorId)).thenReturn(List.of(member(actor, DocumentAccessLevel.OWNER)));
        when(memberRepository.countMembersBySpaceIds(any())).thenReturn(List.<Object[]>of());
        when(documentRepository.countNonTrashedBySpaceIds(any())).thenReturn(List.<Object[]>of());

        List<SpaceResponse> spaces = spaceService.listSpaces(actorId);

        assertThat(spaces).extracting(SpaceResponse::name).containsExactly("Engineering", "Handbook");
        assertThat(spaces.get(0).myAccessLevel()).isEqualTo(DocumentAccessLevel.OWNER);
        assertThat(spaces.get(0).canAdminister()).isTrue();
        assertThat(spaces.get(1).myAccessLevel()).isEqualTo(DocumentAccessLevel.VIEW);
        assertThat(spaces.get(1).canAdminister()).isFalse();
    }

    @Test
    void listSpaces_givesAWorkspaceAdminEverySpace() {
        callerIsWorkspaceMember(WorkspaceRole.ADMIN);
        when(spaceRepository.findAllByWorkspace_IdOrderByCreatedAtAsc(workspace.getId()))
                .thenReturn(List.of(space));
        when(memberRepository.findAllByUser_Id(actorId)).thenReturn(List.of());
        when(memberRepository.countMembersBySpaceIds(any())).thenReturn(List.<Object[]>of());
        when(documentRepository.countNonTrashedBySpaceIds(any())).thenReturn(List.<Object[]>of());

        List<SpaceResponse> spaces = spaceService.listSpaces(actorId);

        assertThat(spaces).hasSize(1);
        assertThat(spaces.get(0).myAccessLevel()).isNull();
        assertThat(spaces.get(0).canAdminister()).isTrue();
        verify(spaceRepository, never()).findAllVisibleToUser(any(), any());
        verify(spaceRepository).findAllByWorkspace_IdOrderByCreatedAtAsc(eq(workspace.getId()));
    }
}
