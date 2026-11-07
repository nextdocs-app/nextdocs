package com.nextdocs.api.realtime.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.nextdocs.api.auth.security.JwtTokenProvider;
import com.nextdocs.api.document.dto.response.DocumentAccessResponse;
import com.nextdocs.api.document.entity.Document;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.repository.DocumentRepository;
import com.nextdocs.api.document.service.DocumentSharingService;
import com.nextdocs.api.realtime.client.YhubClient;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(RealtimeSessionController.class)
@Import({
    com.nextdocs.api.auth.security.SecurityConfig.class,
    com.nextdocs.api.common.cache.CaffeineCacheStore.class,
    com.nextdocs.api.auth.security.ratelimit.InMemoryRateLimiter.class
})
class RealtimeSessionControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private DocumentRepository documentRepository;

    @MockitoBean
    private DocumentSharingService sharingService;

    @MockitoBean
    private YhubClient yhubClient;

    @MockitoBean
    private JwtTokenProvider jwtTokenProvider;

    @MockitoBean
    private com.nextdocs.api.workspace.repository.WorkspaceMemberRepository workspaceMemberRepository;

    @Test
    void deniesAccessWhenNotAllowed() throws Exception {
        UUID docId = UUID.randomUUID();
        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, false, null, false, false));

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId)).andExpect(status().isForbidden());
    }

    @Test
    void deniesAccessWhenTrashed() throws Exception {
        UUID docId = UUID.randomUUID();
        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.VIEW, false, true));

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId)).andExpect(status().isForbidden());
    }

    @Test
    void returnsSessionAndSeedsUnseededDocument() throws Exception {
        UUID docId = UUID.randomUUID();
        byte[] state = new byte[] {1, 2, 3};
        Document doc =
                Document.builder().id(docId).title("Test Doc").yjsState(state).build();

        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.EDIT, false, false));
        when(documentRepository.findById(eq(docId))).thenReturn(Optional.of(doc));
        when(yhubClient.seed(eq(docId), eq(state))).thenReturn(true);

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.wsUrl").value("ws://localhost:1234/api/ws/v1/nextdocs"))
                .andExpect(jsonPath("$.data.documentId").value(docId.toString()))
                .andExpect(jsonPath("$.data.accessLevel").value("EDIT"))
                // The old contract leaked client-side gates the server no longer honours.
                .andExpect(jsonPath("$.data.readOnly").doesNotExist())
                .andExpect(jsonPath("$.data.expiresAtEpochMs").doesNotExist());

        verify(yhubClient).seed(eq(docId), eq(state));
        verify(documentRepository).markYhubSeeded(eq(docId), any());
    }

    @Test
    void failsClosedWhenSeedingCannotComplete() throws Exception {
        UUID docId = UUID.randomUUID();
        byte[] state = new byte[] {1, 2, 3};
        Document doc =
                Document.builder().id(docId).title("Test Doc").yjsState(state).build();

        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.EDIT, false, false));
        when(documentRepository.findById(eq(docId))).thenReturn(Optional.of(doc));
        when(yhubClient.seed(eq(docId), eq(state))).thenReturn(false);

        // Serving the session anyway would open an empty document and let the next save
        // overwrite the real snapshot.
        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId))
                .andExpect(status().isServiceUnavailable());

        verify(documentRepository, never()).markYhubSeeded(any(), any());
    }

    @Test
    void marksAnEmptyDocumentSeededWithoutCallingYhub() throws Exception {
        UUID docId = UUID.randomUUID();
        Document doc = Document.builder()
                .id(docId)
                .title("Empty")
                .yjsState(new byte[0])
                .build();

        when(sharingService.accessCheckPublic(eq(docId)))
                .thenReturn(new DocumentAccessResponse(docId, true, DocumentAccessLevel.EDIT, false, false));
        when(documentRepository.findById(eq(docId))).thenReturn(Optional.of(doc));

        mockMvc.perform(post("/api/v1/documents/{id}/realtime-session", docId)).andExpect(status().isOk());

        verifyNoInteractions(yhubClient);
        verify(documentRepository).markYhubSeeded(eq(docId), any());
    }
}
