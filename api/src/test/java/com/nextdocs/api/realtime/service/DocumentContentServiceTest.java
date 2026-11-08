package com.nextdocs.api.realtime.service;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.when;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;
import com.nextdocs.api.realtime.client.YhubClient;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

@ExtendWith(MockitoExtension.class)
class DocumentContentServiceTest {

    @Mock
    private YhubClient yhubClient;

    @InjectMocks
    private DocumentContentService contentService;

    @Test
    void read_ok_returnsBase64Update() {
        UUID documentId = UUID.randomUUID();
        when(yhubClient.fetchUpdate(documentId)).thenReturn(YhubClient.UpdateFetch.ok(new byte[] {1, 2, 3}));

        assertEquals("AQID", contentService.read(documentId).content());
    }

    @Test
    void read_notFound_returnsNoContent() {
        UUID documentId = UUID.randomUUID();
        when(yhubClient.fetchUpdate(documentId)).thenReturn(YhubClient.UpdateFetch.notFound());

        assertNull(contentService.read(documentId).content());
    }

    @Test
    void read_emptyRoom_returnsNoContent() {
        UUID documentId = UUID.randomUUID();
        when(yhubClient.fetchUpdate(documentId)).thenReturn(YhubClient.UpdateFetch.ok(new byte[0]));

        assertNull(contentService.read(documentId).content());
    }

    @Test
    void read_transientFailure_returns503() {
        UUID documentId = UUID.randomUUID();
        when(yhubClient.fetchUpdate(documentId)).thenReturn(YhubClient.UpdateFetch.transientFailure());

        ApiException error = assertThrows(ApiException.class, () -> contentService.read(documentId));
        assertEquals(ErrorCode.SERVICE_UNAVAILABLE, error.getErrorCode());
    }
}
