package com.nextdocs.api.document.validation;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.nextdocs.api.document.dto.request.SharingSettingsUpdateRequest;
import com.nextdocs.api.document.entity.DocumentAccessLevel;
import com.nextdocs.api.document.entity.DocumentGeneralAccessMode;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class SharingSettingsValidatorTest {

    private Validator validator;

    @BeforeEach
    void setUp() {
        validator = Validation.buildDefaultValidatorFactory().getValidator();
    }

    @Test
    void isValid_returnsTrue_forNullRequest() {
        SharingSettingsValidator validatorInstance = new SharingSettingsValidator();
        assertTrue(validatorInstance.isValid(null, null));
    }

    @Test
    void validate_returnsViolation_whenAnyoneWithLinkWithoutLinkAccessLevel() {
        SharingSettingsUpdateRequest request =
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.ANYONE_WITH_LINK, null);

        Set<ConstraintViolation<SharingSettingsUpdateRequest>> violations = validator.validate(request);

        assertFalse(violations.isEmpty());
        assertTrue(violations.stream()
                .anyMatch(v -> "linkAccessLevel".equals(v.getPropertyPath().toString())));
    }

    @Test
    void validate_returnsViolation_whenRestrictedWithLinkAccessLevel() {
        SharingSettingsUpdateRequest request =
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.RESTRICTED, DocumentAccessLevel.VIEW);

        Set<ConstraintViolation<SharingSettingsUpdateRequest>> violations = validator.validate(request);

        assertFalse(violations.isEmpty());
        assertTrue(violations.stream()
                .anyMatch(v -> "linkAccessLevel".equals(v.getPropertyPath().toString())));
    }

    @Test
    void validate_passes_whenAnyoneWithLinkWithLinkAccessLevel() {
        SharingSettingsUpdateRequest request =
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.ANYONE_WITH_LINK, DocumentAccessLevel.EDIT);

        Set<ConstraintViolation<SharingSettingsUpdateRequest>> violations = validator.validate(request);

        assertTrue(violations.isEmpty());
    }

    @Test
    void validate_passes_whenRestrictedWithoutLinkAccessLevel() {
        SharingSettingsUpdateRequest request =
                new SharingSettingsUpdateRequest(DocumentGeneralAccessMode.RESTRICTED, null);

        Set<ConstraintViolation<SharingSettingsUpdateRequest>> violations = validator.validate(request);

        assertTrue(violations.isEmpty());
    }
}
