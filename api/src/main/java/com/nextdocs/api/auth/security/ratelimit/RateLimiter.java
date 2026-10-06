package com.nextdocs.api.auth.security.ratelimit;

import java.time.Duration;

/**
 * Abstraction for request throttling keyed by caller identity.
 *
 * A check answers both halves of one question: whether the request may proceed
 * and, when it may not, how long the caller has to wait. Those come from the same
 * consume, so a rejection carries the limiter's own refill estimate instead of a
 * second, racier read of the bucket.
 */
public interface RateLimiter {

    int DEFAULT_MAX_REQUESTS = 20;
    Duration DEFAULT_WINDOW = Duration.ofMinutes(1);

    Decision allowRequest(String key);

    Decision allowRequest(String key, int maxRequests, Duration window);

    /** Outcome of one throttling check. */
    record Decision(boolean allowed, Duration retryAfter) {

        public static Decision allow() {
            return new Decision(true, Duration.ZERO);
        }

        public static Decision deny(Duration retryAfter) {
            return new Decision(false, retryAfter == null ? Duration.ZERO : retryAfter);
        }

        /**
         * Retry-After value in whole seconds, rounded up so a client that waits exactly
         * this long retries after a token has refilled, and never below one second so a
         * refusal cannot invite a tight retry loop.
         */
        public long retryAfterSeconds() {
            if (retryAfter == null || retryAfter.isZero() || retryAfter.isNegative()) {
                return 1;
            }
            long wholeSeconds = retryAfter.toSeconds();
            boolean hasRemainder = retryAfter.minusSeconds(wholeSeconds).toNanos() > 0;
            return Math.max(wholeSeconds + (hasRemainder ? 1 : 0), 1);
        }
    }
}
