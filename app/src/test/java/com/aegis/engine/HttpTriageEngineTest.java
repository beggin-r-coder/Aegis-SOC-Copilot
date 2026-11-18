package com.aegis.engine;

import com.aegis.AegisApplication;
import com.aegis.model.Severity;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class HttpTriageEngineTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private HttpServer server;
    private String url;

    @BeforeEach
    void startServer() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort();
    }

    @AfterEach
    void stopServer() {
        server.stop(0);
    }

    private void respond(String path, int status, String body) {
        server.createContext(path, exchange -> {
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().add("Content-Type", "application/json");
            exchange.sendResponseHeaders(status, bytes.length);
            try (var stream = exchange.getResponseBody()) {
                stream.write(bytes);
            }
            exchange.close();
        });
    }

    @Test
    void sendsAlertAndParsesCamelCaseResponse() throws Exception {
        AtomicReference<JsonNode> received = new AtomicReference<>();
        AtomicReference<String> method = new AtomicReference<>();
        AtomicReference<String> contentType = new AtomicReference<>();
        AtomicReference<String> upgrade = new AtomicReference<>();
        server.createContext("/triage", exchange -> {
            upgrade.set(exchange.getRequestHeaders().getFirst("Upgrade"));
            method.set(exchange.getRequestMethod());
            contentType.set(exchange.getRequestHeaders().getFirst("Content-Type"));
            received.set(mapper.readTree(exchange.getRequestBody()));
            byte[] body = "{\"mode\":\"offline (rule-based)\",\"severity\":\"CRITICAL\",\"playbookId\":\"PB-02\",\"injectionDetected\":false,\"futureField\":1}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, body.length);
            try (var stream = exchange.getResponseBody()) {
                stream.write(body);
            }
            exchange.close();
        });
        var engine = new HttpTriageEngine(mapper, url + "/");
        JsonNode alert = mapper.readTree("{\"source\":\"edr\",\"nested\":{\"value\":1}}");
        var result = engine.triage(alert);
        assertThat(received.get()).isEqualTo(alert);
        assertThat(method.get()).isEqualTo("POST");
        assertThat(upgrade.get()).as("Uvicorn expects HTTP/1.1 without an h2c upgrade").isNull();
        assertThat(contentType.get()).isEqualTo("application/json");
        assertThat(result.playbookId).isEqualTo("PB-02");
        assertThat(result.severity).isEqualTo(Severity.CRITICAL);
        assertThat(result.error).isNull();
        assertThat(engine.mode()).isEqualTo("http");
    }

    @Test
    void reportsHealthJson() {
        respond("/health", 200, "{\"status\":\"ok\",\"retrievalMode\":\"bm25\"}");
        assertThat(new HttpTriageEngine(mapper, url).health().path("status").asText()).isEqualTo("ok");
    }

    @Test
    void httpErrorsEscalateAndHealthReturnsNull() {
        respond("/triage", 503, "{\"error\":\"down\"}");
        respond("/health", 503, "{}");
        var engine = new HttpTriageEngine(mapper, url);
        var result = engine.triage(mapper.createObjectNode());
        assertThat(result.escalated).isTrue();
        assertThat(result.escalationReason).isEqualTo("Triage service unavailable - routed to L2");
        assertThat(result.error).contains("503");
        assertThat(result.mode).isEqualTo("unavailable");
        assertThat(result.steps).isEmpty();
        assertThat(engine.health()).isNull();
    }

    @Test
    void malformedResponsesEscalate() {
        respond("/triage", 200, "not json");
        var result = new HttpTriageEngine(mapper, url).triage(mapper.createObjectNode());
        assertThat(result.escalated).isTrue();
        assertThat(result.error).isNotBlank();
    }

    @Test
    void nonObjectResponsesEscalate() {
        respond("/triage", 200, "null");
        var result = new HttpTriageEngine(mapper, url).triage(mapper.createObjectNode());
        assertThat(result.mode).isEqualTo("unavailable");
        assertThat(result.escalated).isTrue();
    }

    @Test
    void connectionFailuresEscalate() {
        server.stop(0);
        var engine = new HttpTriageEngine(mapper, url);
        var result = engine.triage(mapper.createObjectNode());
        assertThat(result.mode).isEqualTo("unavailable");
        assertThat(result.error).isNotBlank();
        assertThat(engine.health()).isNull();
    }

    @Test
    void httpPropertySelectsOnlyHttpEngine() {
        new ApplicationContextRunner().withUserConfiguration(AegisApplication.class)
                .withPropertyValues("aegis.triage.engine=http", "aegis.triage.url=" + url)
                .run(context -> {
                    assertThat(context).hasSingleBean(TriageEngine.class);
                    assertThat(context.getBean(TriageEngine.class)).isInstanceOf(HttpTriageEngine.class);
                });
    }
}
