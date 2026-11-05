package com.nextdocs.api.auth.security;

import com.nextdocs.api.common.exception.ApiException;
import com.nextdocs.api.common.exception.ErrorCode;

/**
 * Helpers for endpoints that accept either an authenticated caller or an anonymous
 * share-link caller. A presented-but-unverifiable Bearer token must fail closed:
 * falling back to the anonymous access level would silently downgrade a signed-in
 * user whose session just expired.
 */
public final class BearerTokens {

    private static final String BEARER_SCHEME = "Bearer";

    private BearerTokens() {}

    public static void rejectInvalidBearer(String authorization) {
        if (authorization == null) {
            return;
        }
        // RFC 7235 makes the scheme case-insensitive, and a client that spells it
        // "bearer" must not slip past this guard into the anonymous access level.
        String trimmed = authorization.stripLeading();
        if (trimmed.regionMatches(true, 0, BEARER_SCHEME, 0, BEARER_SCHEME.length())) {
            if (trimmed.length() == BEARER_SCHEME.length()
                    || Character.isWhitespace(trimmed.charAt(BEARER_SCHEME.length()))) {
                throw new ApiException(ErrorCode.TOKEN_INVALID);
            }
        }
    }
}
