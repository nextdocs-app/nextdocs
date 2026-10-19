package com.nextdocs.api.workspace.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.common.util.SecureTokens;
import com.nextdocs.api.workspace.dto.request.WorkspaceInviteCreateRequest;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteCreatedResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteEmailResult;
import com.nextdocs.api.workspace.dto.response.WorkspaceInvitePreviewResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteResponse;
import com.nextdocs.api.workspace.dto.response.WorkspaceInviteStatus;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceInvite;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceInviteRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService.Membership;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
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
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.test.util.ReflectionTestUtils;

@ExtendWith(MockitoExtension.class)
class WorkspaceInviteServiceTest {

    private static final long INVITE_EXPIRY_DAYS = 7L;

    private static final String WEB_BASE_URL = "http://localhost:3000";

    /** Same constraint registration applies to the address. */
    private static final Validator VALIDATOR =
            Validation.buildDefaultValidatorFactory().getValidator();

    /** Arbitrary raw token of the shape {@link SecureTokens#mint()} produces. */
    private static final String RAW_TOKEN = "raw-invite-token";

    @Mock
    private WorkspaceInviteRepository inviteRepository;

    @Mock
    private WorkspaceAccessService accessService;

    @Mock
    private UserRepository userRepository;

    @Mock
    private WorkspaceRepository workspaceRepository;

    @Mock
    private WorkspaceInviteNotifier notifier;

    private WorkspaceInviteService inviteService;

    private Workspace workspace;
    private UUID workspaceId;
    private User owner;
    private UUID actorId;

