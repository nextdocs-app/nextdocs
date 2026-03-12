package com.nextdocs.api.common.cache;

/**
 * Generic abstraction for caching key-value pairs.
 *
 * Implementations can be backed by in-memory caches (Caffeine), distributed caches
 * (Redis), or other storage mechanisms. We currently implement only in-memory cache
 * using Caffeine which is suitable for most self-hosted deployments.
 */
public interface CacheStore<K, V> {

    V get(K key, ValueLoader<K, V> loader);

    @FunctionalInterface
    interface ValueLoader<K, V> {
        V load(K key);
    }
}
