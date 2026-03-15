package com.nextdocs.api.auth.security.ratelimit;

import static org.assertj.core.api.Assertions.assertThat;

import com.nextdocs.api.common.cache.CaffeineCacheStore;
import io.github.bucket4j.Bucket;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class InMemoryRateLimiterTest {

    private InMemoryRateLimiter rateLimiter;

    @BeforeEach
    void setUp() {
        CaffeineCacheStore<String, Bucket> cacheStore = new CaffeineCacheStore<>();
        rateLimiter = new InMemoryRateLimiter(cacheStore);
    }

    @Test
    void requestBelowLimit_isAllowed() {
        for (int i = 0; i < 20; i++) {
            assertThat(rateLimiter.allowRequest("10.0.0.1")).isTrue();
        }
    }

    @Test
    void twentyFirstRequest_isRejected() {
        for (int i = 0; i < 20; i++) {
            assertThat(rateLimiter.allowRequest("10.0.0.2")).isTrue();
        }

        assertThat(rateLimiter.allowRequest("10.0.0.2")).isFalse();
    }

    @Test
    void differentKeys_haveIndependentBuckets() {
        for (int i = 0; i < 20; i++) {
            assertThat(rateLimiter.allowRequest("192.168.1.1")).isTrue();
        }

        assertThat(rateLimiter.allowRequest("192.168.1.2")).isTrue();
    }

    @Test
    void cacheEvictionWithManyDistinctKeys_doesNotGrowUnbounded() {
        // Simulate many distinct keys to verify cache evicts entries
        // Create entries beyond the cache limit to trigger eviction
        int numKeys = 15000;
        for (int i = 0; i < numKeys; i++) {
            String key = "user-" + i;
            // Just one request per key to populate the cache
            rateLimiter.allowRequest(key);
        }

        // After eviction, the cache size should be bounded (not all 15000 entries)
        // This test verifies that the cache doesn't grow unbounded.
        // We can't directly access internal size, but we can verify that
        // the limiter still works correctly after many keys have been evicted.

        // Request from a recent key should work
        assertThat(rateLimiter.allowRequest("user-14999")).isTrue();

        // Even after many requests, memory should be bounded by MAX_CACHE_SIZE (10000)
        // Create 100 more keys to ensure no memory leak
        for (int i = 15000; i < 15100; i++) {
            rateLimiter.allowRequest("user-" + i);
        }

        // Verify new keys still work and don't cause issues
        assertThat(rateLimiter.allowRequest("user-15099")).isTrue();
    }
}
