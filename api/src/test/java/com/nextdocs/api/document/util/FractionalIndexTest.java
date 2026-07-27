package com.nextdocs.api.document.util;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class FractionalIndexTest {

    @Test
    void initialKey_returnsA0() {
        assertEquals("a0", FractionalIndex.keyBetween(null, null));
    }

    @Test
    void keyAfterEnd() {
        String key = FractionalIndex.keyBetween("a0", null);
        assertTrue(key.compareTo("a0") > 0);
    }

    @Test
    void keyBeforeStart() {
        String key = FractionalIndex.keyBetween(null, "a0");
        assertTrue(key.compareTo("a0") < 0);
    }

    @Test
    void keyBetweenTwoKeys() {
        String key = FractionalIndex.keyBetween("a0", "a1");
        assertTrue(key.compareTo("a0") > 0);
        assertTrue(key.compareTo("a1") < 0);
    }

    @Test
    void repeatedInsertAtSameGap_noCollision() {
        String prev = "a0";
        String next = "a1";
        for (int i = 0; i < 1000; i++) {
            String key = FractionalIndex.keyBetween(prev, next);
            assertNotNull(key);
            assertTrue(key.compareTo(prev) > 0);
            assertTrue(key.compareTo(next) < 0);
            prev = key;
        }
    }

    @Test
    void repeatedInsertAtSameGap_keyLengthGrowsSlowly() {
        String prev = "a0";
        String next = "a1";
        int maxLength = 0;
        for (int i = 0; i < 1000; i++) {
            String key = FractionalIndex.keyBetween(prev, next);
            assertTrue(key.compareTo(prev) > 0, "Key must be greater than prev");
            assertTrue(key.compareTo(next) < 0, "Key must be less than next");
            maxLength = Math.max(maxLength, key.length());
            prev = key;
        }
        assertTrue(maxLength < 300, "Max key length after 1000 inserts: " + maxLength);
    }

    @Test
    void nKeysBetween_generatesCorrectCount() {
        String[] keys = FractionalIndex.nKeysBetween("a0", "a5", 3);
        assertEquals(3, keys.length);
        for (String key : keys) {
            assertTrue(key.compareTo("a0") > 0);
            assertTrue(key.compareTo("a5") < 0);
        }
        assertTrue(keys[0].compareTo(keys[1]) < 0);
        assertTrue(keys[1].compareTo(keys[2]) < 0);
    }

    @Test
    void nKeysBetweenSpaced_leavesGapsBetweenKeys() {
        String[] keys = FractionalIndex.nKeysBetweenSpaced(null, null, 4, 8);
        assertEquals(4, keys.length);
        for (int i = 0; i < keys.length - 1; i++) {
            assertTrue(keys[i].compareTo(keys[i + 1]) < 0);
        }
        String[] packed = FractionalIndex.nKeysBetween(null, null, 4);
        assertTrue(packed[1].compareTo(keys[1]) < 0, "spaced keys must be farther apart than packed keys");
    }

    @Test
    void nKeysBetweenSpaced_frontInsertAfterReindex_landsInGap() {
        String[] keys = FractionalIndex.nKeysBetweenSpaced(null, null, 3, 8);
        String insert = FractionalIndex.keyBetween(null, keys[1]);
        assertTrue(insert.compareTo(keys[0]) > 0, "insert must land after the first reindexed key");
        assertTrue(insert.compareTo(keys[1]) < 0, "insert must land before the reindexed neighbor");
    }

    @Test
    void nKeysBetweenSpaced_emptyRequest_returnsNoKeys() {
        assertEquals(0, FractionalIndex.nKeysBetweenSpaced(null, null, 0, 8).length);
    }

    @Test
    void nKeysBetweenSpaced_invalidGap_throwsException() {
        assertThrows(IllegalArgumentException.class, () -> FractionalIndex.nKeysBetweenSpaced(null, null, 3, 0));
    }

    @Test
    void invalidInput_reversedOrder_throwsException() {
        assertThrows(IllegalArgumentException.class, () -> FractionalIndex.keyBetween("a1", "a0"));
    }

    @Test
    void invalidInput_sameKeys_throwsException() {
        assertThrows(IllegalArgumentException.class, () -> FractionalIndex.keyBetween("a0", "a0"));
    }

    @Test
    void invalidInput_corruptedKey_throwsException() {
        assertThrows(IllegalArgumentException.class, () -> FractionalIndex.keyBetween("2026-07-27", "a0"));
        assertThrows(IllegalArgumentException.class, () -> FractionalIndex.keyBetween("a0", "a00"));
    }
}
