package com.nextdocs.api;

import com.nextdocs.api.document.config.DocumentProperties;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
@EnableConfigurationProperties(DocumentProperties.class)
public class NextdocsApiApplication {

    public static void main(String[] args) {
        SpringApplication.run(NextdocsApiApplication.class, args);
    }
}
