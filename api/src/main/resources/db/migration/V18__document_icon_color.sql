-- Icon color support for builtin page icons.
--
-- The value is a palette key, not a hex color, so the frontend can remap it per
-- theme; NULL means the default color, and the applier normalizes the literal
-- "default" to NULL before the row is written.
--
-- The palette key list is duplicated on purpose: adding a color is a schema
-- change here and an enum change in DocumentIconCoverApplier, and
-- DocumentIconColorPaletteTest fails when the two drift.
--
-- The icon_type coupling is what stops a color outliving the builtin icon it
-- belongs to. IS NOT DISTINCT FROM rather than = matters for the icon-less row:
-- with a plain equality, icon_type IS NULL makes the comparison NULL, and a
-- CHECK treats NULL as passing, so a color would land on a document with no icon.
ALTER TABLE documents ADD COLUMN icon_color VARCHAR(32);

ALTER TABLE documents ADD CONSTRAINT chk_documents_icon_color
    CHECK (icon_color IS NULL
           OR (icon_type IS NOT DISTINCT FROM 'BUILTIN'
               AND icon_color IN ('gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red')));
