package com.nextdocs.api.auth.security.ratelimit;

/** Abstraction for request throttling keyed by caller identity. */
public interface RateLimiter {

    boolean allowRequest(String key);
}
