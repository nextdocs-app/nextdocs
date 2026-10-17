package com.nextdocs.api.workspace.controller;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.head;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.workspace.repository.WorkspaceMemberRepository;
import com.nextdocs.api.workspace.service.WorkspaceAccessService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(InstanceController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class InstanceControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private WorkspaceAccessService accessService;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private WorkspaceMemberRepository memberRepository;

    @Test
    void status_reportsAnUninitializedInstanceSoTheFirstAccountSkipsInvites() throws Exception {
        when(accessService.isInitialized()).thenReturn(false);

        mockMvc.perform(get(InstanceController.STATUS_PATH))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.initialized").value(false));
    }

    @Test
    void status_reportsAnInitializedInstance() throws Exception {
        when(accessService.isInitialized()).thenReturn(true);

        mockMvc.perform(get(InstanceController.STATUS_PATH))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.initialized").value(true));
    }

    @Test
    void status_isReachableAnonymous_readsOnly() throws Exception {
        when(accessService.isInitialized()).thenReturn(true);

        // The auth screens read this before any account exists; a HEAD probe from a
        // monitoring client must answer too.
        mockMvc.perform(head(InstanceController.STATUS_PATH)).andExpect(status().isOk());
    }
}
