package com.aegis.engine;

import com.aegis.model.TriageResult;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;

@Component
@ConditionalOnProperty(prefix = "aegis.triage", name = "engine", havingValue = "http")
public class HttpTriageEngine implements TriageEngine {
    private static final Duration TIMEOUT = Duration.ofSeconds(60);
    private final HttpClient client;
    private final ObjectMapper mapper;
    private final String baseUrl;

    public HttpTriageEngine(ObjectMapper mapper, @Value("${aegis.triage.url}") String baseUrl) {
        this.mapper = mapper;
        this.baseUrl = baseUrl.replaceAll("/+$", "");
        this.client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(TIMEOUT).build();
    }

    @Override
    public String mode() {
        return "http";
    }

    @Override
    public TriageResult triage(JsonNode alert) {
        long start = System.nanoTime();
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/triage"))
                    .timeout(TIMEOUT)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .POST(HttpRequest.BodyPublishers.ofString(mapper.writeValueAsString(alert)))
                    .build();
            JsonNode body = send(request);
            return mapper.treeToValue(body, TriageResult.class);
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            TriageResult failure = new TriageResult();
            failure.mode = "unavailable";
            failure.escalated = true;
            failure.escalationReason = "Triage service unavailable - routed to L2";
            failure.error = exception.getMessage() == null
                    ? exception.getClass().getSimpleName() : exception.getMessage();
            failure.millis = (System.nanoTime() - start) / 1_000_000;
            return failure;
        }
    }

    public JsonNode health() {
        try {
            HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/health"))
                    .timeout(TIMEOUT).header("Accept", "application/json").GET().build();
            return send(request);
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            return null;
        }
    }

    private JsonNode send(HttpRequest request) throws IOException, InterruptedException {
        HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() < 200 || response.statusCode() >= 300) {
            throw new IOException("HTTP " + response.statusCode() + " from triage service");
        }
        JsonNode body = mapper.readTree(response.body());
        if (body == null || !body.isObject()) {
            throw new IOException("Triage service returned a non-object JSON response");
        }
        return body;
    }
}
