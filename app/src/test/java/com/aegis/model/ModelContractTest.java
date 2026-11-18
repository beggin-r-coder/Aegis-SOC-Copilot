package com.aegis.model;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import static org.assertj.core.api.Assertions.assertThat;

class ModelContractTest {
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void allModelsIgnoreUnknownFields() throws Exception {
        for (Class<?> model : List.of(TriageResult.class, ProposedStep.class, Cve.class, Technique.class,
                InjectionFinding.class, RetrievalHit.class, Playbook.class, PlaybookSection.class,
                Incident.class, IncidentStep.class, AuditEntry.class)) {
            assertThat(mapper.readValue("{\"futureField\":true}", model)).isNotNull();
        }
    }

    @Test
    void incidentListsRemainCopyOnWriteAfterJacksonRoundTrip() throws Exception {
        Incident incident = new Incident();
        incident.steps.add(new IncidentStep());
        incident.audit.add(new AuditEntry());
        Incident restored = mapper.readValue(mapper.writeValueAsString(incident), Incident.class);
        assertThat(restored.steps).isInstanceOf(CopyOnWriteArrayList.class).hasSize(1);
        assertThat(restored.audit).isInstanceOf(CopyOnWriteArrayList.class).hasSize(1);
        assertThat(restored.status).isEqualTo(IncidentStatus.TRIAGING);
        assertThat(restored.steps.getFirst().status).isEqualTo(StepStatus.PENDING);
    }

    @Test
    void triageAndPlaybookFieldsUseExactCamelCase() throws Exception {
        var result = mapper.valueToTree(new TriageResult());
        assertThat(result.has("playbookId")).isTrue();
        assertThat(result.has("injectionDetected")).isTrue();
        assertThat(result.has("rejectedSteps")).isTrue();
        assertThat(result.has("playbook_id")).isFalse();
        var section = mapper.readValue("{\"playbookId\":\"PB-02\",\"requiresApproval\":true}", PlaybookSection.class);
        assertThat(section.requiresApproval).isTrue();
        assertThat(section.playbookId).isEqualTo("PB-02");
    }
}
