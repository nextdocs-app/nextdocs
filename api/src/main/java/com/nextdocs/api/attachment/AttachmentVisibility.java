package com.nextdocs.api.attachment;

/**
 * Who may read an attachment, independent of who owns it.
 *
 * <p>Document attachments derive visibility from the document and are always
 * {@link #PRIVATE} here. Workspace attachments are uploaded private and become
 * {@link #PUBLIC} only when the workspace icon adopts them, because the icon is
 * instance branding shown on public share pages.
 */
public enum AttachmentVisibility {
    PRIVATE,
    PUBLIC
}
