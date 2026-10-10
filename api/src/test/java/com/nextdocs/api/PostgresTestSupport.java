package com.nextdocs.api;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;

/**
 * Connection helper for the PostgreSQL-backed migration tests.
 *
 * <p>The main suite builds its schema through Hibernate with Flyway disabled, so the
 * migration DDL only ever executes in these tests. There is deliberately no skip path:
 * PostgreSQL is a hard requirement of the dev setup (see README, started by {@code ./nd
 * dev} on localhost:5433) and CI always provides it as a service, so an unreachable
 * database fails the test instead of silently hollowing out migration coverage.
 */
public final class PostgresTestSupport {

    private PostgresTestSupport() {}

    public static String resolveUrl() {
        return System.getProperty(
                "spring.datasource.url",
                System.getenv().getOrDefault("SPRING_DATASOURCE_URL", "jdbc:postgresql://localhost:5433/nextdocs"));
    }

    public static String resolveUsername() {
        return System.getProperty(
                "spring.datasource.username", System.getenv().getOrDefault("SPRING_DATASOURCE_USERNAME", "nextdocs"));
    }

    public static String resolvePassword() {
        return System.getProperty(
                "spring.datasource.password", System.getenv().getOrDefault("SPRING_DATASOURCE_PASSWORD", "nextdocs"));
    }

    public static Connection connect(String url, String username, String password) {
        try {
            return DriverManager.getConnection(url, username, password);
        } catch (SQLException e) {
            throw new AssertionError(
                    "PostgreSQL is required for this migration test but not reachable at " + url + ": "
                            + e.getMessage(),
                    e);
        }
    }
}
