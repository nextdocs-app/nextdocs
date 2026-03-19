package com.nextdocs.api.common.cache;

import io.github.bucket4j.Bucket;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

// Spring bean definitions for typed {@link CacheStore} instances.
@Configuration
public class CacheConfig {
    @Bean
    public CacheStore<String, Bucket> bucketCache() {
        return new CaffeineCacheStore<>();
    }
}
