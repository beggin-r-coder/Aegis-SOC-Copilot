package com.aegis.incident;

import com.aegis.engine.TriageEngine;
import com.aegis.model.*;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.annotation.PreDestroy;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

@Service
public class IncidentService implements AutoCloseable {
    private final TriageEngine engine;
    private final EventBus events;
    private final Map<String, Incident> incidents = new ConcurrentHashMap<>();
    private final AtomicInteger sequence = new AtomicInteger(410);
    private final ExecutorService executor = Executors.newFixedThreadPool(4);
    // Order clear against commits so late triage cannot republish a cleared incident.
    private final Object registryLock = new Object();

    public IncidentService(TriageEngine engine, EventBus events) {
        this.engine = engine;
        this.events = events;
    }

    public Incident ingest(JsonNode alert) {
        if (alert == null || !alert.isObject()) {
            throw new IllegalArgumentException("Alert must be a JSON object");
        }
        Incident incident = new Incident();
        synchronized (registryLock) {
            synchronized (incident) {
                incident.id = "INC-%04d".formatted(sequence.incrementAndGet());
                incident.alertId = alert.path("alert_id").asText("");
                String rule = alert.path("rule").asText("");
                incident.alertRule = rule.isBlank() ? alert.path("title").asText("") : rule;
                incident.source = alert.path("source").asText("");
                Instant now = Instant.now();
                incident.receivedAt = now.toString();
                incident.receivedAtMillis = now.toEpochMilli();
                incident.rawAlert = alert.deepCopy();
                audit(incident, "system", "Alert received");
                incidents.put(incident.id, incident);
                events.publish("incident", incident);
                executor.submit(() -> runTriage(incident));
            }
        }
        return incident;
    }

    private void runTriage(Incident incident) {
        TriageResult result;
        try {
            result = Objects.requireNonNull(engine.triage(incident.rawAlert.deepCopy()), "Triage returned no result");
            completeTriage(incident, result);
        } catch (Exception exception) {
            synchronized (registryLock) {
                synchronized (incident) {
                    if (incidents.get(incident.id) != incident) {
                        return;
                    }
                    incident.status = IncidentStatus.FAILED;
                    audit(incident, "system", "Triage failed: " + exception);
                    events.publish("incident", incident);
                }
            }
            return;
        }
    }

    private void completeTriage(Incident incident, TriageResult result) {
        synchronized (registryLock) {
            synchronized (incident) {
                if (incidents.get(incident.id) != incident) {
                    return;
                }
                // The wire contract permits only verified steps in the actionable list.
                var verified = new ArrayList<ProposedStep>();
                var rejected = new ArrayList<>(result.rejectedSteps);
                for (ProposedStep proposed : result.steps) {
                    if (proposed.verified) {
                        verified.add(proposed);
                    } else {
                        proposed.rejectReason = "Step was not verified by the triage service";
                        rejected.add(proposed);
                    }
                }
                result.steps = verified;
                result.rejectedSteps = rejected;
                incident.triage = result;
                for (ProposedStep proposed : verified) {
                    IncidentStep step = new IncidentStep();
                    step.index = incident.steps.size();
                    step.action = proposed.action;
                    step.sectionId = proposed.sectionId;
                    step.sectionTitle = proposed.sectionTitle;
                    step.quote = proposed.quote;
                    step.highImpact = proposed.highImpact;
                    incident.steps.add(step);
                }
                if (result.injectionDetected) {
                    audit(incident, "system", "Tampering attempt detected: " + result.injectionReason);
                }
                for (ProposedStep dropped : rejected) {
                    audit(incident, "system", "Dropped step " + dropped.sectionId + ": " + dropped.rejectReason);
                }
                if (result.escalated || verified.isEmpty()) {
                    incident.status = IncidentStatus.ESCALATED;
                    if (!result.escalated) {
                        result.escalated = true;
                        result.escalationReason = "No verified containment steps; routed to L2";
                    }
                    audit(incident, "system", "Escalation: " + result.escalationReason);
                } else {
                    incident.status = IncidentStatus.AWAITING_APPROVAL;
                }
                audit(incident, "system", "Triage complete in " + result.millis + " ms");
                events.publish("incident", incident);
            }
        }
    }

