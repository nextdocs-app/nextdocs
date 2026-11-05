-- The canonical access_grants store replaced document_collaborators in V31, and
-- V35 moved the last runtime readers to it. The compatibility alias has no
-- callers, so remove both rather than leaving a second source of truth.
DROP FUNCTION IF EXISTS has_positive_ancestor_grant(UUID, UUID);
DROP TABLE IF EXISTS document_collaborators;