    @BeforeEach
    void setUp() {
        inviteService = new WorkspaceInviteService(
                inviteRepository, accessService, userRepository, workspaceRepository, notifier, VALIDATOR);
        ReflectionTestUtils.setField(inviteService, "inviteExpiryDays", INVITE_EXPIRY_DAYS);
        ReflectionTestUtils.setField(inviteService, "webBaseUrl", WEB_BASE_URL);

        workspaceId = UUID.randomUUID();
        workspace = Workspace.builder().id(workspaceId).name("NextDocs").build();
        owner = user("owner@example.com", "Owner");
        actorId = owner.getId();
        // Issuing needs a deliverable instance; refusal tests restub this to false.
        lenient().when(notifier.isDeliveryConfigured()).thenReturn(true);
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

    private void givenActor(WorkspaceRole role) {
        when(accessService.requireAdmin(actorId)).thenReturn(new Membership(workspace, member(owner, role)));
    }

    /** createInvites serializes concurrent batches on the workspace row. */
    private void givenInviteBatchLock() {
        when(workspaceRepository.findByIdForUpdate(workspaceId)).thenReturn(Optional.of(workspace));
    }

    private WorkspaceInvite pendingInvite(String email, WorkspaceRole role) {
        return WorkspaceInvite.builder()
                .id(UUID.randomUUID())
                .workspace(workspace)
                .email(email)
                .role(role)
                .tokenHash(SecureTokens.sha256Hex(RAW_TOKEN))
                .createdBy(owner)
                .expiresAt(OffsetDateTime.now().plusDays(INVITE_EXPIRY_DAYS))
                .createdAt(OffsetDateTime.now())
                .build();
    }

    private static String tokenFromUrl(String invitationUrl) {
        String marker = "/join#token=";
        assertThat(invitationUrl).contains(marker);
        return invitationUrl.substring(invitationUrl.indexOf(marker) + marker.length());
    }

    /** The URL the notifier was handed, captured exactly where the email would carry it. */
    private String announcedUrlFor(WorkspaceInvite invite) {
        ArgumentCaptor<String> urlCaptor = ArgumentCaptor.forClass(String.class);
        verify(notifier).inviteIssued(eq(invite), urlCaptor.capture());
        assertThat(urlCaptor.getValue()).startsWith(WEB_BASE_URL + "/join#token=");
        return urlCaptor.getValue();
    }

    // --- createInvites ---

    @Test
    void createInvites_issuesOneInvitePerEmailAndReportsThem() {
        givenActor(WorkspaceRole.OWNER);
        givenInviteBatchLock();
        when(userRepository.findByEmail(anyString())).thenReturn(Optional.empty());

        List<WorkspaceInviteEmailResult> results = inviteService.createInvites(
                actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com", "john@example.com"), "member"));

        assertThat(results).hasSize(2);
        for (WorkspaceInviteEmailResult result : results) {
            assertThat(result.status()).isEqualTo(WorkspaceInviteStatus.INVITED);
            assertThat(result.invite().role()).isEqualTo(WorkspaceRole.MEMBER);
            assertThat(result.invite().expiresAt()).isAfter(OffsetDateTime.now().plusDays(INVITE_EXPIRY_DAYS - 1));
        }
        assertThat(results.get(0).email()).isEqualTo("jane@example.com");
        assertThat(results.get(1).email()).isEqualTo("john@example.com");

        ArgumentCaptor<WorkspaceInvite> captor = ArgumentCaptor.forClass(WorkspaceInvite.class);
        verify(inviteRepository, org.mockito.Mockito.times(2)).save(captor.capture());
        assertThat(captor.getAllValues())
                .extracting(WorkspaceInvite::getEmail)
                .containsExactly("jane@example.com", "john@example.com");
        for (WorkspaceInvite saved : captor.getAllValues()) {
            assertThat(saved.getCreatedBy()).isSameAs(owner);
            assertThat(saved.getWorkspace()).isSameAs(workspace);
            assertThat(saved.getExpiresAt()).isAfter(OffsetDateTime.now().plusDays(INVITE_EXPIRY_DAYS - 1));
        }
        // The token exists only in the email a notifier sends: the row keeps the hash,
        // the URL carries the raw value in its fragment, and the result does not.
        WorkspaceInvite first = captor.getAllValues().get(0);
        String rawToken = tokenFromUrl(announcedUrlFor(first));
        assertThat(first.getTokenHash()).isEqualTo(SecureTokens.sha256Hex(rawToken));
        assertThat(first.getTokenHash()).isNotEqualTo(rawToken);
    }

    @Test
    void createInvites_normalizesDedupesAndSkipsBlankEntries() {
        givenActor(WorkspaceRole.OWNER);
        givenInviteBatchLock();
        when(userRepository.findByEmail(anyString())).thenReturn(Optional.empty());

        List<WorkspaceInviteEmailResult> results = inviteService.createInvites(
                actorId,
                new WorkspaceInviteCreateRequest(
                        List.of(" Jane@Example.com ", "jane@example.com", "  Ｊａｎｅ＠Ｅｘａｍｐｌｅ．ｃｏｍ  ", "", "  "), "MEMBER"));

        assertThat(results).hasSize(1);
        assertThat(results.get(0).email()).isEqualTo("jane@example.com");
        assertThat(results.get(0).status()).isEqualTo(WorkspaceInviteStatus.INVITED);
        verify(inviteRepository).save(any(WorkspaceInvite.class));
    }

    @Test
    void createInvites_rejectsNullOrBlankRole() {
        givenActor(WorkspaceRole.OWNER);

        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), null)))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));

        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "   ")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
    }

    @Test
    void createInvites_reportsInvalidEmailsWithoutFailingTheBatch() {
        givenActor(WorkspaceRole.OWNER);
        givenInviteBatchLock();
        when(userRepository.findByEmail("good@example.com")).thenReturn(Optional.empty());

        List<WorkspaceInviteEmailResult> results = inviteService.createInvites(
                actorId,
                new WorkspaceInviteCreateRequest(
                        List.of(
                                "nope",
                                // Registration's @Email refuses these, so inviting them
                                // would email a link that can never be accepted.
                                "jane..doe@example.com",
                                "jane@-x.com",
                                "jane@example.com.",
                                "jane@example..com",
                                "good@example.com"),
                        "MEMBER"));

        assertThat(results).hasSize(6);
        assertThat(results.subList(0, 5))
                .allSatisfy(result -> assertThat(result.status()).isEqualTo(WorkspaceInviteStatus.INVALID_EMAIL));
        assertThat(results.get(0).email()).isEqualTo("nope");
        assertThat(results.get(0).invite()).isNull();
        assertThat(results.get(5).status()).isEqualTo(WorkspaceInviteStatus.INVITED);
        verify(inviteRepository).save(any(WorkspaceInvite.class));
    }

    @Test
    void createInvites_reportsActiveAccountsAsAlreadyMember() {
        givenActor(WorkspaceRole.OWNER);
        givenInviteBatchLock();
        when(userRepository.findByEmail("taken@example.com"))
                .thenReturn(Optional.of(user("taken@example.com", "Taken")));

        List<WorkspaceInviteEmailResult> results = inviteService.createInvites(
                actorId, new WorkspaceInviteCreateRequest(List.of("taken@example.com"), "MEMBER"));

        // An active account cannot register again, so the invite would be dead weight.
        assertThat(results).hasSize(1);
        assertThat(results.get(0).status()).isEqualTo(WorkspaceInviteStatus.ALREADY_MEMBER);
        assertThat(results.get(0).invite()).isNull();
        verifyNoInteractions(inviteRepository);
        verify(notifier, never()).inviteIssued(any(), any());
    }

    @Test
    void createInvites_allowsInvitingARemovedAccount() {
        givenActor(WorkspaceRole.OWNER);
        givenInviteBatchLock();
        User removed = user("removed@example.com", "Removed");
        removed.setActive(false);
        when(userRepository.findByEmail("removed@example.com")).thenReturn(Optional.of(removed));

        List<WorkspaceInviteEmailResult> results = inviteService.createInvites(
                actorId, new WorkspaceInviteCreateRequest(List.of("removed@example.com"), "MEMBER"));

        // Removal is reversible by re-invite: the registration flow reactivates the account.
        assertThat(results.get(0).status()).isEqualTo(WorkspaceInviteStatus.INVITED);
        verify(inviteRepository).save(any(WorkspaceInvite.class));
    }

    @Test
    void createInvites_replacesAPendingInviteForTheSameEmail() {
        givenActor(WorkspaceRole.OWNER);
        givenInviteBatchLock();
        when(userRepository.findByEmail("jane@example.com")).thenReturn(Optional.empty());
        when(inviteRepository.findByWorkspaceIdAndEmailAndAcceptedAtIsNull(workspaceId, "jane@example.com"))
                .thenReturn(Optional.of(pendingInvite("jane@example.com", WorkspaceRole.OWNER)));

        inviteService.createInvites(actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER"));

        // The replacement carries the new role and expiry; accepted rows stay as the
        // audit trail, and the unique pending index tolerates only the new row.
        verify(inviteRepository).deletePendingByEmail(workspaceId, "jane@example.com");
        verify(inviteRepository).save(any(WorkspaceInvite.class));
    }

    @Test
    void createInvites_adminCannotReplaceAnOwnerInvite() {
        givenActor(WorkspaceRole.ADMIN);
        givenInviteBatchLock();
        when(userRepository.findByEmail("jane@example.com")).thenReturn(Optional.empty());
        when(inviteRepository.findByWorkspaceIdAndEmailAndAcceptedAtIsNull(workspaceId, "jane@example.com"))
                .thenReturn(Optional.of(pendingInvite("jane@example.com", WorkspaceRole.OWNER)));

        // Replacing is revoking: an admin may invite plain members, but must not delete
        // a pending invite whose role it cannot grant.
        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));

        verify(inviteRepository, never()).deletePendingByEmail(any(), anyString());
        verify(inviteRepository, never()).save(any(WorkspaceInvite.class));
        verify(notifier, never()).inviteIssued(any(), any());
    }

    @Test
    void createInvites_adminMayOnlyInvitePlainMembers() {
        givenActor(WorkspaceRole.ADMIN);
        givenInviteBatchLock();

        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "ADMIN")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verifyNoInteractions(inviteRepository, notifier);

        when(userRepository.findByEmail("jane@example.com")).thenReturn(Optional.empty());
        List<WorkspaceInviteEmailResult> results = inviteService.createInvites(
                actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER"));
        assertThat(results.get(0).status()).isEqualTo(WorkspaceInviteStatus.INVITED);
    }

    @Test
    void createInvites_whenDeliveryIsNotConfigured_refusesToMintLinks() {
        givenActor(WorkspaceRole.OWNER);
        when(notifier.isDeliveryConfigured()).thenReturn(false);

        // The signup link must reach the invited mailbox to prove it; handed to the admin
        // instead it would just be a copyable URL, so an instance without a relay refuses.
        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode())
                        .isEqualTo(ErrorCode.EMAIL_DELIVERY_NOT_CONFIGURED));
        verifyNoInteractions(inviteRepository);
    }

    @Test
    void createInvites_rejectsUnknownRoles() {
        givenActor(WorkspaceRole.OWNER);

        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "SUPREME")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.VALIDATION_FAILED));
        verifyNoInteractions(inviteRepository, notifier);
    }

    @Test
    void createInvites_requiresAdmin() {
        when(accessService.requireAdmin(actorId)).thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verifyNoInteractions(inviteRepository, notifier);
    }

    @Test
    void createInvites_rejectsAnAdminDemotedBeforeTheLockWasAcquired() {
        givenActor(WorkspaceRole.ADMIN);
        givenInviteBatchLock();
        doAnswer(invocation -> {
                    WorkspaceMember actorMember = invocation.getArgument(0);
                    actorMember.setRole(WorkspaceRole.MEMBER);
                    return null;
                })
                .when(accessService)
                .refreshForLock(any());

        assertThatThrownBy(() -> inviteService.createInvites(
                        actorId, new WorkspaceInviteCreateRequest(List.of("jane@example.com"), "MEMBER")))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verifyNoInteractions(inviteRepository);
        verify(notifier, never()).inviteIssued(any(), any());
    }

    // --- listInvites ---

    @Test
    void listInvites_mapsPendingInvites() {
        givenActor(WorkspaceRole.ADMIN);
        PageRequest pageable = PageRequest.of(0, 20);
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findAllByWorkspaceIdAndAcceptedAtIsNull(workspaceId, pageable))
                .thenReturn(new PageImpl<>(List.of(invite), pageable, 1));

        Page<WorkspaceInviteResponse> invites = inviteService.listInvites(actorId, pageable);

        assertThat(invites.getContent()).hasSize(1);
        assertThat(invites.getContent().get(0).email()).isEqualTo("jane@example.com");
        assertThat(invites.getContent().get(0).role()).isEqualTo(WorkspaceRole.MEMBER);
        assertThat(invites.getContent().get(0).expiresAt()).isNotNull();
    }

    @Test
    void purgeExpiredInvites_deletesOnlyRowsPastTheRetentionWindow() {
        when(inviteRepository.deletePendingExpiredBefore(any())).thenReturn(2);

        assertThat(inviteService.purgeExpiredInvites()).isEqualTo(2);

        ArgumentCaptor<OffsetDateTime> cutoff = ArgumentCaptor.forClass(OffsetDateTime.class);
        verify(inviteRepository).deletePendingExpiredBefore(cutoff.capture());
        assertThat(cutoff.getValue()).isBefore(OffsetDateTime.now().minusDays(29));
    }

    // --- revoke ---

    @Test
    void revoke_deletesThePendingInviteWithAConditionalDelete() {
        givenActor(WorkspaceRole.OWNER);
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByIdAndWorkspaceId(invite.getId(), workspaceId))
                .thenReturn(Optional.of(invite));
        when(inviteRepository.deletePendingById(invite.getId())).thenReturn(1);

        inviteService.revoke(actorId, invite.getId());

        // The conditional DELETE is the write of record: a plain delete would remove a
        // row claimed since the lookup.
        verify(inviteRepository).deletePendingById(invite.getId());
        verify(inviteRepository, never()).delete(any(WorkspaceInvite.class));
    }

    @Test
    void revoke_whenTheInviteWasClaimedSinceTheLoad_throwsNotFound() {
        givenActor(WorkspaceRole.OWNER);
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByIdAndWorkspaceId(invite.getId(), workspaceId))
                .thenReturn(Optional.of(invite));
        when(inviteRepository.deletePendingById(invite.getId())).thenReturn(0);

        assertThatThrownBy(() -> inviteService.revoke(actorId, invite.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
    }

    @Test
    void revoke_masksAcceptedInvitesAsNotFound() {
        givenActor(WorkspaceRole.OWNER);
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        invite.setAcceptedAt(OffsetDateTime.now());
        when(inviteRepository.findByIdAndWorkspaceId(invite.getId(), workspaceId))
                .thenReturn(Optional.of(invite));

        assertThatThrownBy(() -> inviteService.revoke(actorId, invite.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
        verify(inviteRepository, never()).deletePendingById(any());
    }

    @Test
    void revoke_letsAnAdminRevokeMemberInvitesOnly() {
        givenActor(WorkspaceRole.ADMIN);
        WorkspaceInvite memberInvite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByIdAndWorkspaceId(memberInvite.getId(), workspaceId))
                .thenReturn(Optional.of(memberInvite));
        when(inviteRepository.deletePendingById(memberInvite.getId())).thenReturn(1);
        inviteService.revoke(actorId, memberInvite.getId());
        verify(inviteRepository).deletePendingById(memberInvite.getId());

        WorkspaceInvite ownerInvite = pendingInvite("jane@example.com", WorkspaceRole.OWNER);
        when(inviteRepository.findByIdAndWorkspaceId(ownerInvite.getId(), workspaceId))
                .thenReturn(Optional.of(ownerInvite));
        assertThatThrownBy(() -> inviteService.revoke(actorId, ownerInvite.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
    }

    // --- resend ---

    @Test
    void resend_rotatesTheTokenAndEmailsTheFreshLink() {
        givenActor(WorkspaceRole.OWNER);
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByIdAndWorkspaceId(invite.getId(), workspaceId))
                .thenReturn(Optional.of(invite));
        when(inviteRepository.rotatePendingToken(eq(invite.getId()), anyString(), any(OffsetDateTime.class)))
                .thenReturn(1);

        WorkspaceInviteCreatedResponse response = inviteService.resend(actorId, invite.getId());

        assertThat(response.email()).isEqualTo("jane@example.com");
        assertThat(response.role()).isEqualTo(WorkspaceRole.MEMBER);
        assertThat(response.expiresAt()).isAfter(OffsetDateTime.now().plusDays(INVITE_EXPIRY_DAYS - 1));
        String rawToken = tokenFromUrl(announcedUrlFor(invite));
        ArgumentCaptor<String> hashCaptor = ArgumentCaptor.forClass(String.class);
        verify(inviteRepository)
                .rotatePendingToken(eq(invite.getId()), hashCaptor.capture(), any(OffsetDateTime.class));
        // The row moves onto the new token's hash, so the previous link dies with it.
        assertThat(hashCaptor.getValue()).isEqualTo(SecureTokens.sha256Hex(rawToken));
        assertThat(hashCaptor.getValue()).isNotEqualTo(invite.getTokenHash());
    }

    @Test
    void resend_whenDeliveryIsNotConfigured_throwsWithoutRotating() {
        givenActor(WorkspaceRole.OWNER);
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByIdAndWorkspaceId(invite.getId(), workspaceId))
                .thenReturn(Optional.of(invite));
        when(notifier.isDeliveryConfigured()).thenReturn(false);

        // Rotating first would kill the old link with no fresh one deliverable, so the
        // refusal comes before the write.
        assertThatThrownBy(() -> inviteService.resend(actorId, invite.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode())
                        .isEqualTo(ErrorCode.EMAIL_DELIVERY_NOT_CONFIGURED));
        verify(inviteRepository, never()).rotatePendingToken(any(), anyString(), any(OffsetDateTime.class));
        verify(notifier, never()).inviteIssued(any(), any());
    }

    @Test
    void resend_whenTheInviteWasClaimedSinceTheLoad_throwsNotFound() {
        givenActor(WorkspaceRole.OWNER);
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByIdAndWorkspaceId(invite.getId(), workspaceId))
                .thenReturn(Optional.of(invite));
        when(inviteRepository.rotatePendingToken(eq(invite.getId()), anyString(), any(OffsetDateTime.class)))
                .thenReturn(0);

        // The conditional UPDATE lost to the accepting transaction; nothing is left to
        // resend, and the accepted row is not exposed.
        assertThatThrownBy(() -> inviteService.resend(actorId, invite.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.NOT_FOUND));
        verify(notifier, never()).inviteIssued(any(), any());
    }

    @Test
    void resend_letsAnAdminResendMemberInvitesOnly() {
        givenActor(WorkspaceRole.ADMIN);
        WorkspaceInvite ownerInvite = pendingInvite("jane@example.com", WorkspaceRole.OWNER);
        when(inviteRepository.findByIdAndWorkspaceId(ownerInvite.getId(), workspaceId))
                .thenReturn(Optional.of(ownerInvite));

        assertThatThrownBy(() -> inviteService.resend(actorId, ownerInvite.getId()))
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.FORBIDDEN));
        verifyNoInteractions(notifier);
    }

    // --- preview ---

    @Test
    void preview_resolvesTheInvitedEmailWorkspaceRoleAndExpiry() {
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.ADMIN);
        when(inviteRepository.findByTokenHash(SecureTokens.sha256Hex(RAW_TOKEN)))
                .thenReturn(Optional.of(invite));

        WorkspaceInvitePreviewResponse preview = inviteService.preview(RAW_TOKEN);

        assertThat(preview.email()).isEqualTo("jane@example.com");
        assertThat(preview.workspaceName()).isEqualTo("NextDocs");
        assertThat(preview.role()).isEqualTo(WorkspaceRole.ADMIN);
        assertThat(preview.expiresAt()).isEqualTo(invite.getExpiresAt());
    }

    @Test
    void preview_unknownExpiredAndConsumedTokensFailIdentically() {
        when(inviteRepository.findByTokenHash(anyString())).thenReturn(Optional.empty());
        assertInvalidInvite(() -> inviteService.preview(RAW_TOKEN));

        WorkspaceInvite expired = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        expired.setExpiresAt(OffsetDateTime.now().minusSeconds(1));
        when(inviteRepository.findByTokenHash(anyString())).thenReturn(Optional.of(expired));
        assertInvalidInvite(() -> inviteService.preview(RAW_TOKEN));

        WorkspaceInvite consumed = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        consumed.setAcceptedAt(OffsetDateTime.now());
        when(inviteRepository.findByTokenHash(anyString())).thenReturn(Optional.of(consumed));
        assertInvalidInvite(() -> inviteService.preview(RAW_TOKEN));
    }

    // --- requireUsable ---

    @Test
    void requireUsable_unknownToken_throwsInvalidInvite() {
        when(inviteRepository.findByTokenHashForUpdate(anyString())).thenReturn(Optional.empty());

        assertInvalidInvite(() -> inviteService.requireUsable(RAW_TOKEN, "jane@example.com"));
    }

    @Test
    void requireUsable_expiredInvite_throwsInvalidInvite() {
        WorkspaceInvite expired = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        expired.setExpiresAt(OffsetDateTime.now().minusSeconds(1));
        when(inviteRepository.findByTokenHashForUpdate(anyString())).thenReturn(Optional.of(expired));

        // Unknown, expired, consumed and rotated tokens answer identically, so the
        // response cannot be used to probe who has been invited.
        assertInvalidInvite(() -> inviteService.requireUsable(RAW_TOKEN, "jane@example.com"));
    }

    @Test
    void requireUsable_consumedInvite_throwsInvalidInvite() {
        WorkspaceInvite consumed = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        consumed.setAcceptedAt(OffsetDateTime.now());
        when(inviteRepository.findByTokenHashForUpdate(anyString())).thenReturn(Optional.of(consumed));

        assertInvalidInvite(() -> inviteService.requireUsable(RAW_TOKEN, "jane@example.com"));
    }

    @Test
    void requireUsable_emailMismatch_throwsInvalidInvite() {
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByTokenHashForUpdate(anyString())).thenReturn(Optional.of(invite));

        // The link admits exactly the address it names; another address with a leaked
        // token gets the same failure as an unknown token.
        assertInvalidInvite(() -> inviteService.requireUsable(RAW_TOKEN, "mallory@example.com"));
    }

    @Test
    void requireUsable_pendingInviteForTheEmail_isReturned() {
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        when(inviteRepository.findByTokenHashForUpdate(SecureTokens.sha256Hex(RAW_TOKEN)))
                .thenReturn(Optional.of(invite));

        assertThat(inviteService.requireUsable(RAW_TOKEN, "jane@example.com")).isSameAs(invite);
    }

    // --- consume ---

    @Test
    void consume_claimsTheInviteAgainstThePresentedTokensHash() {
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        User jane = user("jane@example.com", "Jane");
        when(inviteRepository.markAccepted(
                        eq(invite.getId()), eq(SecureTokens.sha256Hex(RAW_TOKEN)), eq(jane), any(OffsetDateTime.class)))
                .thenReturn(1);

        inviteService.consume(invite, jane, RAW_TOKEN);

        verify(inviteRepository)
                .markAccepted(
                        eq(invite.getId()), eq(SecureTokens.sha256Hex(RAW_TOKEN)), eq(jane), any(OffsetDateTime.class));
    }

    @Test
    void consume_whenTheTokenWasRotatedOrAnotherRegistrationWon_throwsInvalidInvite() {
        WorkspaceInvite invite = pendingInvite("jane@example.com", WorkspaceRole.MEMBER);
        User jane = user("jane@example.com", "Jane");
        when(inviteRepository.markAccepted(eq(invite.getId()), anyString(), eq(jane), any(OffsetDateTime.class)))
                .thenReturn(0);

        assertInvalidInvite(() -> inviteService.consume(invite, jane, RAW_TOKEN));
    }

    private static void assertInvalidInvite(org.assertj.core.api.ThrowableAssert.ThrowingCallable callable) {
        assertThatThrownBy(callable)
                .isInstanceOf(ApiException.class)
                .satisfies(ex -> assertThat(((ApiException) ex).getErrorCode()).isEqualTo(ErrorCode.INVALID_INVITE));
    }
}
