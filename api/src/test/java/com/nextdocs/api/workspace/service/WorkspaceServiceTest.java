package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.attachment.dto.response.AttachmentResponse;
import com.nextdocs.api.attachment.entity.Attachment;
import com.nextdocs.api.attachment.repository.AttachmentRepository;
import com.nextdocs.api.attachment.service.AttachmentService;
import com.nextdocs.api.attachment.storage.AttachmentStorage;
import com.nextdocs.api.attachment.storage.StoredAttachment;
import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.validation.IconCatalog;
import com.nextdocs.api.pageicon.PageIconType;
import com.nextdocs.api.pageicon.dto.request.PageIconRequest;
import com.nextdocs.api.pageicon.validation.PageIconValidator;
import com.nextdocs.api.space.entity.Space;
import com.nextdocs.api.space.entity.SpaceAccessMode;
import com.nextdocs.api.space.entity.SpaceMember;
import com.nextdocs.api.space.repository.SpaceMemberRepository;
import com.nextdocs.api.space.repository.SpaceRepository;
import com.nextdocs.api.workspace.dto.request.WorkspaceMemberRoleUpdateRequest;
import com.nextdocs.api.workspace.dto.request.WorkspaceUpdateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceBrandingResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceMemberResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceResponse;
import com.nextdocs.api.workspace.entity.InstanceLock;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.InstanceLockRepository;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService.Membership;
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
import org.springframework.core.io.ByteArrayResource;
import org.springframework.web.multipart.MultipartFile;

@ExtendWith(MockitoExtension.class)
class WorkspaceServiceTest {

    @Mock
    private WorkspaceRepository workspaceRepository;

    @Mock
    private WorkspaceMemberRepository memberRepository;

    @Mock
    private UserRepository userRepository;

    @Mock
    private RefreshTokenRepository refreshTokenRepository;

    @Mock
    private WorkspaceAccessService accessService;

    @Mock
    private IconCatalog iconCatalog;

    @Mock
    private AttachmentRepository attachmentRepository;

    @Mock
    private AttachmentStorage attachmentStorage;

    @Mock
    private AttachmentService attachmentService;

    @Mock
    private InstanceLockRepository instanceLockRepository;

    @Mock
    private SpaceMemberRepository spaceMemberRepository;

    @Mock
    private SpaceRepository spaceRepository;

    private WorkspaceService workspaceService;
    private Workspace workspace;
    private UUID workspaceId;
    private User owner;
    private User target;
    private UUID actorId;

    @BeforeEach
    void setUp() {
        workspaceService = new WorkspaceService(
                workspaceRepository,
                memberRepository,
                userRepository,
                refreshTokenRepository,
                accessService,
                new PageIconValidator(iconCatalog, attachmentRepository, attachmentStorage),
                attachmentService,
                instanceLockRepository,
                spaceMemberRepository,
                spaceRepository);
        workspaceId = UUID.randomUUID();
        workspace = Workspace.builder().id(workspaceId).name("NextDocs").build();
        owner = user("owner@example.com", "Owner");
        target = user("target@example.com", "Target");
        actorId = owner.getId();
    }

    private static User user(String email, String displayName) {
        User user = User.builder()
                .email(email)
                .displayName(displayName)
                .passwordHash("$2a$12$hash")
                .build();
        user.setId(UUID.randomUUID());
        return user;
    }

    private WorkspaceMember member(User user, WorkspaceRole role) {
        return WorkspaceMember.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .user(user)
                .role(role)
                .createdAt(OffsetDateTime.now())
                .build();
    }

    private void givenOwner() {
        when(accessService.requireOwner(actorId))
                .thenReturn(new Membership(workspace, member(owner, WorkspaceRole.OWNER)));
    }

    private void givenAdmin(WorkspaceRole actorRole) {
        when(accessService.requireAdmin(actorId)).thenReturn(new Membership(workspace, member(owner, actorRole)));
    }

    // --- bootstrap ---

    /** The singleton bootstrap lock row exists in a migrated database (V22). */
    private void givenInstanceLock() {
        when(instanceLockRepository.lockForUpdate()).thenReturn(Optional.of(new InstanceLock()));
    }

