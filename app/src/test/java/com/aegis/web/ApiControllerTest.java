package com.aegis.web;

import com.aegis.incident.AlertSimulator;
import com.aegis.incident.EventBus;
import com.aegis.incident.IncidentService;
import com.aegis.model.IncidentStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Duration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest(properties = {"aegis.triage.engine=fake", "aegis.datadir=../data", "aegis.triage.url=http://127.0.0.1:1"})
@AutoConfigureMockMvc
class ApiControllerTest {
    @Autowired MockMvc mvc;
    @Autowired ObjectMapper mapper;
    @Autowired IncidentService incidents;
    @Autowired AlertSimulator simulator;
    @Autowired EventBus events;

    @BeforeEach
    void clear() {
        simulator.stop();
        incidents.clear();
    }

    @Test
    void ingestReturns202AndIdThenApprovalFlowAndTicketWork() throws Exception {
        String body = mvc.perform(post("/api/alerts").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"source\":\"edr\",\"alert_id\":\"A-001\"}"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.id").exists())
                .andReturn().getResponse().getContentAsString();
        String id = mapper.readTree(body).path("id").asText();
        await().atMost(Duration.ofSeconds(5)).until(() -> {
            var incident = incidents.get(id);
            synchronized (incident) { return incident.status == IncidentStatus.AWAITING_APPROVAL; }
        });
        mvc.perform(get("/api/incidents")).andExpect(status().isOk()).andExpect(jsonPath("$[0].id").value(id));
        mvc.perform(get("/api/incidents/" + id)).andExpect(jsonPath("$.steps.length()").value(3));
        mvc.perform(post("/api/incidents/" + id + "/steps/0/approve").param("analyst", "alice"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.steps[0].decidedBy").value("alice"));
        mvc.perform(post("/api/incidents/" + id + "/steps/1/reject").param("analyst", "bob"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.steps[1].status").value("REJECTED"));
        mvc.perform(post("/api/incidents/" + id + "/steps/2/approve"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.status").value("CONTAINED"));
        mvc.perform(get("/api/incidents/" + id + "/ticket"))
                .andExpect(status().isOk()).andExpect(content().contentTypeCompatibleWith("text/markdown"))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("Containment actions")));
        mvc.perform(post("/api/incidents/clear")).andExpect(jsonPath("$.cleared").value(true));
        mvc.perform(get("/api/incidents")).andExpect(content().json("[]"));
    }

    @Test
    void unknownIncidentAndUnsafeSamplePathsReturnContractErrors() throws Exception {
        mvc.perform(post("/api/incidents/INC-9999/steps/0/approve"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error").isString());
        mvc.perform(get("/api/samples/../x"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
        mvc.perform(get("/api/samples/nested/file.json")).andExpect(status().isBadRequest());
        mvc.perform(get("/api/samples/missing.json")).andExpect(status().isNotFound());
        mvc.perform(get("/api/incidents/unknown/ticket"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.error").isString());
    }

    @Test
    void statusSamplesAndSyncTriageWorkWithoutCreatingIncident() throws Exception {
        mvc.perform(get("/api/status")).andExpect(status().isOk())
                .andExpect(jsonPath("$.triageMode").value("fake"))
                .andExpect(jsonPath("$.triageService").value(org.hamcrest.Matchers.nullValue()))
                .andExpect(jsonPath("$.samples.length()").value(10))
                .andExpect(jsonPath("$.stats.total").value(0));
        mvc.perform(get("/api/samples/ransomware-01.json"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.host").value("FIN-WS-042"));
        mvc.perform(post("/api/triage").contentType(MediaType.APPLICATION_JSON).content("{\"source\":\"edr\"}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.playbookId").value("PB-02"));
        assertThat(incidents.list()).isEmpty();
    }

    @Test
    void rejectsMalformedOrNonObjectAlertsAndInvalidSimulationIntervals() throws Exception {
        for (String path : new String[]{"/api/alerts", "/api/triage"}) {
            for (String body : new String[]{"[]", "null", "{", "42"}) {
                mvc.perform(post(path).contentType(MediaType.APPLICATION_JSON).content(body))
                        .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").isString());
            }
        }
        mvc.perform(post("/api/simulate").param("gapSeconds", "-1")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/simulate").param("gapSeconds", "NaN")).andExpect(status().isBadRequest());
        mvc.perform(post("/api/simulate").param("gapSeconds", "bad")).andExpect(status().isBadRequest());
    }

    @Test
    void simulationSchedulesSixAlerts() throws Exception {
        mvc.perform(post("/api/simulate").param("gapSeconds", "0"))
                .andExpect(status().isAccepted()).andExpect(jsonPath("$.scheduled").value(6));
        await().atMost(Duration.ofSeconds(5)).until(() -> incidents.list().size() == 6);
    }

    @Test
    void unreachableProxyReturns503Error() throws Exception {
        mvc.perform(get("/api/playbooks")).andExpect(status().isServiceUnavailable())
                .andExpect(content().json("{\"error\":\"Triage service unavailable\"}"));
        mvc.perform(post("/api/eval")).andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("Triage service unavailable"));
    }

    @Test
    void streamStartsAsyncAndReceivesNamedEvents() throws Exception {
        var result = mvc.perform(get("/api/stream")).andExpect(request().asyncStarted()).andReturn();
        events.publish("cleared", java.util.Map.of());
        assertThat(result.getResponse().getContentType()).startsWith("text/event-stream");
        assertThat(result.getResponse().getContentAsString()).contains("event:cleared", "data:{}");
        result.getRequest().getAsyncContext().complete();
    }

    @Test
    void dashboardAndStaticAssetsAreServed() throws Exception {
        mvc.perform(get("/")).andExpect(status().isOk()).andExpect(forwardedUrl("index.html"));
        mvc.perform(get("/index.html")).andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("/app.js")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("family=Inter")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("JetBrains+Mono")))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("id=\"refreshStatus\"")));
        mvc.perform(get("/app.css")).andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("color-scheme: light")));
        mvc.perform(get("/app.js")).andExpect(status().isOk())
                .andExpect(content().string(org.hamcrest.Matchers.containsString("new EventSource")));
    }
}
