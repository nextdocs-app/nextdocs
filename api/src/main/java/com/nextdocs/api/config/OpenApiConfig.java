package com.nextdocs.api.config;

import io.swagger.v3.oas.annotations.enums.SecuritySchemeType;
import io.swagger.v3.oas.annotations.security.SecurityScheme;
import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.servers.Server;
import java.util.List;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
@SecurityScheme(
        name = "bearerAuth",
        type = SecuritySchemeType.HTTP,
        scheme = "bearer",
        bearerFormat = "JWT",
        description = "Provide the JWT access token obtained from /api/v1/auth/login or /register.")
public class OpenApiConfig {

    @Bean
    public OpenAPI nextDocsOpenApi() {
        return new OpenAPI()
                .info(new Info()
                        .title("NextDocs API")
                        .description("REST API for NextDocs — an open-source block-based document editor. "
                                + "Authenticate via POST /api/v1/auth/login to obtain a Bearer token.")
                        .version("v1")
                        .contact(new Contact().name("NextDocs").url("https://github.com/santhoshh-kumar/nextdocs"))
                        .license(new License().name("MIT").url("https://opensource.org/licenses/MIT")))
                .servers(List.of(
                        new Server().url("http://localhost:8080").description("Local development"),
                        new Server().url("https://api.nextdocs.app").description("Production")));
    }
}