    @Test
    void bootstrapFirstUser_createsWorkspaceAndOwnerMembership() {
        givenInstanceLock();
        when(accessService.isInitialized()).thenReturn(false);
        when(workspaceRepository.findFirstByOrderByCreatedAtAsc()).thenReturn(Optional.empty());
        when(workspaceRepository.save(any(Workspace.class))).thenAnswer(invocation -> invocation.getArgument(0));

        assertThat(workspaceService.bootstrapFirstUser(owner)).isTrue();

        ArgumentCaptor<Workspace> workspaceCaptor = ArgumentCaptor.forClass(Workspace.class);
        verify(workspaceRepository).save(workspaceCaptor.capture());
        assertThat(workspaceCaptor.getValue().getName()).isEqualTo("Owner's workspace");

        ArgumentCaptor<WorkspaceMember> memberCaptor = ArgumentCaptor.forClass(WorkspaceMember.class);
        verify(memberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(WorkspaceRole.OWNER);
        assertThat(memberCaptor.getValue().getUser()).isSameAs(owner);
        assertThat(memberCaptor.getValue().getWorkspace()).isSameAs(workspaceCaptor.getValue());
    }

    @Test
    void bootstrapFirstUser_fallsBackToANeutralNameWhenTheOwnerHasNoDisplayName() {
        givenInstanceLock();
        when(accessService.isInitialized()).thenReturn(false);
        when(workspaceRepository.findFirstByOrderByCreatedAtAsc()).thenReturn(Optional.empty());
        when(workspaceRepository.save(any(Workspace.class))).thenAnswer(invocation -> invocation.getArgument(0));

        assertThat(workspaceService.bootstrapFirstUser(user("unnamed@example.com", null)))
                .isTrue();

        ArgumentCaptor<Workspace> workspaceCaptor = ArgumentCaptor.forClass(Workspace.class);
        verify(workspaceRepository).save(workspaceCaptor.capture());
        assertThat(workspaceCaptor.getValue().getName()).isEqualTo("My workspace");
    }

    @Test
    void bootstrapFirstUser_reusesExistingWorkspaceWhenItHasNoMembers() {
        givenInstanceLock();
        when(accessService.isInitialized()).thenReturn(false);
        when(workspaceRepository.findFirstByOrderByCreatedAtAsc()).thenReturn(Optional.of(workspace));

        assertThat(workspaceService.bootstrapFirstUser(owner)).isTrue();

        verify(workspaceRepository, never()).save(any());
        ArgumentCaptor<WorkspaceMember> memberCaptor = ArgumentCaptor.forClass(WorkspaceMember.class);
        verify(memberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getWorkspace()).isSameAs(workspace);
    }

    @Test
    void bootstrapFirstUser_whenAnotherRegistrationWon_returnsFalseWithoutCreatingAnything() {
        givenInstanceLock();
        // The re-check under the lock is what decides the race: the preliminary check in
        // the registration flow may have seen an empty instance moments earlier.
        when(accessService.isInitialized()).thenReturn(true);

        assertThat(workspaceService.bootstrapFirstUser(owner)).isFalse();

        verify(workspaceRepository, never()).save(any());
        verify(memberRepository, never()).save(any());
    }

    @Test
    void bootstrapFirstUser_whenTheInstanceLockRowIsMissing_failsLoudly() {
        when(instanceLockRepository.lockForUpdate()).thenReturn(Optional.empty());

        // The row is seeded by V22; its absence means the schema is broken, not that the
        // instance is fresh, and silently bootstrapping without the lock would reopen
        // the race the lock exists to close.
        assertThatThrownBy(() -> workspaceService.bootstrapFirstUser(owner)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void addMember_grantsTheInviteRoleInTheGivenWorkspace() {
        workspaceService.addMember(workspace, target, WorkspaceRole.ADMIN);

        ArgumentCaptor<WorkspaceMember> memberCaptor = ArgumentCaptor.forClass(WorkspaceMember.class);
        verify(memberRepository).save(memberCaptor.capture());
        assertThat(memberCaptor.getValue().getWorkspace()).isSameAs(workspace);
        assertThat(memberCaptor.getValue().getUser()).isSameAs(target);
        assertThat(memberCaptor.getValue().getRole()).isEqualTo(WorkspaceRole.ADMIN);
    }

    // --- getCurrent ---

    @Test
    void getCurrent_returnsIdentityRoleAndMemberCount() {
        when(accessService.requireMember(actorId))
                .thenReturn(new Membership(workspace, member(owner, WorkspaceRole.ADMIN)));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(3L);

        WorkspaceResponse response = workspaceService.getCurrent(actorId);

        assertThat(response.id()).isEqualTo(workspaceId);
        assertThat(response.name()).isEqualTo("NextDocs");
        assertThat(response.role()).isEqualTo(WorkspaceRole.ADMIN);
        assertThat(response.memberCount()).isEqualTo(3);
        assertThat(response.icon()).isNull();
    }

    // --- public branding ---

    @Test
    void findPublicBranding_returnsIdentityWithoutAMembershipCheck() {
        UUID iconId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(iconId.toString());
        when(workspaceRepository.findFirstByOrderByCreatedAtAsc()).thenReturn(Optional.of(workspace));

        WorkspaceBrandingResponse response =
                workspaceService.findPublicBranding().orElseThrow();

        assertThat(response.name()).isEqualTo("NextDocs");
        assertThat(response.icon().type()).isEqualTo("upload");
        assertThat(response.icon().value()).isEqualTo(iconId.toString());
        verifyNoInteractions(accessService);
    }

    @Test
    void findPublicBranding_beforeInitialization_isEmpty() {
        when(workspaceRepository.findFirstByOrderByCreatedAtAsc()).thenReturn(Optional.empty());

        assertThat(workspaceService.findPublicBranding()).isEmpty();
        verifyNoInteractions(accessService);
    }

    // --- updateCurrent ---

    @Test
    void updateCurrent_renamesWorkspace() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);

        WorkspaceResponse response =
                workspaceService.updateCurrent(actorId, new WorkspaceUpdateRequest("  Acme  ", null));

        assertThat(workspace.getName()).isEqualTo("Acme");
        assertThat(response.name()).isEqualTo("Acme");
    }

    @Test
    void updateCurrent_rejectsBlankName() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));

        assertThatThrownBy(() -> workspaceService.updateCurrent(actorId, new WorkspaceUpdateRequest("   ", null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        assertThat(workspace.getName()).isEqualTo("NextDocs");
    }

    @Test
    void updateCurrent_setsBuiltinIconWithColor() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);
        when(iconCatalog.isValidSlug("home")).thenReturn(true);

        WorkspaceResponse response = workspaceService.updateCurrent(
                actorId, new WorkspaceUpdateRequest(null, new PageIconRequest("builtin", "home", "blue")));

        assertThat(workspace.getIconType()).isEqualTo(PageIconType.BUILTIN);
        assertThat(workspace.getIconValue()).isEqualTo("home");
        assertThat(workspace.getIconColor()).isEqualTo("blue");
        assertThat(response.icon().type()).isEqualTo("builtin");
        assertThat(response.icon().color()).isEqualTo("blue");
    }

    @Test
    void updateCurrent_clearsIconOnNullType() {
        workspace.setIconType(PageIconType.EMOJI);
        workspace.setIconValue("📝");
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);

        WorkspaceResponse response = workspaceService.updateCurrent(
                actorId, new WorkspaceUpdateRequest(null, new PageIconRequest(null, null)));

        assertThat(workspace.getIconType()).isNull();
        assertThat(workspace.getIconValue()).isNull();
        assertThat(response.icon()).isNull();
    }

    @Test
    void updateCurrent_setsUploadIconFromWorkspaceAttachment() {
        UUID attachmentId = UUID.randomUUID();
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);
        givenStoredPng(attachmentId);

        WorkspaceResponse response = workspaceService.updateCurrent(
                actorId, new WorkspaceUpdateRequest(null, new PageIconRequest("UPLOAD", attachmentId.toString())));

        assertThat(workspace.getIconType()).isEqualTo(PageIconType.UPLOAD);
        assertThat(workspace.getIconValue()).isEqualTo(attachmentId.toString());
        assertThat(response.icon().type()).isEqualTo("upload");
        // Adoption is what makes the upload anonymously readable; uploading did not.
        verify(attachmentService).publishWorkspaceUpload(workspaceId, attachmentId);
    }

    @Test
    void updateCurrent_rejectsUploadIconFromAnotherWorkspace() {
        UUID attachmentId = UUID.randomUUID();
        givenOwner();
        Workspace otherWorkspace =
                Workspace.builder().id(UUID.randomUUID()).name("Other").build();
        when(attachmentRepository.findById(attachmentId))
                .thenReturn(Optional.of(Attachment.builder()
                        .id(attachmentId)
                        .workspace(otherWorkspace)
                        .uploadedBy(owner)
                        .fileName("icon.png")
                        .contentType("image/png")
                        .sizeBytes(8)
                        .storageKey(otherWorkspace.getId() + "/" + attachmentId)
                        .sha256("0".repeat(64))
                        .build()));

        assertThatThrownBy(() -> workspaceService.updateCurrent(
                        actorId,
                        new WorkspaceUpdateRequest(null, new PageIconRequest("UPLOAD", attachmentId.toString()))))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        assertThat(workspace.getIconType()).isNull();
        verifyNoInteractions(attachmentService);
    }

    @Test
    void updateCurrent_replacingUploadIconReleasesThePreviousFile() {
        UUID oldAttachmentId = UUID.randomUUID();
        UUID newAttachmentId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(oldAttachmentId.toString());
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);
        givenStoredPng(newAttachmentId);

        workspaceService.updateCurrent(
                actorId, new WorkspaceUpdateRequest(null, new PageIconRequest("UPLOAD", newAttachmentId.toString())));

        assertThat(workspace.getIconValue()).isEqualTo(newAttachmentId.toString());
        verify(attachmentService).deleteWorkspaceUpload(workspaceId, oldAttachmentId);
        verify(attachmentService).publishWorkspaceUpload(workspaceId, newAttachmentId);
    }

    @Test
    void updateCurrent_replacingUploadIconWithEmojiReleasesTheFile() {
        UUID oldAttachmentId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(oldAttachmentId.toString());
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);

        workspaceService.updateCurrent(actorId, new WorkspaceUpdateRequest(null, new PageIconRequest("emoji", "📝")));

        assertThat(workspace.getIconType()).isEqualTo(PageIconType.EMOJI);
        verify(attachmentService).deleteWorkspaceUpload(workspaceId, oldAttachmentId);
        verify(attachmentService, never()).restrictWorkspaceUpload(any(), any());
    }

    @Test
    void updateCurrent_clearingUploadIconReleasesTheFile() {
        UUID attachmentId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(attachmentId.toString());
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);

        workspaceService.updateCurrent(actorId, new WorkspaceUpdateRequest(null, new PageIconRequest(null, null)));

        assertThat(workspace.getIconType()).isNull();
        verify(attachmentService).deleteWorkspaceUpload(workspaceId, attachmentId);
    }

    @Test
    void updateCurrent_resubmittingTheSameUploadIconKeepsTheFile() {
        UUID attachmentId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(attachmentId.toString());
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);
        givenStoredPng(attachmentId);

        workspaceService.updateCurrent(
                actorId, new WorkspaceUpdateRequest(null, new PageIconRequest("UPLOAD", attachmentId.toString())));

        verify(attachmentService, never()).deleteWorkspaceUpload(any(), any());
        verify(attachmentService).publishWorkspaceUpload(workspaceId, attachmentId);
    }

    @Test
    void updateCurrent_keepsAnUploadASpaceStillRenders() {
        UUID sharedAttachmentId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(sharedAttachmentId.toString());
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.countByWorkspaceId(workspaceId)).thenReturn(1L);
        when(spaceRepository.existsByWorkspace_IdAndIconTypeAndIconValue(
                        workspaceId, PageIconType.UPLOAD, sharedAttachmentId.toString()))
                .thenReturn(true);

        workspaceService.updateCurrent(actorId, new WorkspaceUpdateRequest(null, new PageIconRequest("emoji", "📝")));

        assertThat(workspace.getIconType()).isEqualTo(PageIconType.EMOJI);
        verify(attachmentService, never()).deleteWorkspaceUpload(any(), any());
        // The file survives for the space, but it must stop resolving anonymously.
        verify(attachmentService).restrictWorkspaceUpload(workspaceId, sharedAttachmentId);
    }

    @Test
    void updateCurrent_rejectedUploadKeepsTheExistingIconUpload() {
        UUID oldAttachmentId = UUID.randomUUID();
        UUID rejectedAttachmentId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(oldAttachmentId.toString());
        givenOwner();
        when(attachmentRepository.findById(rejectedAttachmentId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> workspaceService.updateCurrent(
                        actorId,
                        new WorkspaceUpdateRequest(
                                null, new PageIconRequest("UPLOAD", rejectedAttachmentId.toString()))))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        assertThat(workspace.getIconValue()).isEqualTo(oldAttachmentId.toString());
        verify(attachmentService, never()).deleteWorkspaceUpload(any(), any());
        verify(attachmentService, never()).publishWorkspaceUpload(any(), any());
    }

    @Test
    void updateCurrent_rejectsColorOnAnEmojiIcon() {
        givenOwner();

        assertThatThrownBy(() -> workspaceService.updateCurrent(
                        actorId, new WorkspaceUpdateRequest(null, new PageIconRequest("emoji", "📝", "blue"))))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void updateCurrent_requiresOwner() {
        when(accessService.requireOwner(actorId)).thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        assertThatThrownBy(() -> workspaceService.updateCurrent(actorId, new WorkspaceUpdateRequest("Acme", null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verify(workspaceRepository, never()).findByIdForUpdate(any());
    }

    // --- abandoned icon uploads ---

    @Test
    void purgeAbandonedIconUploads_keepsTheCurrentIconAndDeletesTheRest() {
        UUID liveId = UUID.randomUUID();
        UUID abandonedId = UUID.randomUUID();
        workspace.setIconType(PageIconType.UPLOAD);
        workspace.setIconValue(liveId.toString());
        when(attachmentService.findWorkspaceUploadsCreatedBefore(any()))
                .thenReturn(List.of(workspaceUpload(liveId), workspaceUpload(abandonedId)));
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));

        assertThat(workspaceService.purgeAbandonedIconUploads()).isEqualTo(1);

        verify(attachmentService).deleteWorkspaceUpload(workspaceId, abandonedId);
        verify(attachmentService, never()).deleteWorkspaceUpload(workspaceId, liveId);
    }

    @Test
    void purgeAbandonedIconUploads_keepsAnUploadASpaceStillRenders() {
        UUID spaceIconId = UUID.randomUUID();
        UUID abandonedId = UUID.randomUUID();
        when(attachmentService.findWorkspaceUploadsCreatedBefore(any()))
                .thenReturn(List.of(workspaceUpload(spaceIconId), workspaceUpload(abandonedId)));
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(spaceRepository.findIconValueByWorkspace_IdAndIconType(workspaceId, PageIconType.UPLOAD))
                .thenReturn(List.of(spaceIconId.toString()));

        assertThat(workspaceService.purgeAbandonedIconUploads()).isEqualTo(1);

        verify(attachmentService).deleteWorkspaceUpload(workspaceId, abandonedId);
        verify(attachmentService, never()).deleteWorkspaceUpload(workspaceId, spaceIconId);
    }

    @Test
    void purgeAbandonedIconUploads_deletesEverything_whenTheIconIsNotAnUpload() {
        UUID abandonedId = UUID.randomUUID();
        when(attachmentService.findWorkspaceUploadsCreatedBefore(any()))
                .thenReturn(List.of(workspaceUpload(abandonedId)));
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));

        assertThat(workspaceService.purgeAbandonedIconUploads()).isEqualTo(1);

        verify(attachmentService).deleteWorkspaceUpload(workspaceId, abandonedId);
    }

    private Attachment workspaceUpload(UUID attachmentId) {
        return Attachment.builder()
                .id(attachmentId)
                .workspace(workspace)
                .uploadedBy(owner)
                .fileName("icon.png")
                .contentType("image/png")
                .sizeBytes(8)
                .storageKey(workspaceId + "/" + attachmentId)
                .sha256("0".repeat(64))
                .build();
    }

    // --- uploadAttachment ---

    @Test
    void uploadAttachment_storesUnderTheCallersWorkspace() {
        MultipartFile file = mock(MultipartFile.class);
        AttachmentResponse stored = new AttachmentResponse(
                UUID.randomUUID(), null, "icon.png", "image/png", 8, "/api/v1/attachments/x", OffsetDateTime.now());
        when(attachmentService.uploadWorkspaceAttachment(actorId, file)).thenReturn(stored);

        assertThat(workspaceService.uploadAttachment(actorId, file)).isSameAs(stored);

        verify(attachmentService).uploadWorkspaceAttachment(actorId, file);
    }

    @Test
    void uploadAttachment_propagatesTheOwnerCheck() {
        MultipartFile file = mock(MultipartFile.class);
        when(attachmentService.uploadWorkspaceAttachment(actorId, file))
                .thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        assertThatThrownBy(() -> workspaceService.uploadAttachment(actorId, file))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    // --- listMembers ---

    @Test
    void listMembers_mapsRosterWithRoles() {
        when(accessService.requireMember(actorId))
                .thenReturn(new Membership(workspace, member(owner, WorkspaceRole.OWNER)));
        WorkspaceMember targetMember = member(target, WorkspaceRole.MEMBER);
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(owner, WorkspaceRole.OWNER), targetMember));

        List<WorkspaceMemberResponse> roster = workspaceService.listMembers(actorId);

        assertThat(roster).hasSize(2);
        assertThat(roster.get(0).email()).isEqualTo("owner@example.com");
        assertThat(roster.get(0).role()).isEqualTo(WorkspaceRole.OWNER);
        assertThat(roster.get(1).userId()).isEqualTo(target.getId());
        assertThat(roster.get(1).role()).isEqualTo(WorkspaceRole.MEMBER);
    }

    @Test
    void listMembers_attachesSpaceMemberships() {
        when(accessService.requireMember(actorId))
                .thenReturn(new Membership(workspace, member(owner, WorkspaceRole.OWNER)));
        WorkspaceMember targetMember = member(target, WorkspaceRole.MEMBER);
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(owner, WorkspaceRole.OWNER), targetMember));

        Space customSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("Core Team")
                .accessMode(SpaceAccessMode.CUSTOM)
                .iconType(PageIconType.EMOJI)
                .iconValue("\uD83D\uDCDA")
                .build();
        Space publicSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("General")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        when(spaceRepository.findAllByWorkspace_IdAndArchivedAtIsNullOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(customSpace, publicSpace));

        SpaceMember customOwnerMember = SpaceMember.builder()
                .id(UUID.randomUUID())
                .space(customSpace)
                .user(owner)
                .accessLevel(DocumentAccessLevel.OWNER)
                .build();
        when(spaceMemberRepository.findAllBySpace_Workspace_Id(workspaceId)).thenReturn(List.of(customOwnerMember));

        List<WorkspaceMemberResponse> roster = workspaceService.listMembers(actorId);

        assertThat(roster).hasSize(2);
        // Owner is explicit in customSpace and gets publicSpace
        assertThat(roster.get(0).spaces()).hasSize(2);
        assertThat(roster.get(0).spaces().get(0).name()).isEqualTo("Core Team");
        assertThat(roster.get(0).spaces().get(0).accessLevel()).isEqualTo(DocumentAccessLevel.OWNER);
        assertThat(roster.get(0).spaces().get(0).icon().type()).isEqualTo("emoji");
        assertThat(roster.get(0).spaces().get(0).icon().value()).isEqualTo("\uD83D\uDCDA");
        assertThat(roster.get(0).spaces().get(1).name()).isEqualTo("General");
        assertThat(roster.get(0).spaces().get(1).accessLevel()).isEqualTo(DocumentAccessLevel.VIEW);

        // Target is not in customSpace, but gets publicSpace automatically
        assertThat(roster.get(1).spaces()).hasSize(1);
        assertThat(roster.get(1).spaces().get(0).name()).isEqualTo("General");
        assertThat(roster.get(1).spaces().get(0).accessLevel()).isEqualTo(DocumentAccessLevel.VIEW);
    }

    @Test
    void listMembers_prefersAnExplicitSpaceMembershipOverThePublicGrant() {
        when(accessService.requireMember(actorId))
                .thenReturn(new Membership(workspace, member(owner, WorkspaceRole.OWNER)));
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(target, WorkspaceRole.MEMBER)));

        Space publicSpace = Space.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .name("General")
                .accessMode(SpaceAccessMode.PUBLIC)
                .everyoneAccessLevel(DocumentAccessLevel.VIEW)
                .build();
        when(spaceRepository.findAllByWorkspace_IdAndArchivedAtIsNullOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(publicSpace));
        when(spaceMemberRepository.findAllBySpace_Workspace_Id(workspaceId))
                .thenReturn(List.of(SpaceMember.builder()
                        .id(UUID.randomUUID())
                        .space(publicSpace)
                        .user(target)
                        .accessLevel(DocumentAccessLevel.EDIT)
                        .build()));

        List<WorkspaceMemberResponse> roster = workspaceService.listMembers(actorId);

        assertThat(roster.get(0).spaces()).singleElement().satisfies(space -> {
            assertThat(space.name()).isEqualTo("General");
            assertThat(space.accessLevel()).isEqualTo(DocumentAccessLevel.EDIT);
        });
    }

    @Test
    void listMembers_omitsSpaceMembershipsForPlainMembers() {
        when(accessService.requireMember(actorId))
                .thenReturn(new Membership(workspace, member(owner, WorkspaceRole.MEMBER)));
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(owner, WorkspaceRole.MEMBER)));

        List<WorkspaceMemberResponse> roster = workspaceService.listMembers(actorId);

        // Who belongs to a space is roster data, not content: a plain member must not
        // learn the space roster, matching SpaceAccessService#requireRoster.
        assertThat(roster.get(0).spaces()).isNull();
        verifyNoInteractions(spaceRepository, spaceMemberRepository);
    }

    // --- updateMemberRole ---

    @Test
    void updateMemberRole_changesRoleAndReturnsRoster() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        WorkspaceMember targetMember = member(target, WorkspaceRole.MEMBER);
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(targetMember));
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(owner, WorkspaceRole.OWNER), targetMember));

        List<WorkspaceMemberResponse> roster = workspaceService.updateMemberRole(
                actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("admin"));

        assertThat(targetMember.getRole()).isEqualTo(WorkspaceRole.ADMIN);
        assertThat(roster.get(1).role()).isEqualTo(WorkspaceRole.ADMIN);
        verify(memberRepository).save(targetMember);
    }

    @Test
    void updateMemberRole_acceptsLowercaseRoleNames() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        WorkspaceMember targetMember = member(target, WorkspaceRole.MEMBER);
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(targetMember));
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(targetMember));

        workspaceService.updateMemberRole(actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("owner"));

        assertThat(targetMember.getRole()).isEqualTo(WorkspaceRole.OWNER);
    }

    @Test
    void updateMemberRole_allowsSelfDemotionWhileAnotherOwnerRemains() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        WorkspaceMember ownerMember = member(owner, WorkspaceRole.OWNER);
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, owner.getId()))
                .thenReturn(Optional.of(ownerMember));
        when(memberRepository.countByWorkspaceIdAndRole(workspaceId, WorkspaceRole.OWNER))
                .thenReturn(2L);
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(ownerMember, member(target, WorkspaceRole.OWNER)));

        List<WorkspaceMemberResponse> roster = workspaceService.updateMemberRole(
                actorId, owner.getId(), new WorkspaceMemberRoleUpdateRequest("member"));

        assertThat(ownerMember.getRole()).isEqualTo(WorkspaceRole.MEMBER);
        assertThat(roster.get(0).role()).isEqualTo(WorkspaceRole.MEMBER);
        verify(memberRepository).save(ownerMember);
    }

    @Test
    void updateMemberRole_rejectsSelfDemotionAsTheLastOwner() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, owner.getId()))
                .thenReturn(Optional.of(member(owner, WorkspaceRole.OWNER)));
        when(memberRepository.countByWorkspaceIdAndRole(workspaceId, WorkspaceRole.OWNER))
                .thenReturn(1L);

        assertThatThrownBy(() -> workspaceService.updateMemberRole(
                        actorId, owner.getId(), new WorkspaceMemberRoleUpdateRequest("ADMIN")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> {
                    assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT);
                    assertThat(ex.getMessage()).contains("Make another member an owner");
                });
        verify(memberRepository, never()).save(any());
    }

    @Test
    void updateMemberRole_allowsDemotingAnOwnerWhileAnotherRemains() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        WorkspaceMember targetMember = member(target, WorkspaceRole.OWNER);
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(targetMember));
        when(memberRepository.countByWorkspaceIdAndRole(workspaceId, WorkspaceRole.OWNER))
                .thenReturn(2L);
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(owner, WorkspaceRole.OWNER), targetMember));

        workspaceService.updateMemberRole(actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("MEMBER"));

        assertThat(targetMember.getRole()).isEqualTo(WorkspaceRole.MEMBER);
    }

    @Test
    void updateMemberRole_rejectsUnknownRole() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(member(target, WorkspaceRole.MEMBER)));

        assertThatThrownBy(() -> workspaceService.updateMemberRole(
                        actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("SUPREME")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void updateMemberRole_rejectsNullOrBlankRole() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(member(target, WorkspaceRole.MEMBER)));

        assertThatThrownBy(() -> workspaceService.updateMemberRole(
                        actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest(null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));

        assertThatThrownBy(() -> workspaceService.updateMemberRole(
                        actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("   ")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void updateMemberRole_requiresOwner() {
        when(accessService.requireOwner(actorId)).thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        assertThatThrownBy(() -> workspaceService.updateMemberRole(
                        actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("ADMIN")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void updateMemberRole_rejectsAnOwnerDemotedBeforeTheLockWasAcquired() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        doAnswer(invocation -> {
                    WorkspaceMember actorMember = invocation.getArgument(0);
                    actorMember.setRole(WorkspaceRole.MEMBER);
                    return null;
                })
                .when(accessService)
                .refreshForLock(any());

        assertThatThrownBy(() -> workspaceService.updateMemberRole(
                        actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("ADMIN")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verify(memberRepository, never()).save(any());
    }

    @Test
    void updateMemberRole_refreshesTheTargetRoleBeforeDeciding() {
        givenOwner();
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        WorkspaceMember targetMember = member(target, WorkspaceRole.MEMBER);
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(targetMember));
        when(memberRepository.countByWorkspaceIdAndRole(workspaceId, WorkspaceRole.OWNER))
                .thenReturn(1L);
        // Another transaction promoted the target while this one waited for the lock.
        doAnswer(invocation -> {
                    WorkspaceMember member = invocation.getArgument(0);
                    if (member == targetMember) {
                        member.setRole(WorkspaceRole.OWNER);
                    }
                    return null;
                })
                .when(accessService)
                .refreshForLock(any());

        assertThatThrownBy(() -> workspaceService.updateMemberRole(
                        actorId, target.getId(), new WorkspaceMemberRoleUpdateRequest("MEMBER")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(memberRepository, never()).save(any());
    }

    // --- removeMember ---

    @Test
    void removeMember_deletesMembershipDeactivatesAccountAndRevokesTokens() {
        givenAdmin(WorkspaceRole.OWNER);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(member(target, WorkspaceRole.MEMBER)));
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(owner, WorkspaceRole.OWNER)));

        List<WorkspaceMemberResponse> roster = workspaceService.removeMember(actorId, target.getId());

        assertThat(roster).hasSize(1);
        verify(memberRepository).delete(any(WorkspaceMember.class));
        verify(userRepository).save(target);
        assertThat(target.isActive()).isFalse();
        verify(refreshTokenRepository).revokeAllForUser(target.getId());
        // Space memberships go with the workspace membership, so no stale space grant
        // keeps resolving for the removed account.
        verify(spaceMemberRepository).deleteByUser_Id(target.getId());
    }

    @Test
    void removeMember_rejectsSelfRemoval() {
        givenAdmin(WorkspaceRole.OWNER);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, owner.getId()))
                .thenReturn(Optional.of(member(owner, WorkspaceRole.OWNER)));

        assertThatThrownBy(() -> workspaceService.removeMember(actorId, owner.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        verify(memberRepository, never()).delete(any());
    }

    @Test
    void removeMember_adminCanOnlyRemovePlainMembers() {
        givenAdmin(WorkspaceRole.ADMIN);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(member(target, WorkspaceRole.ADMIN)));

        assertThatThrownBy(() -> workspaceService.removeMember(actorId, target.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verify(memberRepository, never()).delete(any());
    }

    @Test
    void removeMember_ownerCanRemoveAnotherOwner() {
        givenAdmin(WorkspaceRole.OWNER);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(member(target, WorkspaceRole.OWNER)));
        when(memberRepository.countByWorkspaceIdAndRole(workspaceId, WorkspaceRole.OWNER))
                .thenReturn(2L);
        when(memberRepository.findAllByWorkspaceIdOrderByCreatedAtAsc(workspaceId))
                .thenReturn(List.of(member(owner, WorkspaceRole.OWNER)));

        workspaceService.removeMember(actorId, target.getId());

        verify(memberRepository).delete(any(WorkspaceMember.class));
    }

    @Test
    void removeMember_rejectsRemovingTheLastOwner() {
        givenAdmin(WorkspaceRole.OWNER);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        when(memberRepository.findByWorkspaceIdAndUserId(workspaceId, target.getId()))
                .thenReturn(Optional.of(member(target, WorkspaceRole.OWNER)));
        when(memberRepository.countByWorkspaceIdAndRole(workspaceId, WorkspaceRole.OWNER))
                .thenReturn(1L);

        assertThatThrownBy(() -> workspaceService.removeMember(actorId, target.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.CONFLICT));
        verify(refreshTokenRepository, never()).revokeAllForUser(any());
    }

    @Test
    void removeMember_requiresAdmin() {
        when(accessService.requireAdmin(actorId)).thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        assertThatThrownBy(() -> workspaceService.removeMember(actorId, target.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    @Test
    void removeMember_rejectsAnAdminDemotedBeforeTheLockWasAcquired() {
        givenAdmin(WorkspaceRole.ADMIN);
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
        doAnswer(invocation -> {
                    WorkspaceMember actorMember = invocation.getArgument(0);
                    actorMember.setRole(WorkspaceRole.MEMBER);
                    return null;
                })
                .when(accessService)
                .refreshForLock(any());

        assertThatThrownBy(() -> workspaceService.removeMember(actorId, target.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verify(memberRepository, never()).delete(any());
        verify(refreshTokenRepository, never()).revokeAllForUser(any());
    }

    // --- helpers ---

    /** PNG magic bytes: enough for the raster sniff to pass. */
    private static final byte[] PNG_HEAD = {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};

    private void givenStoredPng(UUID attachmentId) {
        when(attachmentRepository.findById(attachmentId))
                .thenReturn(Optional.of(Attachment.builder()
                        .id(attachmentId)
                        .workspace(workspace)
                        .uploadedBy(owner)
                        .fileName("icon.png")
                        .contentType("image/png")
                        .sizeBytes(PNG_HEAD.length)
                        .storageKey(workspaceId + "/" + attachmentId)
                        .sha256("0".repeat(64))
                        .build()));
        when(attachmentStorage.open(workspaceId + "/" + attachmentId))
                .thenReturn(new StoredAttachment(new ByteArrayResource(PNG_HEAD), PNG_HEAD.length, true));
    }
}
