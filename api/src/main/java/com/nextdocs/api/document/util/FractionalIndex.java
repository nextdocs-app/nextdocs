package com.nextdocs.api.document.util;

public final class FractionalIndex {

    private FractionalIndex() {}

    private static final String DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    private static final String INT_DIGITS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

    public static String keyBetween(String a, String b) {
        return generateKeyBetween(a, b, DIGITS, INT_DIGITS);
    }

    public static boolean isValidOrderKey(String key) {
        if (key == null || key.isEmpty()) {
            return false;
        }
        try {
            validateOrderKey(key, DIGITS, INT_DIGITS);
            return true;
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    public static String[] nKeysBetween(String a, String b, int n) {
        return generateNKeysBetween(a, b, n, DIGITS, INT_DIGITS);
    }

    public static String[] nKeysBetweenSpaced(String a, String b, int n, int gap) {
        if (n == 0) {
            return new String[0];
        }
        if (gap < 1) {
            throw new IllegalArgumentException("gap must be >= 1");
        }
        String[] keys = new String[n];
        String current = generateKeyBetween(a, b, DIGITS, INT_DIGITS);
        keys[0] = current;
        for (int i = 1; i < n; i++) {
            for (int g = 0; g < gap; g++) {
                current = generateKeyBetween(current, b, DIGITS, INT_DIGITS);
            }
            keys[i] = current;
        }
        return keys;
    }

    private static String generateKeyBetween(String a, String b, String digits, String intDigits) {
        if (a != null) {
            validateOrderKey(a, digits, intDigits);
        }
        if (b != null) {
            validateOrderKey(b, digits, intDigits);
        }
        if (a != null && b != null) {
            if (a.compareTo(b) >= 0) {
                throw new IllegalArgumentException("a must be less than b: " + a + " >= " + b);
            }
        }

        if (a == null) {
            if (b == null) {
                String head = String.valueOf(intDigits.charAt(intDigits.length() / 2));
                return head + digits.charAt(0);
            }
            String ib = getIntegerPart(b, intDigits);
            String fb = b.substring(ib.length());
            if (isSmallestInteger(ib, digits, intDigits)) {
                return ib + midpoint("", fb, digits);
            }
            if (ib.compareTo(b) < 0) {
                return ib;
            }
            String res = decrementInteger(ib, digits, intDigits);
            if (res == null) {
                throw new IllegalArgumentException("cannot decrement any more");
            }
            return res;
        }

        if (b == null) {
            String ia = getIntegerPart(a, intDigits);
            String fa = a.substring(ia.length());
            String i = incrementInteger(ia, digits, intDigits);
            if (i == null) {
                return ia + midpoint(fa, null, digits);
            }
            return i;
        }

        String ia = getIntegerPart(a, intDigits);
        String fa = a.substring(ia.length());
        String ib = getIntegerPart(b, intDigits);
        String fb = b.substring(ib.length());
        if (ia.equals(ib)) {
            return ia + midpoint(fa, fb, digits);
        }
        String i = incrementInteger(ia, digits, intDigits);
        if (i == null) {
            throw new IllegalArgumentException("cannot increment any more");
        }
        if (i.compareTo(b) < 0) {
            return i;
        }
        return ia + midpoint(fa, null, digits);
    }

    private static String[] generateNKeysBetween(String a, String b, int n, String digits, String intDigits) {
        if (n == 0) {
            return new String[0];
        }
        if (n == 1) {
            return new String[] {generateKeyBetween(a, b, digits, intDigits)};
        }
        if (b == null) {
            String c = generateKeyBetween(a, b, digits, intDigits);
            String[] result = new String[n];
            result[0] = c;
            for (int i = 1; i < n; i++) {
                c = generateKeyBetween(c, b, digits, intDigits);
                result[i] = c;
            }
            return result;
        }
        if (a == null) {
            String c = generateKeyBetween(a, b, digits, intDigits);
            String[] result = new String[n];
            result[n - 1] = c;
            for (int i = n - 2; i >= 0; i--) {
                c = generateKeyBetween(a, c, digits, intDigits);
                result[i] = c;
            }
            return result;
        }
        int mid = n / 2;
        String c = generateKeyBetween(a, b, digits, intDigits);
        String[] left = generateNKeysBetween(a, c, mid, digits, intDigits);
        String[] right = generateNKeysBetween(c, b, n - mid - 1, digits, intDigits);
        String[] result = new String[n];
        System.arraycopy(left, 0, result, 0, left.length);
        result[left.length] = c;
        System.arraycopy(right, 0, result, left.length + 1, right.length);
        return result;
    }

    private static String midpoint(String a, String b, String digits) {
        char zero = digits.charAt(0);
        if (b != null && a.compareTo(b) >= 0) {
            throw new IllegalArgumentException(a + " >= " + b);
        }
        if ((a.length() > 0 && a.charAt(a.length() - 1) == zero)
                || (b != null && b.length() > 0 && b.charAt(b.length() - 1) == zero)) {
            throw new IllegalArgumentException("trailing zero");
        }
        if (b != null) {
            int n = 0;
            while (charOrZero(a, n, zero) == charAtOrNull(b, n)) {
                n++;
            }
            if (n > 0) {
                return b.substring(0, n) + midpoint(a.substring(n), b.substring(n), digits);
            }
        }
        int digitA = a.length() > 0 ? digits.indexOf(a.charAt(0)) : 0;
        int digitB = b != null ? digits.indexOf(b.charAt(0)) : digits.length();
        if (digitB - digitA > 1) {
            int midDigit = (int) Math.round(0.5 * (digitA + digitB));
            return String.valueOf(digits.charAt(midDigit));
        } else {
            if (b != null && b.length() > 1) {
                return b.substring(0, 1);
            } else {
                return digits.charAt(digitA) + midpoint(a.length() > 1 ? a.substring(1) : "", null, digits);
            }
        }
    }

    private static char charOrZero(String s, int index, char zero) {
        return index < s.length() ? s.charAt(index) : zero;
    }

    private static Character charAtOrNull(String s, int index) {
        return index < s.length() ? s.charAt(index) : null;
    }

    private static int getIntegerLength(String head, String intDigits) {
        int i = intDigits.indexOf(head.charAt(0));
        if (i == -1 || intDigits.charAt(i) != head.charAt(0)) {
            throw new IllegalArgumentException("invalid order key head: " + head);
        }
        int half = intDigits.length() / 2;
        return i < half ? half - i + 1 : i - half + 2;
    }

    private static String getIntegerPart(String key, String intDigits) {
        int integerPartLength = getIntegerLength(key.substring(0, 1), intDigits);
        if (integerPartLength > key.length()) {
            throw new IllegalArgumentException("invalid order key: " + key);
        }
        return key.substring(0, integerPartLength);
    }

    private static boolean isSmallestInteger(String key, String digits, String intDigits) {
        String smallest = intDigits.charAt(0) + String.valueOf(digits.charAt(0)).repeat(intDigits.length() / 2);
        return key.equals(smallest);
    }

    private static void validateOrderKey(String key, String digits, String intDigits) {
        if (isSmallestInteger(key, digits, intDigits)) {
            throw new IllegalArgumentException("invalid order key: " + key);
        }
        String i = getIntegerPart(key, intDigits);
        String f = key.substring(i.length());
        if (f.length() > 0 && f.charAt(f.length() - 1) == digits.charAt(0)) {
            throw new IllegalArgumentException("invalid order key: " + key);
        }
    }

    private static void validateInteger(String x, String intDigits) {
        int expectedLength = getIntegerLength(x.substring(0, 1), intDigits);
        if (x.length() != expectedLength) {
            throw new IllegalArgumentException("invalid integer part of order key: " + x);
        }
    }

    private static String incrementInteger(String x, String digits, String intDigits) {
        validateInteger(x, intDigits);
        String head = x.substring(0, 1);
        char zero = digits.charAt(0);
        StringBuilder trailing = new StringBuilder();
        for (int i = x.length() - 1; i >= 1; i--) {
            int d = digits.indexOf(x.charAt(i)) + 1;
            if (d == digits.length()) {
                trailing.append(zero);
            } else {
                return head + x.substring(1, i) + digits.charAt(d) + trailing;
            }
        }
        int headIndex = intDigits.indexOf(head.charAt(0));
        if (headIndex == intDigits.length() - 1) {
            return null;
        }
        String h = String.valueOf(intDigits.charAt(headIndex + 1));
        int lengthDelta = getIntegerLength(h, intDigits) - getIntegerLength(head, intDigits);
        return h
                + (lengthDelta > 0
                        ? trailing + String.valueOf(zero)
                        : lengthDelta < 0 ? trailing.substring(1) : trailing.toString());
    }

    private static String decrementInteger(String x, String digits, String intDigits) {
        validateInteger(x, intDigits);
        String head = x.substring(0, 1);
        char last = digits.charAt(digits.length() - 1);
        StringBuilder trailing = new StringBuilder();
        for (int i = x.length() - 1; i >= 1; i--) {
            int d = digits.indexOf(x.charAt(i)) - 1;
            if (d == -1) {
                trailing.append(last);
            } else {
                return head + x.substring(1, i) + digits.charAt(d) + trailing;
            }
        }
        int headIndex = intDigits.indexOf(head.charAt(0));
        if (headIndex == 0) {
            return null;
        }
        String h = String.valueOf(intDigits.charAt(headIndex - 1));
        int lengthDelta = getIntegerLength(h, intDigits) - getIntegerLength(head, intDigits);
        return h
                + (lengthDelta > 0
                        ? trailing + String.valueOf(last)
                        : lengthDelta < 0 ? trailing.substring(1) : trailing.toString());
    }
}
