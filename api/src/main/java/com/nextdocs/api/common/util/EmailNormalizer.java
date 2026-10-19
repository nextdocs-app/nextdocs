package com.nextdocs.api.common.util;

import java.text.Normalizer;
import java.util.Locale;

/**
 * One canonical form for every email comparison: NFKC (so full-width and other
 * compatibility characters become the same address), trimmed, and lowercased with
 * {@link Locale#ROOT} (a Turkish-locale JVM would otherwise lowercase "I" to "ı").
 * Minting an invite and redeeming or logging in must use this exact function.
 */
public final class EmailNormalizer {

    private EmailNormalizer() {}

    public static String normalize(String rawEmail) {
        if (rawEmail == null) {
            return "";
        }
        return Normalizer.normalize(rawEmail, Normalizer.Form.NFKC).strip().toLowerCase(Locale.ROOT);
    }
}