    public Incident decide(String id, int index, boolean approve, String analyst) {
        if (analyst == null || analyst.isBlank()) {
            throw new IllegalArgumentException("Analyst name is required");
        }
        synchronized (registryLock) {
            Incident incident = get(id);
            synchronized (incident) {
                if (incident.status != IncidentStatus.AWAITING_APPROVAL) {
                    throw new IllegalArgumentException("Incident is not awaiting approval");
                }
                if (index < 0 || index >= incident.steps.size()) {
                    throw new NoSuchElementException("Step not found: " + index);
                }
                IncidentStep step = incident.steps.get(index);
                if (step.status != StepStatus.PENDING) {
                    throw new IllegalArgumentException("Step has already been decided");
                }
                step.status = approve ? StepStatus.APPROVED : StepStatus.REJECTED;
                step.decidedBy = analyst.strip();
                step.decidedAt = Instant.now().toString();
                audit(incident, step.decidedBy, (approve ? "Approved" : "Rejected") + " step " + index + ": " + step.action);
                if (incident.steps.stream().noneMatch(item -> item.status == StepStatus.PENDING)) {
                    incident.status = IncidentStatus.CONTAINED;
                    Instant now = Instant.now();
                    incident.containedAt = now.toString();
                    incident.timeToContainMillis = Math.max(0, now.toEpochMilli() - incident.receivedAtMillis);
                    audit(incident, "system", "All containment steps decided; incident contained");
                }
                events.publish("incident", incident);
                return incident;
            }
        }
    }

    public List<Incident> list() {
        synchronized (registryLock) {
            return incidents.values().stream()
                    .sorted(Comparator.comparingLong((Incident item) -> item.receivedAtMillis).reversed()
                            .thenComparing(item -> Integer.parseInt(item.id.substring(4)), Comparator.reverseOrder()))
                    .toList();
        }
    }

    public Incident get(String id) {
        Incident incident = incidents.get(id);
        if (incident == null) {
            throw new NoSuchElementException("Incident not found: " + id);
        }
        return incident;
    }

    public void clear() {
        synchronized (registryLock) {
            incidents.clear();
            events.publish("cleared", Map.of());
        }
    }

    public Map<String, Object> stats() {
        synchronized (registryLock) {
            long open = 0, injections = 0, escalated = 0, verified = 0, dropped = 0;
            long containmentMillis = 0, containedCount = 0, triageMillis = 0, triageCount = 0;
            for (Incident incident : incidents.values()) {
                synchronized (incident) {
                    // Escalated and failed incidents remain open until explicitly handled.
                    if (incident.status != IncidentStatus.CONTAINED) open++;
                    if (incident.status == IncidentStatus.ESCALATED) escalated++;
                    if (incident.timeToContainMillis != null) {
                        containmentMillis += incident.timeToContainMillis;
                        containedCount++;
                    }
                    if (incident.triage != null) {
                        if (incident.triage.injectionDetected) injections++;
                        triageMillis += incident.triage.millis;
                        triageCount++;
                        verified += incident.steps.size();
                        dropped += incident.triage.rejectedSteps.size();
                    }
                }
            }
            Map<String, Object> stats = new LinkedHashMap<>();
            stats.put("total", incidents.size());
            stats.put("open", open);
            stats.put("injectionsBlocked", injections);
            stats.put("escalated", escalated);
            stats.put("avgTimeToContainMillis", containedCount == 0 ? 0.0 : (double) containmentMillis / containedCount);
            stats.put("avgTriageMillis", triageCount == 0 ? 0.0 : (double) triageMillis / triageCount);
            stats.put("verifiedSteps", verified);
            stats.put("droppedSteps", dropped);
            return stats;
        }
    }

    private void audit(Incident incident, String actor, String event) {
        AuditEntry entry = new AuditEntry();
        entry.at = Instant.now().toString();
        entry.actor = actor;
        entry.event = event;
        incident.audit.add(entry);
    }

    @Override
    @PreDestroy
    public void close() {
        executor.shutdownNow();
    }
}
