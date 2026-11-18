package com.aegis.incident;

import com.aegis.engine.FakeTriageEngine;
import com.aegis.model.Incident;
import com.aegis.model.IncidentStatus;
import com.aegis.model.IncidentStep;
import com.aegis.model.StepStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class TicketWriterTest {
    @Test
    void ticketContainsSectionsCveRemediationAndActionDecisions() throws Exception {
        ObjectMapper mapper = new ObjectMapper();
        Incident incident = new Incident();
        incident.id = "INC-0411";
        incident.alertId = "ALERT-001";
        incident.alertRule = "Ransomware detected";
        incident.status = IncidentStatus.CONTAINED;
        incident.triage = new FakeTriageEngine(mapper, "../data")
                .triage(mapper.readTree("{\"source\":\"edr\",\"severity\":\"HIGH\"}"));
        IncidentStep step = new IncidentStep();
        step.action = "Isolate FIN-WS-042";
        step.sectionId = "PB-02 §3.1";
        step.sectionTitle = "Isolate the affected endpoint";
        step.status = StepStatus.APPROVED;
        step.decidedBy = "analyst@example.com";
        incident.steps.add(step);
        String ticket = TicketWriter.markdown(incident);
        assertThat(ticket).contains("# INC-0411", "## Summary", "## Tampering attempt", "## Escalation",
                "## Indicators of compromise", "## MITRE ATT&CK", "## Threat intel",
                "## Containment actions", "## Audit log", "original alert: HIGH", "CVE-2023-4966",
                "Remediation:", "APPROVED", "analyst@example.com", "approved SOP");
    }

    @Test
    void pendingTicketsRenderAndAlertMarkdownCannotCreateSections() {
        Incident incident = new Incident();
        incident.id = "INC-0411";
        incident.alertRule = "<script>bad</script>\n## Fake | section";
        incident.rawAlert = new ObjectMapper().createObjectNode().put("severity", "HIGH");
        String ticket = TicketWriter.markdown(incident);
        assertThat(ticket).contains("Pending", "original alert: HIGH", "&lt;script&gt;", "\\#\\# Fake \\| section");
        assertThat(ticket).doesNotContain("<script>", "\n## Fake");
    }
}
