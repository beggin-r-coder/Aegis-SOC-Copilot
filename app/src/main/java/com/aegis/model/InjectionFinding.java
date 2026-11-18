package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class InjectionFinding {
    public String field;
    public String rule;
    public String snippet;
}
