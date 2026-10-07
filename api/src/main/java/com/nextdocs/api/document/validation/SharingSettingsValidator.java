package com.nextdocs.api.document.validation;

import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import jakarta.validation.ConstraintValidator;
import jakarta.validation.ConstraintValidatorContext;

public class SharingSettingsValidator
        implements ConstraintValidator<ValidSharingSettings, SharingSettingsUpdateRequest> {

    private static final String REQUIRED_FOR_ANYONE_MSG =
            "linkAccessLevel is required when generalAccessMode is ANYONE_WITH_LINK.";

    private static final String MUST_BE_OMITTED_MSG =
            "linkAccessLevel must be omitted unless generalAccessMode is ANYONE_WITH_LINK.";

    private static final String BLOCKED_WITH_LINK_MSG =
            "linkInheritBlocked must be omitted or false when generalAccessMode is ANYONE_WITH_LINK.";

    @Override
    public boolean isValid(SharingSettingsUpdateRequest request, ConstraintValidatorContext context) {
        if (request == null) {
            return true;
        }

        DocumentGeneralAccessMode mode = request.generalAccessMode();
        boolean isAnyoneWithLink = mode == DocumentGeneralAccessMode.ANYONE_WITH_LINK;
        boolean hasLinkAccessLevel = request.linkAccessLevel() != null;

        if (isAnyoneWithLink && !hasLinkAccessLevel) {
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(REQUIRED_FOR_ANYONE_MSG)
                    .addPropertyNode("linkAccessLevel")
                    .addConstraintViolation();
            return false;
        }

        if (!isAnyoneWithLink && hasLinkAccessLevel) {
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(MUST_BE_OMITTED_MSG)
                    .addPropertyNode("linkAccessLevel")
                    .addConstraintViolation();
            return false;
        }

        // A block is only meaningful on a RESTRICTED document: an own link
        // always wins by closest-ancestor-wins, so combining the two would
        // store dead state. The service auto-clears the flag when a link is
        // created; the validator rejects explicitly contradictory payloads.
        if (isAnyoneWithLink && Boolean.TRUE.equals(request.linkInheritBlocked())) {
            context.disableDefaultConstraintViolation();
            context.buildConstraintViolationWithTemplate(BLOCKED_WITH_LINK_MSG)
                    .addPropertyNode("linkInheritBlocked")
                    .addConstraintViolation();
            return false;
        }

        return true;
    }
}
