package com.nextdocs.api.document.validation;

import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import com.nextdocs.api.document.entity.DocumentWorkspaceAccessMode;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;
import java.time.OffsetDateTime;

public class SharingSettingsValidator
        implements ConstraintValidator<ValidSharingSettings, SharingSettingsUpdateRequest> {

    private static final String REQUIRED_FOR_ANYONE_MSG =
            "linkAccessLevel is required when generalAccessMode is ANYONE_WITH_LINK.";

    private static final String MUST_BE_OMITTED_MSG =
            "linkAccessLevel must be omitted unless generalAccessMode is ANYONE_WITH_LINK.";

    private static final String BLOCKED_WITH_LINK_MSG =
            "linkInheritBlocked must be omitted or false when generalAccessMode is ANYONE_WITH_LINK.";

    private static final String EXPIRY_WITHOUT_LINK_MSG =
            "linkExpiresAt is only valid when generalAccessMode is ANYONE_WITH_LINK.";

    private static final String EXPIRY_IN_PAST_MSG = "linkExpiresAt must be in the future.";

    private static final String WORKSPACE_LEVEL_REQUIRED_MSG =
            "workspaceAccessLevel is required when workspaceAccessMode is WORKSPACE_MEMBERS.";

    private static final String WORKSPACE_LEVEL_OMITTED_MSG =
            "workspaceAccessLevel must be omitted unless workspaceAccessMode is WORKSPACE_MEMBERS.";

    private static final String WORKSPACE_BLOCKED_WITH_ACCESS_MSG =
            "workspaceInheritBlocked must be omitted or false when workspaceAccessMode is WORKSPACE_MEMBERS.";

    private static final String WORKSPACE_LEVEL_INVALID_MSG = "workspaceAccessLevel must be VIEW, COMMENT, or EDIT.";

    @Override
    public boolean isValid(SharingSettingsUpdateRequest request, ConstraintValidatorContext context) {
        if (request == null) {
            return true;
        }

        if (!validateLink(request, context)) {
            return false;
        }
        return validateWorkspace(request, context);
    }

    private boolean validateLink(SharingSettingsUpdateRequest request, ConstraintValidatorContext context) {
        DocumentGeneralAccessMode mode = request.generalAccessMode();
        boolean isAnyoneWithLink = mode == DocumentGeneralAccessMode.ANYONE_WITH_LINK;
        boolean hasLinkAccessLevel = request.linkAccessLevel() != null;
        boolean hasExpiry = request.linkExpiresAt() != null;
        boolean clearExpiry = Boolean.TRUE.equals(request.clearLinkExpiresAt());

        if (clearExpiry && hasExpiry) {
            return fail(context, "linkExpiresAt and clearLinkExpiresAt cannot be used together.", "clearLinkExpiresAt");
        }
        if (clearExpiry && mode == DocumentGeneralAccessMode.RESTRICTED) {
            return fail(context, "clearLinkExpiresAt is only valid with ANYONE_WITH_LINK.", "clearLinkExpiresAt");
        }

        if (isAnyoneWithLink && !hasLinkAccessLevel) {
            return fail(context, REQUIRED_FOR_ANYONE_MSG, "linkAccessLevel");
        }
        if (mode == DocumentGeneralAccessMode.RESTRICTED && hasLinkAccessLevel) {
            return fail(context, MUST_BE_OMITTED_MSG, "linkAccessLevel");
        }

        // A block is only meaningful on a RESTRICTED document: an own link
        // always wins by closest-ancestor-wins, so combining the two would
        // store dead state. The service auto-clears the flag when a link is
        // created; the validator rejects explicitly contradictory payloads.
        if (isAnyoneWithLink && Boolean.TRUE.equals(request.linkInheritBlocked())) {
            return fail(context, BLOCKED_WITH_LINK_MSG, "linkInheritBlocked");
        }

        if (mode == DocumentGeneralAccessMode.RESTRICTED && hasExpiry) {
            return fail(context, EXPIRY_WITHOUT_LINK_MSG, "linkExpiresAt");
        }
        if (hasExpiry && !request.linkExpiresAt().isAfter(OffsetDateTime.now())) {
            return fail(context, EXPIRY_IN_PAST_MSG, "linkExpiresAt");
        }
        return true;
    }

    private boolean validateWorkspace(SharingSettingsUpdateRequest request, ConstraintValidatorContext context) {
        DocumentWorkspaceAccessMode mode = request.workspaceAccessMode();
        boolean workspaceMembers = mode == DocumentWorkspaceAccessMode.WORKSPACE_MEMBERS;
        DocumentAccessLevel level = request.workspaceAccessLevel();

        if (workspaceMembers && level == null) {
            return fail(context, WORKSPACE_LEVEL_REQUIRED_MSG, "workspaceAccessLevel");
        }
        if (mode == DocumentWorkspaceAccessMode.RESTRICTED && level != null) {
            return fail(context, WORKSPACE_LEVEL_OMITTED_MSG, "workspaceAccessLevel");
        }
        if (workspaceMembers && Boolean.TRUE.equals(request.workspaceInheritBlocked())) {
            return fail(context, WORKSPACE_BLOCKED_WITH_ACCESS_MSG, "workspaceInheritBlocked");
        }
        if (level != null && (level == DocumentAccessLevel.OWNER || level == DocumentAccessLevel.NO_ACCESS)) {
            return fail(context, WORKSPACE_LEVEL_INVALID_MSG, "workspaceAccessLevel");
        }
        return true;
    }

    private static boolean fail(ConstraintValidatorContext context, String message, String property) {
        context.disableDefaultConstraintViolation();
        context.buildConstraintViolationWithTemplate(message)
                .addPropertyNode(property)
                .addConstraintViolation();
        return false;
    }
}
