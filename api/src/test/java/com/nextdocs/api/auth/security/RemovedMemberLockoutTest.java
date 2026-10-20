package com.nextdocs.api.auth.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.entity.User;
import com.nextdocs.api.auth.repository.RefreshTokenRepository;
import com.nextdocs.api.auth.repository.UserRepository;
import com.nextdocs.api.auth.service.TokenService;
import com.nextdocs.api.workspace.entity.Workspace;
import com.nextdocs.api.workspace.entity.WorkspaceMember;
import com.nextdocs.api.workspace.entity.WorkspaceRole;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.repository.WorkspaceRepository;
import com.nextdocs.api.workspace.service.WorkspaceService;
import jakarta.servlet.http.Cookie;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;

/**
 * Pins removal end to end: a removed member's access token is not a 15-minute grace
 * period. The JWT filter re-reads the live membership on every request, so the next
 * call after removal is refused — document endpoints included — and the member's
 * refresh session is already revoked.
 */
@SpringBootTest
@AutoConfigureMockMvc
class RemovedMemberLockoutTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private RefreshTokenRepository refreshTokenRepository;

    @Autowired
    private WorkspaceRepository workspaceRepository;

    @Autowired
    private WorkspaceMemberRepository memberRepository;

    @Autowired
    private WorkspaceService workspaceService;

    @Autowired
    private JwtTokenProvider jwtTokenProvider;

    @Autowired
    private TokenService tokenService;

    @Test
    void removedMember_losesDocumentAccessOnTheNextRequest() throws Exception {
        String suffix = UUID.randomUUID().toString();
        User owner = saveUser("owner-" + suffix + "@example.com", "Owner");
        User member = saveUser("member-" + suffix + "@example.com", "Member");
        Workspace workspace = workspaceRepository.saveAndFlush(
                Workspace.builder().name("NextDocs").build());
        memberRepository.saveAndFlush(member(workspace, owner, WorkspaceRole.OWNER));
        memberRepository.saveAndFlush(member(workspace, member, WorkspaceRole.MEMBER));

        String ownerToken = jwtTokenProvider.generateAccessToken(owner.getId(), owner.getEmail());
        String memberToken = jwtTokenProvider.generateAccessToken(member.getId(), member.getEmail());
        String memberRefresh =
                tokenService.issueRefreshToken(member, new MockHttpServletRequest(), new MockHttpServletResponse());

        // The member token is live before the removal…
        mockMvc.perform(get("/api/v1/documents").header("Authorization", "Bearer " + memberToken))
                .andExpect(status().isOk());

        workspaceService.removeMember(owner.getId(), member.getId());

        // …and dead on the very next request, without waiting out the token's expiry.
        mockMvc.perform(get("/api/v1/documents").header("Authorization", "Bearer " + memberToken))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(get("/api/v1/workspaces/current").header("Authorization", "Bearer " + memberToken))
                .andExpect(status().isUnauthorized());
        // The refresh cookie cannot mint a way back in either: removal revoked it.
        mockMvc.perform(post("/api/v1/auth/refresh").cookie(new Cookie("rt", memberRefresh)))
                .andExpect(status().isUnauthorized());
        // Other members are unaffected.
        mockMvc.perform(get("/api/v1/documents").header("Authorization", "Bearer " + ownerToken))
                .andExpect(status().isOk());

        // Even if the account were flipped active again without a membership, the old
        // token stays refused: the gate is the live membership, not the account flag.
        member.setActive(true);
        userRepository.saveAndFlush(member);
        mockMvc.perform(get("/api/v1/documents").header("Authorization", "Bearer " + memberToken))
                .andExpect(status().isUnauthorized());

        assertThat(memberRepository.findByUserId(member.getId())).isEmpty();
        assertThat(userRepository.findById(member.getId()))
                .hasValueSatisfying(user -> assertThat(user.isActive()).isTrue());
    }

    /** This class runs without a test transaction, so it must return the shared H2 schema clean. */
    @AfterEach
    void removeCreatedRows() {
        refreshTokenRepository.deleteAll();
        memberRepository.deleteAll();
        workspaceRepository.deleteAll();
        userRepository.deleteAll();
    }

    private User saveUser(String email, String displayName) {
        return userRepository.saveAndFlush(User.builder()
                .email(email)
                .displayName(displayName)
                .passwordHash("$2a$12$hash")
                .build());
    }

    private static WorkspaceMember member(Workspace workspace, User user, WorkspaceRole role) {
        return WorkspaceMember.builder()
                .workspace(workspace)
                .user(user)
                .role(role)
                .build();
    }
}
