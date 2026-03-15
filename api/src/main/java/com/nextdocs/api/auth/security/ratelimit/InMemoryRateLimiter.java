package com.nextdocs.api.auth.security.ratelimit;

import com.nextdocs.api.common.cache.CacheStore;
import io.github.bucket4j.Bucket;
import java.time.Duration;
import org.springframework.stereotype.Component;

/**
 * Local Bucket4j-backed rate limiter.
 *
 * This is suitable for single-instance deployments only which we think
 * is fine for self hosted users.
 */
@Component
public class InMemoryRateLimiter implements RateLimiter {

    private static final int MAX_REQUESTS = 20;
    private static final Duration WINDOW = Duration.ofMinutes(1);

    private final CacheStore<String, Bucket> bucketCache;

    public InMemoryRateLimiter(CacheStore<String, Bucket> bucketCache) {
        this.bucketCache = bucketCache;
    }

    @Override
    public boolean allowRequest(String key) {
        Bucket bucket = bucketCache.get(key, ignoredKey -> newBucket());
        return bucket.tryConsume(1);
    }

    private Bucket newBucket() {
        return Bucket.builder()
                .addLimit(limit -> limit.capacity(MAX_REQUESTS).refillGreedy(MAX_REQUESTS, WINDOW))
                .build();
    }
}
