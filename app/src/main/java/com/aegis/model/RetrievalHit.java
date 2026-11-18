package com.aegis.model;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

@JsonIgnoreProperties(ignoreUnknown = true)
public class RetrievalHit {
    public String sectionId;
    public String playbookId;
    public double score;
    public Integer bm25Rank;
    public Integer vectorRank;
}
