package com.aegis.incident;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@Service
public class AlertSimulator implements AutoCloseable {
    private static final List<String> ORDER = List.of("phishing", "credstuff", "ransomware", "injection", "s3", "ddos");
    private final Path dataDir;
    private final ObjectMapper mapper;
    private final IncidentService incidents;
    private final ScheduledExecutorService scheduler = Executors.newSingleThreadScheduledExecutor();
    private final List<ScheduledFuture<?>> scheduled = new ArrayList<>();
    private long generation;

    public AlertSimulator(IncidentService incidents, ObjectMapper mapper,
            @Value("${aegis.data-dir:${aegis.datadir:../data}}") String dataDir) {
        this.incidents = incidents;
        this.mapper = mapper;
        this.dataDir = Path.of(dataDir).toAbsolutePath().normalize();
    }

    private JsonNode evaluationCases() {
        try {
            JsonNode cases = mapper.readTree(Files.readString(dataDir.resolve("eval-set.json")));
            if (cases == null || !cases.isArray()) throw new IllegalStateException("Evaluation set must be an array");
            return cases;
        } catch (IOException exception) {
            throw new IllegalStateException("Cannot read evaluation set", exception);
        }
    }

    public List<String> samples() {
        List<String> names = new ArrayList<>();
        evaluationCases().forEach(entry -> names.add(entry.path("file").asText()));
        return names;
    }

    public JsonNode sample(String file) {
        if (file == null || file.isBlank() || file.contains("/") || file.contains("\\") || file.contains("..")) {
            throw new IllegalArgumentException("Invalid sample file name");
        }
        Path path = dataDir.resolve("alerts").resolve(file);
        if (!Files.isRegularFile(path)) throw new NoSuchElementException("Sample not found: " + file);
        try {
            if (!path.toRealPath().getParent().equals(dataDir.resolve("alerts").toRealPath())) {
                throw new IllegalArgumentException("Invalid sample file name");
            }
            JsonNode alert = mapper.readTree(Files.readString(path));
            if (alert == null || !alert.isObject()) throw new IllegalStateException("Sample must be a JSON object");
            return alert;
        } catch (IOException exception) {
            throw new IllegalStateException("Cannot read sample: " + file, exception);
        }
    }

    public synchronized int simulate(double gapSeconds) {
        if (!Double.isFinite(gapSeconds) || gapSeconds < 0) {
            throw new IllegalArgumentException("gapSeconds must be a finite non-negative number");
        }
        List<String> files = new ArrayList<>();
        evaluationCases().forEach(entry -> {
            if (entry.path("demo").asBoolean()) files.add(entry.path("file").asText());
        });
        files.sort(Comparator.comparingInt(file -> {
            int index = ORDER.indexOf(file.split("-", 2)[0]);
            return index < 0 ? Integer.MAX_VALUE : index;
        }));
        if (gapSeconds * 1_000_000_000.0 * Math.max(0, files.size() - 1) > Long.MAX_VALUE) {
            throw new IllegalArgumentException("Simulation interval is too large");
        }
        List<JsonNode> alerts = files.stream().map(this::sample).toList();
        long batchGeneration = generation;
        scheduled.removeIf(ScheduledFuture::isDone);
        for (int index = 0; index < alerts.size(); index++) {
            JsonNode alert = alerts.get(index);
            long delay = (long) (index * gapSeconds * 1_000_000_000.0);
            scheduled.add(scheduler.schedule(() -> ingestFresh(alert, batchGeneration), delay, TimeUnit.NANOSECONDS));
        }
        return alerts.size();
    }

    private synchronized void ingestFresh(JsonNode original, long batchGeneration) {
        if (batchGeneration != generation) return;
        var alert = ((com.fasterxml.jackson.databind.node.ObjectNode) original).deepCopy();
        alert.put("timestamp", Instant.now().toString());
        incidents.ingest(alert);
    }

    public synchronized void stop() {
        generation++;
        scheduled.forEach(task -> task.cancel(false));
        scheduled.clear();
    }

    @Override
    @PreDestroy
    public synchronized void close() {
        stop();
        scheduler.shutdownNow();
    }
}
