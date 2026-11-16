-- Fractional index keys are ASCII strings, and every Java comparison of them
-- (FractionalIndex.keyBetween, OrderInterval, the sort in SharedSectionService.list)
-- is a String.compareTo. SQL MIN/MAX and ORDER BY on the same columns used the
-- database's default collation instead, so on a libc locale such as en_US.UTF-8 the
-- two disagree: 'a0' sorts before 'Zz' in SQL but after it in Java.
--
-- The disagreement is a 500, not a cosmetic sort. A key placed before "a0" is "Zz",
-- so the SQL predecessor of "Zz" is "a0" while Java says "Zz" is already the
-- smallest. The next move then asks for a key between ("a0", "Zz") and keyBetween
-- rejects an inverted interval.
--
-- "C" is byte order, which is what String.compareTo means. The ALTER rewrites each
-- table and rebuilds its indexes, so index ordering and the unique constraints move
-- with the data. That takes an ACCESS EXCLUSIVE lock per table for the length of the
-- rewrite: these tables hold row metadata, not content, so it is a short one.

ALTER TABLE user_shared_document_orders ALTER COLUMN order_key TYPE TEXT COLLATE "C";
ALTER TABLE user_document_orders ALTER COLUMN order_key TYPE TEXT COLLATE "C";
ALTER TABLE user_space_orders ALTER COLUMN order_key TYPE TEXT COLLATE "C";
ALTER TABLE documents ALTER COLUMN sibling_order_key TYPE TEXT COLLATE "C";
