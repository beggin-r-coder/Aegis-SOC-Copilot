package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class IncidentStep {
    public int index;
    public String action;
    public String sectionId;
    public String sectionTitle;
    public String quote;
    public boolean highImpact;
    public StepStatus status = StepStatus.PENDING;
    public String decidedBy;
    public String decidedAt;
}
