package com.nextdocs.api.auth.security;

import jakarta.annotation.PostConstruct;
import jakarta.servlet.http.HttpServletRequest;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.web.util.matcher.IpAddressMatcher;

/**
 * Resolves the client address behind a reverse proxy from {@code X-Forwarded-For}.
 *
 * <p>X-Forwarded-For is client-supplied until a trusted hop appends the peer address
 * to it, so the leftmost entry is spoofable: rotating it would hand every request a
 * fresh rate-limit budget. Read the list right to left instead - skipping the hops our
 * own infrastructure appended (the trusted proxies) - and use the first address that is
 * not a trusted proxy. The trusted list must only contain proxies; a CIDR that also
 * covers real clients would let those clients spoof the entry we stop at.
 *
 * <p>Only IP literals are ever returned: hostnames and garbage are skipped, so callers
 * can convert the result without triggering a blocking DNS lookup on request-supplied
 * input.
 */
public class ClientIpResolver {
    /**
     * Comma-separated list of trusted proxy IPs or CIDRs whose
     * X-Forwarded-For header is accepted, e.g.
     * 10.0.0.0/8,172.16.0.0/12. Empty by default (no trusted proxies).
     */
    @Value("${app.rate-limit.trusted-proxies:}")
    private String trustedProxiesRaw;

    private List<IpAddressMatcher> trustedProxyMatchers = List.of();

    @PostConstruct
    void initTrustedProxies() {
        if (trustedProxiesRaw == null || trustedProxiesRaw.isBlank()) {
            trustedProxyMatchers = List.of();
            return;
        }
        trustedProxyMatchers = Arrays.stream(trustedProxiesRaw.split(","))
                .map(String::trim)
                .filter(s -> !s.isBlank())
                .map(IpAddressMatcher::new)
                .collect(Collectors.toList());
    }

    /** The client address, or an empty string when no IP literal can be determined. */
    public String resolve(HttpServletRequest request) {
        String remoteAddr = normalizeIp(request.getRemoteAddr());
        String forwarded = request.getHeader("X-Forwarded-For");
        if (forwarded == null || forwarded.isBlank() || !isTrustedProxy(request.getRemoteAddr())) {
            return isIpLiteral(remoteAddr) ? remoteAddr : "";
        }

        String[] hops = forwarded.split(",");
        for (int i = hops.length - 1; i >= 0; i--) {
            String candidate = normalizeIp(hops[i].trim());
            // A garbage hop must not become the bucket key (or be forwarded):
            // skip anything that is not an IP literal and fall back to the peer.
            if (!candidate.isEmpty() && isIpLiteral(candidate) && !isTrustedProxy(candidate)) {
                return candidate;
            }
        }
        // Every hop was a trusted proxy (or the header was empty): key on the peer.
        return isIpLiteral(remoteAddr) ? remoteAddr : "";
    }

    /**
     * The rate-limit bucket for a resolved address. IPv6 clients control a whole /64,
     * so keying on the full address would hand one subscriber a fresh bucket per
     * address it rotates through; truncate IPv6 to its /64 network. IPv4 keys stay
     * per-address (a single host).
     */
    static String bucketKey(String ip) {
        if (ip == null || ip.isEmpty() || !ip.contains(":")) {
            return ip == null ? "" : ip;
        }
        // A zone id identifies a local interface, not the network; drop it before parsing.
        int zone = ip.indexOf('%');
        String literal = zone >= 0 ? ip.substring(0, zone) : ip;
        try {
            byte[] address = InetAddress.getByName(literal).getAddress();
            if (address.length == 16) {
                Arrays.fill(address, 8, 16, (byte) 0);
            }
            return InetAddress.getByAddress(address).getHostAddress();
        } catch (UnknownHostException ex) {
            // resolve() only yields literals; keep a malformed value as its own bucket
            // rather than merging unrelated clients into one.
            return ip;
        }
    }

    static String normalizeIp(String ip) {
        if (ip == null) {
            return "";
        }
        String trimmed = ip.trim();
        if (trimmed.regionMatches(true, 0, "::ffff:", 0, 7)) {
            return trimmed.substring(7);
        }
        return trimmed;
    }

    private boolean isTrustedProxy(String remoteAddr) {
        String normalized = normalizeIp(remoteAddr);
        return trustedProxyMatchers.stream().anyMatch(m -> m.matches(remoteAddr) || m.matches(normalized));
    }

    /**
     * True for IPv4 dotted quads and IPv6 literals (which always contain a colon).
     * Hostnames and garbage never come from a proxy's appended peer address, so
     * they are skipped rather than keying a rate-limit bucket. Colon alone is
     * not enough: garbage like "abc:def" must not become a bucket key.
     */
    private static boolean isIpLiteral(String candidate) {
        if (candidate.contains(":")) {
            // IPv6 hex digits, colons, dots (IPv4-mapped) and zone ids only.
            for (int i = 0; i < candidate.length(); i++) {
                char c = candidate.charAt(i);
                if (c == ':' || c == '.' || c == '%') {
                    continue;
                }
                if (Character.digit(c, 16) == -1) {
                    return false;
                }
            }
            return true;
        }
        String[] octets = candidate.split("\\.", -1);
        if (octets.length != 4) {
            return false;
        }
        for (String octet : octets) {
            if (octet.isEmpty() || octet.length() > 3) {
                return false;
            }
            for (int i = 0; i < octet.length(); i++) {
                if (!Character.isDigit(octet.charAt(i))) {
                    return false;
                }
            }
            if (Integer.parseInt(octet) > 255) {
                return false;
            }
        }
        return true;
    }

    static String maskIp(String rawIp) {
        String ip = normalizeIp(rawIp);
        if (ip.isBlank()) {
            return "unknown";
        }
        // IPv4: mask last octet (e.g. 192.168.1.100 → 192.168.1.xxx)
        int lastDot = ip.lastIndexOf('.');
        if (lastDot != -1 && !ip.contains(":")) {
            return ip.substring(0, lastDot) + ".xxx";
        }
        // IPv6: mask last segment (e.g. 2001:db8::1 → 2001:db8::xxxx)
        int lastColon = ip.lastIndexOf(':');
        if (lastColon != -1) {
            return ip.substring(0, lastColon + 1) + "xxxx";
        }
        return "unknown";
    }
}
