package com.nextdocs.api.mention.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.service.PermissionService;
import com.nextdocs.api.mention.dto.response.MentionCandidateResponse;
import com.nextdocs.api.user.entity.User;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class MentionCandidateServiceTest {

    @Mock
    private WorkspaceMemberRepository memberRepository;

    @Mock
    private WorkspaceAccessService workspaceAccessService;

    @Mock
    private PermissionService permissionService;

    private MentionCandidateService candidateService;

    private UUID callerId;
    private UUID documentId;
    private UUID workspaceId;
    private User caller;
    private User bob;
    private User charlie;
    private Document document;

    @BeforeEach
    void setUp() {
        candidateService = new MentionCandidateService(memberRepository, workspaceAccessService, permissionService);
        callerId = UUID.randomUUID();
        documentId = UUID.randomUUID();
        workspaceId = UUID.randomUUID();
        caller = user(callerId, "Alice");
        bob = user(UUID.randomUUID(), "Bob");
        charlie = user(UUID.randomUUID(), "Charlie");
        document = Document.builder().id(documentId).title("Doc").build();
    }

    @Test
    void returnsOnlyPeopleWithCurrentAccessAndExcludesTheCaller() {
        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq("bo"), any()))
                .thenReturn(List.of(caller, bob, charlie));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(bob.getId(), DocumentAccessLevel.VIEW, charlie.getId(), null));

        List<MentionCandidateResponse> result = candidateService.search(callerId, documentId, "  bo  ", 20);

        assertEquals(1, result.size());
        assertEquals(bob.getId(), result.getFirst().userId());
        assertEquals("Bob", result.getFirst().displayName());
    }

    @Test
    void viewOnlyCallerCannotEnumerateCandidates() {
        when(permissionService.requireCommentAccess(callerId, documentId))
                .thenThrow(new ApiException(ErrorCode.FORBIDDEN));

        ApiException error =
                assertThrows(ApiException.class, () -> candidateService.search(callerId, documentId, "", 20));

        assertEquals(ErrorCode.FORBIDDEN, error.getErrorCode());
        verifyNoInteractions(memberRepository, workspaceAccessService);
    }

    @Test
    void commentAccessFromALinkAloneCannotEnumerateCandidates() {
        // A signed-in member may reach a standalone private page only through a COMMENT
        // link: that is enough to comment, but not to enumerate member names and emails.
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        doThrow(new ApiException(ErrorCode.NOT_FOUND)).when(permissionService).requireRosterAccess(callerId, document);

        ApiException error =
                assertThrows(ApiException.class, () -> candidateService.search(callerId, documentId, "", 20));

        assertEquals(ErrorCode.NOT_FOUND, error.getErrorCode());
        verifyNoInteractions(memberRepository);
    }

    @Test
    void keepsPagingWhileTheFirstOverFetchedPageHasNobodyWithAccess() {
        User blockedOne = user(UUID.randomUUID(), "Blocked One");
        User blockedTwo = user(UUID.randomUUID(), "Blocked Two");
        User blockedThree = user(UUID.randomUUID(), "Blocked Three");
        User blockedFour = user(UUID.randomUUID(), "Blocked Four");
        User dave = user(UUID.randomUUID(), "Dave");

        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        // limit 1 over-fetches a page of 4; the whole first page is inaccessible, so the
        // answer must not come back empty while a later match qualifies.
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq(""), any()))
                .thenReturn(List.of(blockedOne, blockedTwo, blockedThree, blockedFour), List.of(dave));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(
                        access(
                                blockedOne.getId(),
                                null,
                                blockedTwo.getId(),
                                null,
                                blockedThree.getId(),
                                null,
                                blockedFour.getId(),
                                null),
                        access(dave.getId(), DocumentAccessLevel.VIEW));

        List<MentionCandidateResponse> result = candidateService.search(callerId, documentId, "", 1);

        assertEquals(1, result.size());
        assertEquals(dave.getId(), result.getFirst().userId());
    }

    @Test
    void ignoresAPageWhereOnlyTheCallerMatches() {
        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq(""), any()))
                .thenReturn(List.of(caller));

        List<MentionCandidateResponse> result = candidateService.search(callerId, documentId, "", 20);

        assertTrue(result.isEmpty());
        // Only the caller matched, so there is nobody to resolve access for.
        verify(permissionService, never()).resolveAccessForUsers(any(), any(), eq(false));
    }

    @Test
    void stopsCollectingOnceTheAnswerIsFull() {
        User dave = user(UUID.randomUUID(), "Dave");
        User erin = user(UUID.randomUUID(), "Erin");
        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        // A full page keeps the walk going, so the loop condition must notice that the
        // answer is already full instead of over-fetching another page.
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq(""), any()))
                .thenReturn(List.of(bob, charlie, dave, erin));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access(
                        bob.getId(),
                        DocumentAccessLevel.VIEW,
                        charlie.getId(),
                        DocumentAccessLevel.VIEW,
                        dave.getId(),
                        DocumentAccessLevel.VIEW,
                        erin.getId(),
                        DocumentAccessLevel.VIEW));

        List<MentionCandidateResponse> result = candidateService.search(callerId, documentId, "", 1);

        assertEquals(1, result.size());
        assertEquals(bob.getId(), result.getFirst().userId());
        verify(memberRepository, times(1)).searchMentionableUsers(eq(workspaceId), eq(""), any());
    }

    @Test
    void normalizesAMissingQueryToAnEmptySearch() {
        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq(""), any()))
                .thenReturn(List.of());

        assertTrue(candidateService.search(callerId, documentId, null, 20).isEmpty());
        verify(memberRepository).searchMentionableUsers(eq(workspaceId), eq(""), any());
    }

    @Test
    void truncatesAnOverlongQueryToTheDatabaseLimit() {
        String longQuery = "x".repeat(150);
        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq("x".repeat(100)), any()))
                .thenReturn(List.of());

        assertTrue(candidateService.search(callerId, documentId, longQuery, 20).isEmpty());
        verify(memberRepository).searchMentionableUsers(eq(workspaceId), eq("x".repeat(100)), any());
    }

    @Test
    void keepsPagingPastAFullInaccessiblePageUntilTheMatchesRunOut() {
        // A full page of people without access does not prove the query is exhausted: the
        // next match may be eligible, so the walk continues until a short page.
        List<User> blocked = IntStream.range(0, 200)
                .mapToObj(index -> user(UUID.randomUUID(), "Blocked " + index))
                .toList();
        User dave = user(UUID.randomUUID(), "Dave");
        Map<UUID, DocumentAccessLevel> noAccess = new HashMap<>();
        for (User user : blocked) {
            noAccess.put(user.getId(), null);
        }
        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq(""), any()))
                .thenReturn(blocked, List.of(dave));
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(noAccess, access(dave.getId(), DocumentAccessLevel.VIEW));

        List<MentionCandidateResponse> result = candidateService.search(callerId, documentId, "", 50);

        assertEquals(1, result.size());
        assertEquals(dave.getId(), result.getFirst().userId());
        verify(memberRepository, times(2)).searchMentionableUsers(eq(workspaceId), eq(""), any());
    }

    @Test
    void stopsWhenAnInaccessiblePageIsAlsoTheLastMatch() {
        List<User> blocked = IntStream.range(0, 200)
                .mapToObj(index -> user(UUID.randomUUID(), "Blocked " + index))
                .toList();
        Map<UUID, DocumentAccessLevel> access = new HashMap<>();
        for (User user : blocked) {
            access.put(user.getId(), null);
        }
        when(workspaceAccessService.requireMember(callerId)).thenReturn(membership());
        when(permissionService.requireCommentAccess(callerId, documentId)).thenReturn(commentAccess());
        when(memberRepository.searchMentionableUsers(eq(workspaceId), eq(""), any()))
                .thenReturn(blocked, List.of());
        when(permissionService.resolveAccessForUsers(eq(documentId), any(), eq(false)))
                .thenReturn(access);

        assertTrue(candidateService.search(callerId, documentId, "", 50).isEmpty());
        // Two calls: the full page, then the empty one that proves there is nobody left.
        verify(memberRepository, times(2)).searchMentionableUsers(eq(workspaceId), eq(""), any());
    }

    private WorkspaceAccessService.Membership membership() {
        Workspace workspace =
                Workspace.builder().id(workspaceId).name("Workspace").build();
        WorkspaceMember membership = WorkspaceMember.builder()
                .workspace(workspace)
                .user(caller)
                .role(WorkspaceRole.MEMBER)
                .build();
        return new WorkspaceAccessService.Membership(workspace, membership);
    }

    private PermissionService.DocumentCommentAccess commentAccess() {
        return new PermissionService.DocumentCommentAccess(document, DocumentAccessLevel.COMMENT);
    }

    private static User user(UUID id, String name) {
        return User.builder()
                .id(id)
                .email(name.toLowerCase().replace(' ', '.') + "@example.com")
                .displayName(name)
                .passwordHash("$2a$12$hash")
                .active(true)
                .build();
    }

    private static Map<UUID, DocumentAccessLevel> access(Object... pairs) {
        Map<UUID, DocumentAccessLevel> access = new HashMap<>();
        for (int i = 0; i < pairs.length; i += 2) {
            access.put((UUID) pairs[i], (DocumentAccessLevel) pairs[i + 1]);
        }
        return access;
    }
}
