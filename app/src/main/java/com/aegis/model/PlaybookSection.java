package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class PlaybookSection {
    public String id;
    public String playbookId;
    public String playbookName;
    public String number;
    public String title;
    public String text;
    public boolean requiresApproval;
}
