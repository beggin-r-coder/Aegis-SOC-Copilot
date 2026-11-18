package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.ArrayList;

@JsonIgnoreProperties(ignoreUnknown = true)
public class Cve {
    public String id;
    public String title;
    public String product;
    public double cvss;
    public boolean knownExploited;
    public String summary;
    public List<String> keywords = new ArrayList<>();
    public String remediation;
}
