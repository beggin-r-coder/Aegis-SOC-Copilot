package com.aegis.web;

import com.aegis.engine.HttpTriageEngine;
import com.aegis.engine.TriageEngine;
import com.aegis.incident.AlertSimulator;
import com.aegis.incident.EventBus;
import com.aegis.incident.IncidentService;
import com.aegis.incident.TicketWriter;
import com.aegis.model.Incident;
import com.aegis.model.TriageResult;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ApiController {
    private final TriageEngine engine;
    private final IncidentService incidents;
    private final EventBus events;
    private final AlertSimulator simulator;
    private final String triageUrl;
    private final HttpClient client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1).connectTimeout(Duration.ofSeconds(10)).build();

    public ApiController(TriageEngine engine, IncidentService incidents, EventBus events,
            AlertSimulator simulator, @Value("${aegis.triage.url}") String triageUrl) {
        this.engine = engine;
        this.incidents = incidents;
        this.events = events;
        this.simulator = simulator;
        this.triageUrl = triageUrl.replaceAll("/+$", "");
    }

    @GetMapping("/status")
    public Map<String, Object> status() {
        Map<String, Object> status = new LinkedHashMap<>();
        status.put("triageMode", engine.mode());
        status.put("triageService", engine instanceof HttpTriageEngine http ? http.health() : null);
        status.put("samples", simulator.samples());
        status.put("stats", incidents.stats());
        return status;
    }

    @PostMapping("/alerts")
    public ResponseEntity<Incident> ingest(@RequestBody JsonNode alert) {
        return ResponseEntity.accepted().body(incidents.ingest(alert));
    }

    @PostMapping("/triage")
    public TriageResult triage(@RequestBody JsonNode alert) {
        if (!alert.isObject()) throw new IllegalArgumentException("Alert must be a JSON object");
        return engine.triage(alert);
    }

    @PostMapping("/simulate")
    public ResponseEntity<Map<String, Object>> simulate(@RequestParam(defaultValue = "4") double gapSeconds) {
        int count = simulator.simulate(gapSeconds);
        return ResponseEntity.accepted().body(Map.of("scheduled", count, "gapSeconds", gapSeconds));
    }

    @GetMapping("/incidents")
    public List<Incident> list() { return incidents.list(); }

    @GetMapping("/incidents/{id}")
    public Incident get(@PathVariable String id) { return incidents.get(id); }

    @PostMapping("/incidents/{id}/steps/{index}/approve")
    public Incident approve(@PathVariable String id, @PathVariable int index,
            @RequestParam(defaultValue = "analyst") String analyst) {
        return incidents.decide(id, index, true, analyst);
    }

    @PostMapping("/incidents/{id}/steps/{index}/reject")
    public Incident reject(@PathVariable String id, @PathVariable int index,
            @RequestParam(defaultValue = "analyst") String analyst) {
        return incidents.decide(id, index, false, analyst);
    }

    @GetMapping(value = "/incidents/{id}/ticket", produces = "text/markdown;charset=UTF-8")
    public String ticket(@PathVariable String id) { return TicketWriter.markdown(incidents.get(id)); }

    @PostMapping("/incidents/clear")
    public Map<String, Boolean> clear() {
        simulator.stop();
        incidents.clear();
        return Map.of("cleared", true);
    }

    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream() { return events.subscribe(); }

    @GetMapping("/samples/{*file}")
    public JsonNode sample(@PathVariable String file) {
        return simulator.sample(file.startsWith("/") ? file.substring(1) : file);
    }

    @GetMapping("/playbooks")
    public ResponseEntity<?> playbooks() { return proxy("/playbooks", false); }

    @PostMapping("/eval")
    public ResponseEntity<?> evaluate() { return proxy("/eval", true); }

    private ResponseEntity<?> proxy(String path, boolean post) {
        try {
            var builder = HttpRequest.newBuilder(URI.create(triageUrl + path))
                    .timeout(Duration.ofSeconds(60)).header("Accept", MediaType.APPLICATION_JSON_VALUE);
            HttpRequest request = post ? builder.POST(HttpRequest.BodyPublishers.noBody()).build() : builder.GET().build();
            HttpResponse<byte[]> response = client.send(request, HttpResponse.BodyHandlers.ofByteArray());
            return ResponseEntity.status(response.statusCode())
                    .contentType(MediaType.parseMediaType(response.headers().firstValue("Content-Type")
                            .orElse(MediaType.APPLICATION_JSON_VALUE)))
                    .body(response.body());
        } catch (Exception exception) {
            if (exception instanceof InterruptedException) Thread.currentThread().interrupt();
            return ResponseEntity.status(503).body(Map.of("error", "Triage service unavailable"));
        }
    }
}
