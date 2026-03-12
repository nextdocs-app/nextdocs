package com.nextdocs.api.common.cache;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import java.time.Duration;

/** Caffeine-backed implementation of CacheStore with TTL and size bounds. */
public class CaffeineCacheStore<K, V> implements CacheStore<K, V> {

    private static final int DEFAULT_MAX_SIZE = 10000;
    private static final Duration DEFAULT_TTL = Duration.ofMinutes(5);

    private final Cache<K, V> cache;

    public CaffeineCacheStore() {
        this(DEFAULT_MAX_SIZE, DEFAULT_TTL);
    }

    public CaffeineCacheStore(int maxSize, Duration ttl) {
        this.cache = Caffeine.newBuilder()
                .maximumSize(maxSize)
                .expireAfterAccess(ttl)
                .build();
    }

    @Override
    public V get(K key, ValueLoader<K, V> loader) {
        return cache.get(key, k -> loader.load(k));
    }
}
