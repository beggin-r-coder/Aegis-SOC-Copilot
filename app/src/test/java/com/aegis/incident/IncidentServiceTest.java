package com.aegis.incident;

import com.aegis.engine.FakeTriageEngine;
import com.aegis.engine.TriageEngine;
import com.aegis.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.function.Function;

import static org.assertj.core.api.Assertions.*;
import static org.awaitility.Awaitility.await;

class IncidentServiceTest {
    private final ObjectMapper mapper = new ObjectMapper();
    private FakeTriageEngine engine;
    private RecordingBus events;
    private IncidentService service;

    static class RecordingBus extends EventBus {
        final List<String> names = new CopyOnWriteArrayList<>();
        final List<IncidentStatus> statuses = new CopyOnWriteArrayList<>();

        @Override
        public void publish(String event, Object payload) {
            names.add(event);
            if (payload instanceof Incident incident) statuses.add(incident.status);
        }
    }

    @BeforeEach
    void setUp() throws Exception {
        engine = new FakeTriageEngine(mapper, "../data");
        events = new RecordingBus();
        service = new IncidentService(engine, events);
    }

    @AfterEach
    void tearDown() {
        service.close();
    }

    private Incident ingest(String source) {
        Incident incident = service.ingest(mapper.createObjectNode().put("source", source)
                .put("alert_id", "A-001").put("rule", "Suspicious activity").put("severity", "HIGH"));
        await().atMost(Duration.ofSeconds(5)).until(() -> {
            synchronized (incident) {
                return incident.status != IncidentStatus.TRIAGING;
            }
        });
        return incident;
    }

    @Test
    void edrTriageAwaitsApprovalAndAllApprovalsContainIncident() {
        Incident incident = ingest("edr");
        assertThat(incident.id).isEqualTo("INC-0411");
        assertThat(incident.alertId).isEqualTo("A-001");
        assertThat(incident.status).isEqualTo(IncidentStatus.AWAITING_APPROVAL);
        assertThat(incident.steps).hasSize(3);
        assertThat(incident.audit.getFirst().event).isEqualTo("Alert received");
        assertThat(incident.audit).anySatisfy(entry -> assertThat(entry.event).contains("Dropped step PB-02 §5.2"));
        assertThat(events.statuses).containsExactly(IncidentStatus.TRIAGING, IncidentStatus.AWAITING_APPROVAL);
        for (int i = 0; i < 3; i++) service.decide(incident.id, i, true, "analyst@example.com");
        assertThat(incident.status).isEqualTo(IncidentStatus.CONTAINED);
        assertThat(incident.containedAt).isNotBlank();
        assertThat(incident.timeToContainMillis).isNotNegative();
        assertThat(incident.steps).allSatisfy(step -> {
            assertThat(step.status).isEqualTo(StepStatus.APPROVED);
            assertThat(step.decidedBy).isEqualTo("analyst@example.com");
            assertThat(step.decidedAt).isNotBlank();
        });
    }

