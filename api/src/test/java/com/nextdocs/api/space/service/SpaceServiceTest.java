package com.nextdocs.api.space.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentService;
import com.nextdocs.api.document.util.FractionalIndex;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.space.dto.request.SpaceCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberAccessUpdateRequest;
import com.nextdocs.api.space.dto.request.SpaceMemberCreateRequest;
import com.nextdocs.api.space.dto.request.SpaceMoveRequest;
import com.nextdocs.api.space.dto.request.SpaceUpdateRequest;
import com.nextdocs.api.space.dto.response.SpaceMemberResponse;
import com.nextdocs.api.space.dto.response.SpaceResponse;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.entity.UserSpaceOrder;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.space.repository.UserSpaceOrderRepository;
import com.nextdocs.api.space.service.SpaceAccessService.SpaceContext;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.dao.DataIntegrityViolationException;

@ExtendWith(MockitoExtension.class)
class SpaceServiceTest {

    @Mock
    private SpaceRepository spaceRepository;

    @Mock
    private SpaceMemberRepository memberRepository;

    @Mock
    private UserSpaceOrderRepository userSpaceOrderRepository;

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
                userSpaceOrderRepository,
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
        lenient()
                .when(spaceAccessService.requireActiveAdministration(actorId, space.getId()))
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
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
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
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
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
    void addMember_refusesAnArchiveCommittedWhileWaitingForTheRowLock() {
        when(spaceAccessService.requireActiveAdministration(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER))
                .thenThrow(new ApiException(ErrorCode.CONFLICT));
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        User bob = User.builder().email("bob@example.com").displayName("Bob").build();
        bob.setId(UUID.randomUUID());
        when(userRepository.findByEmail("bob@example.com")).thenReturn(Optional.of(bob));
        when(workspaceMemberRepository.findByWorkspaceIdAndUserId(workspace.getId(), bob.getId()))
                .thenReturn(Optional.of(WorkspaceMember.builder()
                        .workspace(workspace)
                        .user(bob)
                        .role(WorkspaceRole.MEMBER)
                        .build()));

        assertThatThrownBy(() -> spaceService.addMember(
                        actorId,
                        space.getId(),
                        new SpaceMemberCreateRequest("bob@example.com", DocumentAccessLevel.EDIT)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(memberRepository, never()).save(any(SpaceMember.class));
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
    void attachPage_locksTheSpaceAndLeavesTheGateToDocumentService() {
        UUID documentId = UUID.randomUUID();
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));

        spaceService.attachPage(actorId, space.getId(), documentId);

        verify(spaceRepository).findByIdForUpdate(space.getId());
        verify(documentService).assignSpace(actorId, documentId, space.getId());
        verify(spaceAccessService, never()).requireActiveAdministration(any(), any());
    }

    @Test
    void detachPage_locksTheSpaceAndLeavesTheGateToDocumentService() {
        UUID documentId = UUID.randomUUID();
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));

        spaceService.detachPage(actorId, space.getId(), documentId);

