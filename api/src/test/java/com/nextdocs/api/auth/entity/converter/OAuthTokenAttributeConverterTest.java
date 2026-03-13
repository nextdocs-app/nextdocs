package com.nextdocs.api.auth.entity.converter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import jakarta.persistence.PersistenceException;
import java.util.Base64;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

class OAuthTokenAttributeConverterTest {

    private static final String KEY_PROPERTY = "oauth.token.encryption.key-base64";

    @AfterEach
    void tearDown() {
        System.clearProperty(KEY_PROPERTY);
    }

    @Test
    void encryptAndDecrypt_roundTripsPlainText() {
        System.setProperty(
                KEY_PROPERTY, Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes()));
        OAuthTokenAttributeConverter converter = new OAuthTokenAttributeConverter();

        String encrypted = converter.convertToDatabaseColumn("oauth-access-token-value");
        String decrypted = converter.convertToEntityAttribute(encrypted);

        assertThat(encrypted).startsWith("v1:");
        assertThat(encrypted).isNotEqualTo("oauth-access-token-value");
        assertThat(decrypted).isEqualTo("oauth-access-token-value");
    }

    @Test
    void convertMethods_whenNullValue_returnNull() {
        System.setProperty(
                KEY_PROPERTY, Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes()));
        OAuthTokenAttributeConverter converter = new OAuthTokenAttributeConverter();

        assertThat(converter.convertToDatabaseColumn(null)).isNull();
        assertThat(converter.convertToEntityAttribute(null)).isNull();
    }

    @Test
    void constructor_whenKeyMissing_throwsPersistenceException() {
        // Key is resolved at construction time — no key means immediate failure (fail-fast).
        assertThatThrownBy(OAuthTokenAttributeConverter::new)
                .isInstanceOf(PersistenceException.class)
                .hasMessageContaining("not configured");
    }

    @Test
    void convertToEntityAttribute_whenCiphertextTampered_throwsPersistenceException() {
        System.setProperty(
                KEY_PROPERTY, Base64.getEncoder().encodeToString("0123456789abcdef0123456789abcdef".getBytes()));
        OAuthTokenAttributeConverter converter = new OAuthTokenAttributeConverter();

        String encrypted = converter.convertToDatabaseColumn("token");
        char lastChar = encrypted.charAt(encrypted.length() - 1);
        char replacement = (lastChar == 'A') ? 'B' : 'A';
        String tampered = encrypted.substring(0, encrypted.length() - 1) + replacement;

        assertThatThrownBy(() -> converter.convertToEntityAttribute(tampered))
                .isInstanceOf(PersistenceException.class)
                .hasMessageContaining("decrypt");
    }
}
