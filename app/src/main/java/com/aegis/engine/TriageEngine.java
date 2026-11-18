package com.aegis.engine;

import com.aegis.model.TriageResult;
import com.fasterxml.jackson.databind.JsonNode;

public interface TriageEngine {
    TriageResult triage(JsonNode alert);
    String mode();
}
