package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.concurrent.CopyOnWriteArrayList;
import com.fasterxml.jackson.databind.JsonNode;

@JsonIgnoreProperties(ignoreUnknown = true)
public class Incident {
    public String id;
    public String alertId;
    public String alertRule;
    public String source;
    public String receivedAt;
    public long receivedAtMillis;
    public IncidentStatus status = IncidentStatus.TRIAGING;
    public JsonNode rawAlert;
    public TriageResult triage;
    public CopyOnWriteArrayList<IncidentStep> steps = new CopyOnWriteArrayList<>();
    public CopyOnWriteArrayList<AuditEntry> audit = new CopyOnWriteArrayList<>();
    public String containedAt;
    public Long timeToContainMillis;
}
