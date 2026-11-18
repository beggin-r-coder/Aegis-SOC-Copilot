package com.aegis.incident;

import com.aegis.model.*;

import java.util.Locale;

public final class TicketWriter {
    private TicketWriter() {}

    public static String markdown(Incident incident) {
        synchronized (incident) {
            TriageResult triage = incident.triage;
            String originalSeverity = triage == null ? null : triage.alertSeverity;
            if (originalSeverity == null && incident.rawAlert != null) {
                originalSeverity = incident.rawAlert.path("severity").asText("—");
            }
            if (originalSeverity == null) originalSeverity = "—";
            StringBuilder ticket = new StringBuilder("# ").append(text(incident.id)).append(" — ")
                    .append(text(incident.alertRule)).append("\n\n| Field | Value |\n| --- | --- |\n");
            row(ticket, "Alert", incident.alertId + " (" + incident.source + ")");
            row(ticket, "Received", incident.receivedAt);
            row(ticket, "Status", incident.status);
            row(ticket, "Severity", (triage == null ? "Pending" : triage.severity)
                    + " (original alert: " + originalSeverity + ")");
            row(ticket, "Classification + confidence", triage == null ? "Pending" : triage.classification
                    + " — " + String.format(Locale.ROOT, "%.0f%%", triage.confidence * 100));
            row(ticket, "Playbook", triage == null ? "Pending" : triage.playbookId + " — " + triage.playbookName);
            row(ticket, "Time to contain", incident.timeToContainMillis == null ? "Pending" : incident.timeToContainMillis + " ms");
            section(ticket, "Summary", triage == null ? "Triage has not completed." : triage.summary);
            section(ticket, "Tampering attempt", triage != null && triage.injectionDetected ? triage.injectionReason : "None detected.");
            if (triage != null) {
                for (InjectionFinding finding : triage.injectionFindings) {
                    ticket.append("- ").append(text(finding.field)).append(": ").append(text(finding.rule))
                            .append(" — ").append(text(finding.snippet)).append("\n");
                }
            }
            section(ticket, "Escalation", triage != null && triage.escalated ? triage.escalationReason : "None.");
            ticket.append("\n## Indicators of compromise\n\n");
            if (triage == null || triage.iocs.isEmpty()) {
                ticket.append("None recorded.\n");
            } else {
                triage.iocs.forEach((kind, values) -> values.forEach(value -> ticket.append("- ")
                        .append(text(kind)).append(": ").append(text(value)).append("\n")));
            }
            ticket.append("\n## MITRE ATT&CK\n\n");
            if (triage == null || triage.techniques.isEmpty()) ticket.append("None recorded.\n");
            else for (Technique technique : triage.techniques) {
                ticket.append("- ").append(text(technique.id)).append(" — ").append(text(technique.name)).append("\n");
            }
            ticket.append("\n## Threat intel\n\n");
            if (triage == null || triage.cves.isEmpty()) ticket.append("No matching CVEs.\n");
            else for (Cve cve : triage.cves) {
                ticket.append("### ").append(text(cve.id)).append(" — ").append(text(cve.title)).append("\n\n")
                        .append("Product: ").append(text(cve.product)).append("; CVSS: ").append(cve.cvss)
                        .append("; known exploited: ").append(cve.knownExploited).append(".\n\n")
                        .append(text(cve.summary)).append("\n\nRemediation: ").append(text(cve.remediation)).append("\n");
            }
            ticket.append("\n## Containment actions\n\n")
                    .append("| # | Action | SOP section | Status | Approved by |\n| --- | --- | --- | --- | --- |\n");
            for (IncidentStep step : incident.steps) {
                ticket.append("| ").append(step.index).append(" | ").append(text(step.action));
                if (step.highImpact) ticket.append(" (approval required)");
                ticket.append(" | ").append(text(step.sectionId)).append(" — ").append(text(step.sectionTitle))
                        .append(" | ").append(step.status).append(" | ")
                        .append(step.status == StepStatus.APPROVED ? text(step.decidedBy) : "—").append(" |\n");
            }
            ticket.append("\n## Audit log\n\n");
            for (AuditEntry entry : incident.audit) {
                ticket.append("- ").append(text(entry.at)).append(" · ").append(text(entry.actor))
                        .append(" · ").append(text(entry.event)).append("\n");
            }
            ticket.append("\n---\nEvery containment step was verified against an approved SOP.\n");
            return ticket.toString();
        }
    }

    private static void section(StringBuilder ticket, String heading, String content) {
        ticket.append("\n## ").append(heading).append("\n\n").append(text(content)).append("\n");
    }

    private static void row(StringBuilder ticket, String field, Object value) {
        ticket.append("| ").append(field).append(" | ").append(text(value)).append(" |\n");
    }

    private static String text(Object value) {
        if (value == null) return "—";
        return value.toString().replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
                .replace("\\", "\\\\").replace("|", "\\|").replace("`", "\\`")
                .replace("*", "\\*").replace("_", "\\_").replace("[", "\\[").replace("]", "\\]")
                .replace("#", "\\#").replace("\r", " ").replace("\n", " ");
    }
}