        verify(spaceRepository).findByIdForUpdate(space.getId());
        verify(documentService).clearSpace(actorId, documentId, space.getId());
        verify(spaceAccessService, never()).requireActiveAdministration(any(), any());
    }

    @Test
    void deleteSpace_refusesASpaceThatStillHasPagesIncludingTrash() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(documentRepository.countBySpace_Id(space.getId())).thenReturn(2L);

        assertThatThrownBy(() -> spaceService.deleteSpace(actorId, space.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(spaceRepository, never()).delete(any(Space.class));
    }

    @Test
    void deleteSpace_deletesAnEmptySpace() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(documentRepository.countBySpace_Id(space.getId())).thenReturn(0L);

        spaceService.deleteSpace(actorId, space.getId());

        verify(spaceRepository).delete(space);
    }

    @Test
    void archiveSpace_marksTheSpaceArchivedAndIsIdempotent() {
        callerAdministers(DocumentAccessLevel.OWNER);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(spaceRepository.save(any(Space.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(spaceAccessService.resolveLevel(actorId, space)).thenReturn(DocumentAccessLevel.OWNER);
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(1L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(4L);

        SpaceResponse response = spaceService.archiveSpace(actorId, space.getId());

        assertThat(space.getArchivedAt()).isNotNull();
        assertThat(space.getArchivedBy()).isSameAs(actor);
        assertThat(response.archivedAt()).isEqualTo(space.getArchivedAt());

        spaceService.archiveSpace(actorId, space.getId());

        verify(spaceRepository).save(space);
    }

    @Test
    void restoreSpace_clearsTheArchiveAndIsIdempotent() {
        callerAdministers(DocumentAccessLevel.OWNER);
        space.setArchivedAt(OffsetDateTime.now());
        space.setArchivedBy(actor);
        when(spaceRepository.findByIdForUpdate(space.getId())).thenReturn(Optional.of(space));
        when(spaceRepository.save(any(Space.class))).thenAnswer(invocation -> invocation.getArgument(0));
        when(spaceAccessService.resolveLevel(actorId, space)).thenReturn(DocumentAccessLevel.OWNER);
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(1L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(4L);

        SpaceResponse response = spaceService.restoreSpace(actorId, space.getId());

        assertThat(space.getArchivedAt()).isNull();
        assertThat(space.getArchivedBy()).isNull();
        assertThat(response.archivedAt()).isNull();

        spaceService.restoreSpace(actorId, space.getId());

        verify(spaceRepository).save(space);
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

        List<SpaceResponse> spaces = spaceService.listSpaces(actorId, false);

        assertThat(spaces).extracting(SpaceResponse::name).containsExactly("Engineering", "Handbook");
        assertThat(spaces.get(0).myAccessLevel()).isEqualTo(DocumentAccessLevel.OWNER);
        assertThat(spaces.get(0).canAdminister()).isTrue();
        assertThat(spaces.get(1).myAccessLevel()).isEqualTo(DocumentAccessLevel.VIEW);
        assertThat(spaces.get(1).canAdminister()).isFalse();
    }

    @Test
    void createSpace_placesTheNewSpaceAtTheTopOfTheCallersOrder() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        when(spaceRepository.save(any(Space.class))).thenAnswer(invocation -> {
            Space saved = invocation.getArgument(0);
            saved.setId(space.getId());
            saved.setCreatedAt(OffsetDateTime.now());
            saved.setUpdatedAt(OffsetDateTime.now());
            return saved;
        });
        when(userSpaceOrderRepository.findMinOrderKeyByUserId(actorId)).thenReturn(Optional.of("a5"));

        SpaceResponse response =
                spaceService.createSpace(actorId, new SpaceCreateRequest("Engineering", null, null, null));

        ArgumentCaptor<UserSpaceOrder> captor = ArgumentCaptor.forClass(UserSpaceOrder.class);
        verify(userSpaceOrderRepository).saveAndFlush(captor.capture());
        UserSpaceOrder order = captor.getValue();
        assertThat(order.getUser()).isSameAs(actor);
        assertThat(order.getSpace().getId()).isEqualTo(space.getId());
        assertThat(order.getOrderKey()).isLessThan("a5");
        assertThat(response.orderKey()).isEqualTo(order.getOrderKey());
    }

    @Test
    void listSpaces_carriesEachSpacesPersonalOrderKey() {
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
        when(userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(eq(actorId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {publicSpace.getId(), "a1"}));

        List<SpaceResponse> spaces = spaceService.listSpaces(actorId, false);

        assertThat(spaces).extracting(SpaceResponse::name).containsExactly("Engineering", "Handbook");
        assertThat(spaces).extracting(SpaceResponse::orderKey).containsExactly(null, "a1");
    }

    @Test
    void listSpaces_omitsAnInvalidPersonalOrderKey() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        when(spaceRepository.findAllVisibleToUser(workspace.getId(), actorId)).thenReturn(List.of(space));
        when(memberRepository.findAllByUser_Id(actorId)).thenReturn(List.of(member(actor, DocumentAccessLevel.OWNER)));
        when(memberRepository.countMembersBySpaceIds(any())).thenReturn(List.<Object[]>of());
        when(documentRepository.countNonTrashedBySpaceIds(any())).thenReturn(List.<Object[]>of());
        when(userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(eq(actorId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {space.getId(), "~reindex-0"}));

        List<SpaceResponse> spaces = spaceService.listSpaces(actorId, false);

        // An unparseable position is no position: the client keeps creation order until
        // a move rebuilds the row.
        assertThat(spaces.get(0).orderKey()).isNull();
    }

    @Test
    void moveSpace_prependsBeforeTheNextSibling() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        Space nextSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Handbook")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(spaceAccessService.requireRead(actorId, nextSpace.getId()))
                .thenReturn(new SpaceContext(nextSpace, WorkspaceRole.MEMBER, DocumentAccessLevel.VIEW));
        when(spaceRepository.findAllVisibleToUser(workspace.getId(), actorId)).thenReturn(List.of(nextSpace, space));
        when(userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(eq(actorId), any()))
                .thenReturn(
                        List.<Object[]>of(new Object[] {nextSpace.getId(), "a1"}, new Object[] {space.getId(), "a2"}));
        when(userSpaceOrderRepository.findOrderKeyByUserIdAndSpaceId(actorId, nextSpace.getId()))
                .thenReturn(Optional.of("a1"));
        UserSpaceOrder order =
                UserSpaceOrder.builder().user(actor).space(space).orderKey("a2").build();
        when(userSpaceOrderRepository.findByUser_IdAndSpace_Id(actorId, space.getId()))
                .thenReturn(Optional.of(order));
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(1L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(3L);

        SpaceResponse response =
                spaceService.moveSpace(actorId, space.getId(), new SpaceMoveRequest(null, nextSpace.getId()));

        assertThat(response.orderKey()).isLessThan("a1");
        assertThat(order.getOrderKey()).isEqualTo(response.orderKey());
        verify(userSpaceOrderRepository).saveAndFlush(order);
    }

    @Test
    void moveSpace_rejectsAnArchivedSpace() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        space.setArchivedAt(OffsetDateTime.now());
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));

        assertThatThrownBy(() -> spaceService.moveSpace(actorId, space.getId(), new SpaceMoveRequest(null, null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(userSpaceOrderRepository, never()).saveAndFlush(any(UserSpaceOrder.class));
    }

    @Test
    void moveSpace_afterThePreviousSibling_landsBeforeTheActualSuccessor() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        Space prevSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Handbook")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        Space successor = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Design")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(spaceAccessService.requireRead(actorId, prevSpace.getId()))
                .thenReturn(new SpaceContext(prevSpace, WorkspaceRole.MEMBER, DocumentAccessLevel.VIEW));
        when(spaceRepository.findAllVisibleToUser(workspace.getId(), actorId))
                .thenReturn(List.of(prevSpace, successor, space));
        when(userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(eq(actorId), any()))
                .thenReturn(List.<Object[]>of(
                        new Object[] {prevSpace.getId(), "a1"},
                        new Object[] {successor.getId(), "a2"},
                        new Object[] {space.getId(), "a5"}));
        when(userSpaceOrderRepository.findOrderKeyByUserIdAndSpaceId(actorId, prevSpace.getId()))
                .thenReturn(Optional.of("a1"));
        when(userSpaceOrderRepository.findMinOrderKeyGreaterThan(actorId, "a1", space.getId()))
                .thenReturn(Optional.of("a2"));
        UserSpaceOrder order =
                UserSpaceOrder.builder().user(actor).space(space).orderKey("a5").build();
        when(userSpaceOrderRepository.findByUser_IdAndSpace_Id(actorId, space.getId()))
                .thenReturn(Optional.of(order));
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(1L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(0L);

        SpaceResponse response =
                spaceService.moveSpace(actorId, space.getId(), new SpaceMoveRequest(prevSpace.getId(), null));

        // The new key fills the gap after the previous sibling, before the space that
        // currently follows it - not merely somewhere after the previous sibling.
        assertThat(response.orderKey()).isGreaterThan("a1").isLessThan("a2");
        verify(userSpaceOrderRepository).findMinOrderKeyGreaterThan(actorId, "a1", space.getId());
    }

    @Test
    void moveSpace_toTheEnd_materializesMissingRowsInDisplayedOrderThenAppends() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        Space second = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Handbook")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        Space third = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Design")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(spaceRepository.findAllVisibleToUser(workspace.getId(), actorId))
                .thenReturn(List.of(space, second, third));
        when(userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(eq(actorId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {space.getId(), "a1"}));
        when(userRepository.findById(actorId)).thenReturn(Optional.of(actor));
        when(userSpaceOrderRepository.findMaxOrderKeyByUserId(actorId, space.getId()))
                .thenReturn(Optional.of("a3"));
        UserSpaceOrder order =
                UserSpaceOrder.builder().user(actor).space(space).orderKey("a1").build();
        when(userSpaceOrderRepository.findByUser_IdAndSpace_Id(actorId, space.getId()))
                .thenReturn(Optional.of(order));
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(1L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(0L);

        SpaceResponse response = spaceService.moveSpace(actorId, space.getId(), new SpaceMoveRequest(null, null));

        // The unseen spaces get keys in the order the caller already sees them, and the
        // moved space then appends after the last of them.
        ArgumentCaptor<UserSpaceOrder> created = ArgumentCaptor.forClass(UserSpaceOrder.class);
        verify(userSpaceOrderRepository, times(2)).save(created.capture());
        assertThat(created.getAllValues()).extracting(UserSpaceOrder::getSpace).containsExactly(second, third);
        assertThat(created.getAllValues())
                .extracting(UserSpaceOrder::getOrderKey)
                .containsExactly("a2", "a3");
        verify(userSpaceOrderRepository).flush();
        assertThat(order.getOrderKey()).isEqualTo("a4");
        assertThat(response.orderKey()).isEqualTo("a4");
    }

    @Test
    void moveSpace_afterACollision_reindexesThroughTemporaryKeys() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        Space nextSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Handbook")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        Space thirdSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Design")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        UserSpaceOrder nextOrder = UserSpaceOrder.builder()
                .user(actor)
                .space(nextSpace)
                .orderKey("a1")
                .build();
        UserSpaceOrder movedOrder =
                UserSpaceOrder.builder().user(actor).space(space).orderKey("a2").build();
        UserSpaceOrder thirdOrder = UserSpaceOrder.builder()
                .user(actor)
                .space(thirdSpace)
                .orderKey("a3")
                .build();
        List<UserSpaceOrder> existingOrders = List.of(nextOrder, movedOrder, thirdOrder);

        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(spaceAccessService.requireRead(actorId, nextSpace.getId()))
                .thenReturn(new SpaceContext(nextSpace, WorkspaceRole.MEMBER, DocumentAccessLevel.VIEW));
        when(spaceRepository.findAllVisibleToUser(workspace.getId(), actorId))
                .thenReturn(List.of(nextSpace, space, thirdSpace));
        when(userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(eq(actorId), any()))
                .thenReturn(List.<Object[]>of(
                        new Object[] {nextSpace.getId(), "a1"},
                        new Object[] {space.getId(), "a2"},
                        new Object[] {thirdSpace.getId(), "a3"}));
        when(userSpaceOrderRepository.findOrderKeyByUserIdAndSpaceId(actorId, nextSpace.getId()))
                .thenReturn(Optional.of("a1"));
        when(userSpaceOrderRepository.findMinOrderKeyGreaterThan(actorId, "a1", space.getId()))
                .thenReturn(Optional.of("a3"));
        when(userSpaceOrderRepository.findByUser_IdAndSpace_Id(actorId, space.getId()))
                .thenReturn(Optional.of(movedOrder));
        when(userSpaceOrderRepository.findAllForReindex(actorId)).thenReturn(existingOrders);
        when(userSpaceOrderRepository.saveAndFlush(movedOrder))
                .thenThrow(new DataIntegrityViolationException("order_key unique violation"))
                .thenAnswer(invocation -> invocation.getArgument(0));
        when(memberRepository.countBySpace_Id(space.getId())).thenReturn(3L);
        when(documentRepository.countBySpace_IdAndDeletedAtIsNull(space.getId()))
                .thenReturn(0L);

        List<List<String>> keySnapshots = new ArrayList<>();
        doAnswer(invocation -> {
                    keySnapshots.add(existingOrders.stream()
                            .map(UserSpaceOrder::getOrderKey)
                            .toList());
                    return null;
                })
                .when(userSpaceOrderRepository)
                .flush();

        SpaceResponse response =
                spaceService.moveSpace(actorId, space.getId(), new SpaceMoveRequest(nextSpace.getId(), null));

        assertThat(response.orderKey()).isEqualTo("a2");
        verify(userSpaceOrderRepository).findAllForReindex(actorId);

        // The retry parks every row on a distinct temporary key, so no row can collide
        // with a neighbour's not-yet-replaced key under the unique constraint...
        int parkedAt = IntStream.range(0, keySnapshots.size())
                .filter(i -> keySnapshots.get(i).size() == existingOrders.size()
                        && keySnapshots.get(i).stream().noneMatch(FractionalIndex::isValidOrderKey))
                .findFirst()
                .orElseThrow();
        assertThat(keySnapshots.get(parkedAt)).doesNotHaveDuplicates();

        // ...before writing the final keys in one ordered, collision-free pass.
        assertThat(keySnapshots.get(parkedAt + 1))
                .hasSize(existingOrders.size())
                .allSatisfy(
                        key -> assertThat(FractionalIndex.isValidOrderKey(key)).isTrue())
                .isSorted()
                .doesNotHaveDuplicates();
    }

    @Test
    void moveSpace_rejectsASiblingTheCallerCannotRead() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        UUID invisibleSiblingId = UUID.randomUUID();
        when(spaceAccessService.requireRead(actorId, space.getId()))
                .thenReturn(new SpaceContext(space, WorkspaceRole.MEMBER, DocumentAccessLevel.OWNER));
        when(spaceRepository.findAllVisibleToUser(workspace.getId(), actorId)).thenReturn(List.of(space));
        when(userSpaceOrderRepository.findOrderKeysByUserIdAndSpaceIds(eq(actorId), any()))
                .thenReturn(List.<Object[]>of(new Object[] {space.getId(), "a1"}));
        when(spaceAccessService.requireRead(actorId, invisibleSiblingId))
                .thenThrow(new ApiException(ErrorCode.NOT_FOUND));

        assertThatThrownBy(() ->
                        spaceService.moveSpace(actorId, space.getId(), new SpaceMoveRequest(invisibleSiblingId, null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
        verify(userSpaceOrderRepository, never()).saveAndFlush(any(UserSpaceOrder.class));
    }

    @Test
    void listSpaces_givesAWorkspaceAdminEveryActiveSpace() {
        callerIsWorkspaceMember(WorkspaceRole.ADMIN);
        when(spaceRepository.findAllActiveForUser(workspace.getId(), actorId)).thenReturn(List.of(space));
        when(memberRepository.findAllByUser_Id(actorId)).thenReturn(List.of());
        when(memberRepository.countMembersBySpaceIds(any())).thenReturn(List.<Object[]>of());
        when(documentRepository.countNonTrashedBySpaceIds(any())).thenReturn(List.<Object[]>of());

        List<SpaceResponse> spaces = spaceService.listSpaces(actorId, false);

        assertThat(spaces).hasSize(1);
        assertThat(spaces.get(0).myAccessLevel()).isNull();
        assertThat(spaces.get(0).canAdminister()).isTrue();
        verify(spaceRepository, never()).findAllVisibleToUser(any(), any());
        verify(spaceRepository).findAllActiveForUser(workspace.getId(), actorId);
    }

    @Test
    void listSpaces_archivedReturnsOnlySpacesTheCallerCanRestore() {
        callerIsWorkspaceMember(WorkspaceRole.MEMBER);
        Space ownArchived = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Own archived")
                .accessMode(SpaceAccessMode.CUSTOM)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .archivedAt(OffsetDateTime.now())
                .build();
        when(spaceRepository.findArchivedOwnedByUser(workspace.getId(), actorId))
                .thenReturn(List.of(ownArchived));
        when(memberRepository.findAllByUser_Id(actorId))
                .thenReturn(List.of(SpaceMember.builder()
                        .space(ownArchived)
                        .user(actor)
                        .accessLevel(DocumentAccessLevel.OWNER)
                        .build()));
        when(memberRepository.countMembersBySpaceIds(any())).thenReturn(List.<Object[]>of());
        when(documentRepository.countNonTrashedBySpaceIds(any())).thenReturn(List.<Object[]>of());

        List<SpaceResponse> spaces = spaceService.listSpaces(actorId, true);

        assertThat(spaces).extracting(SpaceResponse::name).containsExactly("Own archived");
        assertThat(spaces.get(0).archivedAt()).isNotNull();
        // Restore is administered, not written: the effective level is the archived VIEW.
        assertThat(spaces.get(0).myAccessLevel()).isEqualTo(DocumentAccessLevel.VIEW);
        assertThat(spaces.get(0).canAdminister()).isTrue();
        verify(spaceRepository, never()).findAllByWorkspace_IdAndArchivedAtIsNotNullOrderByArchivedAtDescIdDesc(any());
    }
}
