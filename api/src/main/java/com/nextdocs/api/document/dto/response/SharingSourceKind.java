package com.nextdocs.api.document.dto.response;

/**
 * What supplies an inherited general-access setting.
 *
 * <p>The workspace audience of a page is either its own setting, an ancestor page's, or
 * the everyone level of the space that anchors the tree. The panel names the source, so
 * it has to know which of the two kinds it is pointing at: a page opens in the editor, a
 * space opens its settings. There is no value for the link channel, which never inherits
 * from a space.
 */
public enum SharingSourceKind {
    /** An ancestor page the reader inherits the setting from. */
    PAGE,
    /** The space anchoring the page's tree. */
    SPACE
}
