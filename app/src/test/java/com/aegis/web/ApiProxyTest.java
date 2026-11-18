package com.aegis.web;

import com.aegis.engine.HttpTriageEngine;
import com.aegis.incident.AlertSimulator;
import com.aegis.incident.EventBus;
import com.aegis.incident.IncidentService;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ApiProxyTest {
    @Test
    void proxiesExactBodiesMethodsStatusesAndUsesHttpHealth() throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        List<String> methods = new ArrayList<>();
        List<String> upgrades = new ArrayList<>();
        String playbooks = "[ { \"id\" : \"PB-02\", \"futureField\": true } ]\n";
        String evaluation = "{ \"summary\" : {\"cases\":10}, \"cases\" : [] }\n";
        server.createContext("/", exchange -> {
            upgrades.add(exchange.getRequestHeaders().getFirst("Upgrade"));
            methods.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            String body = switch (exchange.getRequestURI().getPath()) {
                case "/playbooks" -> playbooks;
                case "/eval" -> evaluation;
                default -> "{\"status\":\"ok\",\"mode\":\"offline (rule-based)\"}";
            };
            byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(exchange.getRequestURI().getPath().equals("/eval") ? 201 : 200, bytes.length);
            try (var output = exchange.getResponseBody()) { output.write(bytes); }
            exchange.close();
        });
        server.start();
        String url = "http://127.0.0.1:" + server.getAddress().getPort();
        ObjectMapper mapper = new ObjectMapper();
        var engine = new HttpTriageEngine(mapper, url);
        EventBus events = new EventBus();
        try (IncidentService incidents = new IncidentService(engine, events);
                AlertSimulator simulator = new AlertSimulator(incidents, mapper, "../data")) {
            var mvc = MockMvcBuilders.standaloneSetup(new ApiController(engine, incidents, events, simulator, url + "/"))
                    .setControllerAdvice(new ApiExceptionHandler()).build();
            mvc.perform(get("/api/playbooks")).andExpect(status().isOk()).andExpect(content().bytes(playbooks.getBytes(StandardCharsets.UTF_8)));
            mvc.perform(post("/api/eval")).andExpect(status().isCreated()).andExpect(content().bytes(evaluation.getBytes(StandardCharsets.UTF_8)));
            mvc.perform(get("/api/status")).andExpect(status().isOk())
                    .andExpect(jsonPath("$.triageMode").value("http"))
                    .andExpect(jsonPath("$.triageService.status").value("ok"));
            assertThat(upgrades).containsOnlyNulls();
            assertThat(methods).containsExactly("GET /playbooks", "POST /eval", "GET /health");
        } finally {
            server.stop(0);
        }
    }
}
