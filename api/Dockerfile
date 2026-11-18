# Keep the Java line in sync with .java-version; `pnpm run check:runtime-versions` fails otherwise.
FROM maven:3.10-eclipse-temurin-21-alpine AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -B dependency:go-offline --no-transfer-progress
COPY src ./src
RUN mvn -B clean package -DskipTests --no-transfer-progress

FROM maven:3.10-eclipse-temurin-21-alpine AS dev
WORKDIR /app
COPY pom.xml .
COPY src ./src
# We use spring-boot:run to keep the container running during development.
CMD ["mvn", "spring-boot:run"]

FROM eclipse-temurin:21-jre-alpine
WORKDIR /app
COPY --from=build /app/target/app.jar app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
