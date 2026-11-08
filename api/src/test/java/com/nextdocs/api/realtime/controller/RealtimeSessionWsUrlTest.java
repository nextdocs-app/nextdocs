package com.nextdocs.api.realtime.controller;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

import org.junit.jupiter.api.Test;

class RealtimeSessionWsUrlTest {

    @Test
    void keepsAConfiguredWebsocketUrlAndDropsTheTrailingSlash() {
        assertEquals(
                "ws://localhost:1234/api/ws/v1/nextdocs",
                RealtimeSessionController.resolveWsBaseUrl(
                        "ws://localhost:1234/api/ws/v1/nextdocs/", "http://localhost:3000"));
    }

    @Test
    void derivesWssFromAnHttpsOrigin() {
        assertEquals(
                "wss://docs.example.com/api/ws/v1/nextdocs",
                RealtimeSessionController.resolveWsBaseUrl("  ", "https://docs.example.com"));
    }

    @Test
    void keepsAPathPrefixOfThePublicOrigin() {
        assertEquals(
                "wss://example.com/docs/api/ws/v1/nextdocs",
                RealtimeSessionController.resolveWsBaseUrl(null, "https://example.com/docs/"));
    }

    @Test
    void refusesNonWebsocketSchemesAndMissingHosts() {
        assertThrows(
                IllegalStateException.class,
                () -> RealtimeSessionController.resolveWsBaseUrl("https://localhost:1234/ws", "http://localhost:3000"));
        assertThrows(
                IllegalStateException.class,
                () -> RealtimeSessionController.resolveWsBaseUrl("ws:///missing-host", "http://localhost:3000"));
    }

    @Test
    void refusesAnUnusablePublicOrigin() {
        assertThrows(IllegalStateException.class, () -> RealtimeSessionController.resolveWsBaseUrl("", "not-a-url"));
    }
}
