-- Page icon and cover metadata for documents.
--
-- icon_type is NULL for no icon, otherwise one of EMOJI, BUILTIN, UPLOAD, LINK.
-- icon_value holds the emoji grapheme, the builtin slug, the attachment id, or the URL.
-- cover_type is NULL for no cover, otherwise one of UPLOAD, LINK.
-- cover_value holds the attachment id or the URL; cover_position is the vertical
-- focal offset in [0, 1] and is only meaningful while a cover is set.
ALTER TABLE documents ADD COLUMN icon_type VARCHAR(16);
ALTER TABLE documents ADD COLUMN icon_value VARCHAR(2048);
ALTER TABLE documents ADD COLUMN cover_type VARCHAR(16);
ALTER TABLE documents ADD COLUMN cover_value VARCHAR(2048);
ALTER TABLE documents ADD COLUMN cover_position DOUBLE PRECISION;

ALTER TABLE documents ADD CONSTRAINT chk_documents_icon_type
    CHECK (icon_type IS NULL OR icon_type IN ('EMOJI', 'BUILTIN', 'UPLOAD', 'LINK'));
ALTER TABLE documents ADD CONSTRAINT chk_documents_icon_value
    CHECK ((icon_type IS NULL AND icon_value IS NULL) OR (icon_type IS NOT NULL AND icon_value IS NOT NULL));
ALTER TABLE documents ADD CONSTRAINT chk_documents_cover_type
    CHECK (cover_type IS NULL OR cover_type IN ('UPLOAD', 'LINK'));
ALTER TABLE documents ADD CONSTRAINT chk_documents_cover_value
    CHECK ((cover_type IS NULL AND cover_value IS NULL) OR (cover_type IS NOT NULL AND cover_value IS NOT NULL));
ALTER TABLE documents ADD CONSTRAINT chk_documents_cover_position
    CHECK (cover_position IS NULL OR (cover_position >= 0 AND cover_position <= 1));
ALTER TABLE documents ADD CONSTRAINT chk_documents_cover_position_requires_cover
    CHECK (cover_type IS NOT NULL OR cover_position IS NULL);


