package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.ArrayList;

@JsonIgnoreProperties(ignoreUnknown = true)
public class Playbook {
    public String id;
    public String name;
    public String classification;
    public List<String> keywords = new ArrayList<>();
    public List<PlaybookSection> sections = new ArrayList<>();
}
