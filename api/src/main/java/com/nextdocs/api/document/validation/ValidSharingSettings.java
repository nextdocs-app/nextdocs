package com.nextdocs.api.document.validation;

import jakarta.validation.Constraint;
import jakarta.validation.Payload;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Constraint(validatedBy = SharingSettingsValidator.class)
@Documented
public @interface ValidSharingSettings {

    String message() default "Invalid sharing settings combination.";

    Class<?>[] groups() default {};

    Class<? extends Payload>[] payload() default {};
}
