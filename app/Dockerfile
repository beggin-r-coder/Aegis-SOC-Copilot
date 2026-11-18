FROM maven:3.9-eclipse-temurin-21 AS build

WORKDIR /srv/app
COPY app/ ./
RUN mvn -q -B package -DskipTests

FROM eclipse-temurin:21-jre

WORKDIR /srv
COPY --from=build /srv/app/target/aegis-app-*.jar ./app.jar
COPY data/ /srv/data/

ENV AEGIS_DATA_DIR=/srv/data

EXPOSE 8080

ENTRYPOINT ["java", "-jar", "app.jar"]
