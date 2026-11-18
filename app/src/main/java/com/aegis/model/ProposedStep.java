package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class ProposedStep {
    public String action;
    public String sectionId;
    public String sectionTitle;
    public String quote;
    public boolean highImpact;
    public boolean verified;
    public String rejectReason;
}