    @Test
    void wafTriageEscalatesAndAuditsTampering() {
        Incident incident = ingest("waf");
        assertThat(incident.status).isEqualTo(IncidentStatus.ESCALATED);
        assertThat(incident.steps).isEmpty();
        assertThat(incident.audit).anySatisfy(entry -> assertThat(entry.event).contains("Tampering attempt"));
        assertThat(incident.audit).anySatisfy(entry -> assertThat(entry.event).contains("Escalation:"));
        assertThatThrownBy(() -> service.decide(incident.id, 0, true, "analyst")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void decisionsRejectInvalidAndAlreadyDecidedSteps() {
        Incident incident = ingest("edr");
        assertThatThrownBy(() -> service.decide(incident.id, 0, true, " ")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.decide(incident.id, -1, true, "analyst")).isInstanceOf(NoSuchElementException.class);
        service.decide(incident.id, 0, false, " analyst ");
        assertThat(incident.steps.getFirst().status).isEqualTo(StepStatus.REJECTED);
        assertThat(incident.steps.getFirst().decidedBy).isEqualTo("analyst");
        assertThat(incident.status).isEqualTo(IncidentStatus.AWAITING_APPROVAL);
        assertThatThrownBy(() -> service.decide(incident.id, 0, true, "other")).isInstanceOf(IllegalArgumentException.class);
        service.decide(incident.id, 1, true, "analyst");
        service.decide(incident.id, 2, true, "analyst");
        assertThat(incident.status).isEqualTo(IncidentStatus.CONTAINED);
    }

    @Test
    void listingStatsAndClearReflectLifecycle() {
        Incident edr = ingest("edr");
        Incident waf = ingest("waf");
        assertThat(waf.id).isEqualTo("INC-0412");
        assertThat(service.list()).containsExactly(waf, edr);
        assertThat(service.get(edr.id)).isSameAs(edr);
        for (int i = 0; i < 3; i++) service.decide(edr.id, i, true, "analyst");
        var stats = service.stats();
        assertThat(stats).containsEntry("total", 2).containsEntry("open", 1L)
                .containsEntry("injectionsBlocked", 1L).containsEntry("escalated", 1L)
                .containsEntry("verifiedSteps", 3L).containsEntry("droppedSteps", 1L);
        assertThat((double) stats.get("avgTriageMillis")).isEqualTo((edr.triage.millis + waf.triage.millis) / 2.0);
        assertThat((double) stats.get("avgTimeToContainMillis")).isEqualTo(edr.timeToContainMillis.doubleValue());
        service.clear();
        assertThat(service.list()).isEmpty();
        assertThat(events.names.getLast()).isEqualTo("cleared");
        assertThat(service.stats()).containsEntry("total", 0).containsEntry("avgTriageMillis", 0.0);
        assertThatThrownBy(() -> service.get(edr.id)).isInstanceOf(NoSuchElementException.class);
        assertThat(ingest("edr").id).isEqualTo("INC-0413");
    }

    @Test
    void validatesAlertAndCopiesInputUsingTitleFallback() {
        assertThatThrownBy(() -> service.ingest(null)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.ingest(mapper.createArrayNode())).isInstanceOf(IllegalArgumentException.class);
        var input = mapper.createObjectNode().put("source", "edr").put("rule", " ").put("title", "Title fallback");
        Incident incident = service.ingest(input);
        input.put("title", "Changed outside service");
        assertThat(incident.alertRule).isEqualTo("Title fallback");
        assertThat(incident.rawAlert.path("title").asText()).isEqualTo("Title fallback");
    }

    private TriageEngine customEngine(Function<JsonNode, TriageResult> function) {
        return new TriageEngine() {
            public TriageResult triage(JsonNode alert) { return function.apply(alert); }
            public String mode() { return "test"; }
        };
    }

    @Test
    void engineExceptionsSetFailedAndPublish() {
        service.close();
        service = new IncidentService(customEngine(alert -> { throw new IllegalStateException("engine down"); }), events);
        Incident incident = ingest("edr");
        assertThat(incident.status).isEqualTo(IncidentStatus.FAILED);
        assertThat(incident.audit.getLast().event).contains("engine down");
        assertThat(events.statuses.getLast()).isEqualTo(IncidentStatus.FAILED);
    }

    @Test
    void malformedTriageResultsCannotLeaveIncidentTriagingForever() {
        service.close();
        service = new IncidentService(customEngine(alert -> {
            TriageResult result = new TriageResult();
            result.steps = null;
            return result;
        }), events);
        Incident incident = ingest("edr");
        assertThat(incident.status).isEqualTo(IncidentStatus.FAILED);
        assertThat(incident.steps).isEmpty();
    }

    @Test
    void unverifiedStepsAreDroppedAndNeverBecomeActionable() {
        service.close();
        service = new IncidentService(customEngine(alert -> {
            TriageResult result = new TriageResult();
            ProposedStep step = new ProposedStep();
            step.action = "Unverified action";
            result.steps.add(step);
            return result;
        }), events);
        Incident incident = ingest("edr");
        assertThat(incident.status).isEqualTo(IncidentStatus.ESCALATED);
        assertThat(incident.steps).isEmpty();
        assertThat(incident.triage.steps).isEmpty();
        assertThat(incident.triage.rejectedSteps).hasSize(1);
    }

    @Test
    void exactlyFourTriagesCanRunConcurrentlyAndClearSuppressesLateEvents() throws Exception {
        service.close();
        CountDownLatch entered = new CountDownLatch(4);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch finished = new CountDownLatch(4);
        service = new IncidentService(customEngine(alert -> {
            entered.countDown();
            try {
                if (!release.await(5, TimeUnit.SECONDS)) throw new IllegalStateException("test timed out");
                return engine.triage(alert);
            } catch (InterruptedException exception) {
                Thread.currentThread().interrupt();
                throw new IllegalStateException(exception);
            } finally {
                finished.countDown();
            }
        }), events);
        for (int i = 0; i < 5; i++) service.ingest(mapper.createObjectNode().put("source", "edr"));
        assertThat(entered.await(3, TimeUnit.SECONDS)).isTrue();
        assertThat(events.statuses).hasSize(5).containsOnly(IncidentStatus.TRIAGING);
        service.clear();
        release.countDown();
        assertThat(finished.await(3, TimeUnit.SECONDS)).isTrue();
        await().during(Duration.ofMillis(150)).atMost(Duration.ofSeconds(2))
                .untilAsserted(() -> assertThat(events.names.getLast()).isEqualTo("cleared"));
        assertThat(service.list()).isEmpty();
    }

    @Test
    void racingDecisionsOnlyRecordOneDecision() throws Exception {
        Incident incident = ingest("edr");
        CountDownLatch start = new CountDownLatch(1);
        try (var callers = Executors.newFixedThreadPool(2)) {
            var futures = List.of("first", "second").stream().map(analyst -> callers.submit(() -> {
                start.await();
                try {
                    service.decide(incident.id, 0, true, analyst);
                    return true;
                } catch (IllegalArgumentException expected) {
                    return false;
                }
            })).toList();
            start.countDown();
            int approved = 0;
            for (var future : futures) if (future.get(3, TimeUnit.SECONDS)) approved++;
            assertThat(approved).isEqualTo(1);
        }
        assertThat(incident.audit.stream().filter(entry -> entry.event.startsWith("Approved step 0"))).hasSize(1);
    }
}
