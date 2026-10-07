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

    private final CacheStore<String, Bucket> bucketCache;

    public InMemoryRateLimiter(CacheStore<String, Bucket> bucketCache) {
        this.bucketCache = bucketCache;
    }

    @Override
    public Decision allowRequest(String key) {
        return allowRequest(key, DEFAULT_MAX_REQUESTS, DEFAULT_WINDOW);
    }

    @Override
    public Decision allowRequest(String key, int maxRequests, Duration window) {
        // Budgets are part of the cache key so a reconfigured limit (or two
        // callers sharing one IP with different budgets) never reuses a stale
        // bucket minted under another budget.
        String bucketKey = key + "|" + maxRequests + "|" + window.toNanos();
        Bucket bucket = bucketCache.get(bucketKey, ignoredKey -> newBucket(maxRequests, window));
        if (bucket.tryConsume(1)) {
            return Decision.allow();
        }
        // tryConsume is the atomic admission decision; only a refusal pays for the
        // extra probe, which is what makes Retry-After honest: the limit refills
        // greedily, so the next token can arrive long before the window ends.
        long nanosToRefill = bucket.estimateAbilityToConsume(1).getNanosToWaitForRefill();
        return Decision.deny(nanosToRefill > 0 ? Duration.ofNanos(nanosToRefill) : Duration.ZERO);
    }

    private Bucket newBucket(int maxRequests, Duration window) {
        return Bucket.builder()
                .addLimit(limit -> limit.capacity(maxRequests).refillGreedy(maxRequests, window))
                .build();
    }
}
