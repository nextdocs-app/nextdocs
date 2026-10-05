package com.nextdocs.api.auth.security.ratelimit;

import java.time.Duration;

/** Abstraction for request throttling keyed by caller identity. */
public interface RateLimiter {

    int DEFAULT_MAX_REQUESTS = 20;
    Duration DEFAULT_WINDOW = Duration.ofMinutes(1);

    boolean allowRequest(String key);

    boolean allowRequest(String key, int maxRequests, Duration window);
}
