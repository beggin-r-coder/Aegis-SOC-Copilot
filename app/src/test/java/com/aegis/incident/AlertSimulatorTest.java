package com.aegis.incident;

import com.aegis.engine.FakeTriageEngine;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

class AlertSimulatorTest {
    private final ObjectMapper mapper = new ObjectMapper();

    private static class RecordingIncidents extends IncidentService {
        final List<JsonNode> alerts = Collections.synchronizedList(new ArrayList<>());
        final List<Long> times = Collections.synchronizedList(new ArrayList<>());

        RecordingIncidents(FakeTriageEngine engine) { super(engine, new EventBus()); }

        @Override
        public com.aegis.model.Incident ingest(JsonNode alert) {
            times.add(System.nanoTime());
            alerts.add(alert.deepCopy());
            return new com.aegis.model.Incident();
        }
    }

    @Test
    void emitsOnlyDemoAlertsInRequestedOrderWithFreshTimestampsAndGaps() throws Exception {
        try (var incidents = new RecordingIncidents(new FakeTriageEngine(mapper, "../data"));
                var simulator = new AlertSimulator(incidents, mapper, "../data")) {
            Instant start = Instant.now();
            assertThat(simulator.samples()).hasSize(10);
            assertThat(simulator.simulate(0.05)).isEqualTo(6);
            await().atMost(Duration.ofSeconds(5)).until(() -> incidents.alerts.size() == 6);
            assertThat(incidents.alerts).extracting(alert -> alert.path("alert_id").asText()).containsExactly(
                    "ALERT-PHISH-001", "ALERT-CRED-001", "ALERT-RANSOM-001", "ALERT-INJECT-001", "ALERT-S3-001", "ALERT-DDOS-001");
            for (JsonNode alert : incidents.alerts) {
                assertThat(Instant.parse(alert.path("timestamp").asText())).isAfterOrEqualTo(start);
            }
            assertThat(incidents.times.getLast() - incidents.times.getFirst()).isGreaterThanOrEqualTo(200_000_000L);
            assertThat(simulator.sample("phishing-01.json").path("timestamp").asText()).isEqualTo("2026-11-18T09:05:00Z");
        }
    }

    @Test
    void rejectsUnsafeFileNamesAndMissingSamples() throws Exception {
        try (var incidents = new RecordingIncidents(new FakeTriageEngine(mapper, "../data"));
                var simulator = new AlertSimulator(incidents, mapper, "../data")) {
            for (String file : List.of("../x", "a/b", "a\\b", "a..json", "")) {
                assertThatThrownBy(() -> simulator.sample(file)).isInstanceOf(IllegalArgumentException.class);
            }
            assertThatThrownBy(() -> simulator.sample("missing.json")).isInstanceOf(java.util.NoSuchElementException.class);
            assertThatThrownBy(() -> simulator.simulate(Double.POSITIVE_INFINITY)).isInstanceOf(IllegalArgumentException.class);
        }
    }

    @Test
    void stopCancelsRemainingDemoAlerts() throws Exception {
        try (var incidents = new RecordingIncidents(new FakeTriageEngine(mapper, "../data"));
                var simulator = new AlertSimulator(incidents, mapper, "../data")) {
            simulator.simulate(10);
            await().atMost(Duration.ofSeconds(3)).until(() -> incidents.alerts.size() == 1);
            simulator.stop();
            await().during(Duration.ofMillis(100)).atMost(Duration.ofSeconds(2))
                    .untilAsserted(() -> assertThat(incidents.alerts).hasSize(1));
        }
    }
}
