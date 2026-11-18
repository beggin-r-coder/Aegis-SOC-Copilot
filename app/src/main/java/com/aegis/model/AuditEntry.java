package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class AuditEntry {
    public String at;
    public String actor;
    public String event;
}
