package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.ArrayList;
import java.util.Map;
import java.util.LinkedHashMap;

@JsonIgnoreProperties(ignoreUnknown = true)
public class TriageResult {
    public String mode;
    public String classification = "other";
    public double confidence;
    public String summary;
    public String alertSeverity;
    public Severity severity = Severity.MEDIUM;
    public String playbookId = "NONE";
    public String playbookName;
    public List<Technique> techniques = new ArrayList<>();
    public Map<String, List<String>> iocs = new LinkedHashMap<>();
    public List<Cve> cves = new ArrayList<>();
    public boolean injectionDetected;
    public List<InjectionFinding> injectionFindings = new ArrayList<>();
    public String injectionReason;
    public List<ProposedStep> steps = new ArrayList<>();
    public List<ProposedStep> rejectedSteps = new ArrayList<>();
    public boolean escalated;
    public String escalationReason;
    public List<RetrievalHit> retrieval = new ArrayList<>();
    public long millis;
    public String error;
}
