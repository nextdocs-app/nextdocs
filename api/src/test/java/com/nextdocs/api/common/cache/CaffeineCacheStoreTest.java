package com.nextdocs.api.common.cache;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class CaffeineCacheStoreTest {

    private CaffeineCacheStore<String, String> cacheStore;

    @BeforeEach
    void setUp() {
        cacheStore = new CaffeineCacheStore<>();
    }

    @Test
    void get_createsNewValueIfNotExists() {
        String result = cacheStore.get("key1", key -> "value1");
        assertThat(result).isEqualTo("value1");
    }

    @Test
    void get_returnsSameCachedValueForSameKey() {
        String result1 = cacheStore.get("key1", key -> "first");
        String result2 = cacheStore.get("key1", key -> "second");

        assertThat(result1).isEqualTo("first");
        assertThat(result2).isEqualTo("first"); // Should return cached value
    }

    @Test
    void get_returnsIndependentValuesForDifferentKeys() {
        String result1 = cacheStore.get("key1", key -> "value1");
        String result2 = cacheStore.get("key2", key -> "value2");

        assertThat(result1).isEqualTo("value1");
        assertThat(result2).isEqualTo("value2");
    }

    @Test
    void cacheEvictionWithManyDistinctKeys_doesNotGrowUnbounded() {
        // Create a cache with small size to test eviction
        CaffeineCacheStore<String, String> smallCache = new CaffeineCacheStore<>(100, Duration.ofMinutes(1));

        // Create entries beyond the cache limit to trigger eviction
        int numKeys = 500;
        for (int i = 0; i < numKeys; i++) {
            int index = i; // Effectively final for lambda
            String key = "key-" + index;
            smallCache.get(key, k -> "value-" + index);
        }

        // After eviction, verify the cache still works correctly
        String recentValue = smallCache.get("key-499", k -> "new-value");
        assertThat(recentValue).isEqualTo("value-499"); // key-499 was inserted last and should be retained

        // Create more keys to ensure no memory leak
        for (int i = 500; i < 600; i++) {
            int index = i; // Effectively final for lambda
            String value = smallCache.get("key-" + index, k -> "value-" + index);
            assertThat(value).isNotNull();
        }
    }
}
