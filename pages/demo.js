/*
 * Static demo backend for GitHub Pages.
 *
 * Replaces fetch("/api/...") and EventSource("/api/stream") with an in-browser
 * copy of the Java app's incident lifecycle (IncidentService + TicketWriter).
 * Triage results are not invented: demo-data.json is produced at build time by
 * running the real triage service (offline rule-based mode) over each bundled
 * sample alert. Alerts that are not bundled samples are routed to L2.
 */
(() => {
  "use strict";
  const realFetch = window.fetch.bind(window);
  const ready = realFetch("demo-data.json").then((r) => {
    if (!r.ok) throw new Error(`demo-data.json: HTTP ${r.status}`);
    return r.json();
  });
  const incidents = new Map();
  const listeners = new Set();
  const timers = new Set();
  let sequence = 410;
  let generation = 0;

  const now = () => new Date().toISOString();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); };
  const publish = (type, payload) => listeners.forEach((l) => l(type, payload));
  const audit = (incident, actor, event) => incident.audit.push({ at: now(), actor, event });
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fail = (status, message) => json({ error: message }, status);

  function findTriage(data, alert) {
    const entry = Object.entries(data.alerts).find(([, sample]) =>
      (alert.alert_id && sample.alert_id === alert.alert_id) || JSON.stringify(sample) === JSON.stringify(alert));
    if (entry) return clone(data.triage[entry[0]]);
    const severity = String(alert.severity || "").toUpperCase();
    return {
      mode: "static demo", classification: "other", confidence: 0,
      summary: "This static build cannot run triage on new alerts, so it routes them to L2 rather than guessing. Run the full stack to triage this alert.",
      alertSeverity: alert.severity ?? null, severity: ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severity) ? severity : "MEDIUM",
      playbookId: "NONE", playbookName: null, techniques: [], iocs: {}, cves: [],
      injectionDetected: false, injectionFindings: [], injectionReason: null, steps: [], rejectedSteps: [],
      escalated: true, escalationReason: "Not a bundled sample; the static demo has no live triage service.",
      retrieval: [], millis: 0, error: null
    };
  }

  function ingest(data, alert) {
    const at = new Date();
    const rule = String(alert.rule || "").trim();
    const incident = {
      id: `INC-${String(++sequence).padStart(4, "0")}`, alertId: String(alert.alert_id ?? ""),
      alertRule: rule || String(alert.title ?? ""), source: String(alert.source ?? ""),
      receivedAt: at.toISOString(), receivedAtMillis: at.getTime(), status: "TRIAGING",
      rawAlert: clone(alert), triage: null, steps: [], audit: [], containedAt: null, timeToContainMillis: null
    };
    audit(incident, "system", "Alert received");
    incidents.set(incident.id, incident);
    publish("incident", incident);
    const run = generation;
    later(700 + Math.random() * 700, () => { if (run === generation) completeTriage(incident, findTriage(data, alert)); });
    return incident;
  }

  /** Mirrors IncidentService.completeTriage. */
  function completeTriage(incident, result) {
    const verified = [], rejected = [...(result.rejectedSteps || [])];
    for (const step of result.steps || []) {
      if (step.verified) verified.push(step);
      else rejected.push({ ...step, rejectReason: "Step was not verified by the triage service" });
    }
    result.steps = verified;
    result.rejectedSteps = rejected;
    incident.triage = result;
    incident.steps = verified.map((s, index) => ({ index, action: s.action, sectionId: s.sectionId, sectionTitle: s.sectionTitle,
      quote: s.quote, highImpact: s.highImpact, status: "PENDING", decidedBy: null, decidedAt: null }));
    if (result.injectionDetected) audit(incident, "system", `Tampering attempt detected: ${result.injectionReason}`);
    rejected.forEach((d) => audit(incident, "system", `Dropped step ${d.sectionId}: ${d.rejectReason}`));
    if (result.escalated || !verified.length) {
      incident.status = "ESCALATED";
      if (!result.escalated) { result.escalated = true; result.escalationReason = "No verified containment steps; routed to L2"; }
      audit(incident, "system", `Escalation: ${result.escalationReason}`);
    } else incident.status = "AWAITING_APPROVAL";
    audit(incident, "system", `Triage complete in ${result.millis} ms`);
    publish("incident", incident);
  }

  /** Mirrors IncidentService.decide. */
  function decide(id, index, approve, analyst) {
    const incident = incidents.get(id);
    if (!incident) return fail(404, `Incident not found: ${id}`);
    if (!analyst || !analyst.trim()) return fail(400, "Analyst name is required");
    if (incident.status !== "AWAITING_APPROVAL") return fail(400, "Incident is not awaiting approval");
    const step = incident.steps[index];
    if (!step) return fail(404, `Step not found: ${index}`);
    if (step.status !== "PENDING") return fail(400, "Step has already been decided");
    step.status = approve ? "APPROVED" : "REJECTED";
    step.decidedBy = analyst.trim();
    step.decidedAt = now();
    audit(incident, step.decidedBy, `${approve ? "Approved" : "Rejected"} step ${index}: ${step.action}`);
    if (incident.steps.every((s) => s.status !== "PENDING")) {
      incident.status = "CONTAINED";
      incident.containedAt = now();
      incident.timeToContainMillis = Math.max(0, Date.now() - incident.receivedAtMillis);
      audit(incident, "system", "All containment steps decided; incident contained");
    }
    publish("incident", incident);
    return json(incident);
  }

  function stats() {
    let open = 0, injections = 0, escalated = 0, verified = 0, dropped = 0, contain = 0, contained = 0, triage = 0, triaged = 0;
    for (const i of incidents.values()) {
      if (i.status !== "CONTAINED") open++;
      if (i.status === "ESCALATED") escalated++;
      if (i.timeToContainMillis != null) { contain += i.timeToContainMillis; contained++; }
      if (i.triage) {
        if (i.triage.injectionDetected) injections++;
        verified += i.triage.steps.length; dropped += i.triage.rejectedSteps.length;
        triage += i.triage.millis; triaged++;
      }
    }
    return { total: incidents.size, open, injectionsBlocked: injections, escalated, verifiedSteps: verified, droppedSteps: dropped,
      avgTimeToContainMillis: contained ? contain / contained : 0, avgTriageMillis: triaged ? triage / triaged : 0 };
  }

  /** Mirrors TicketWriter. */
  function ticket(i) {
    const t = i.triage;
    const text = (v) => v == null ? "—" : String(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/([\\|`*_[\]#])/g, "\\$1").replace(/[\r\n]+/g, " ");
    const row = (f, v) => `| ${f} | ${text(v)} |\n`;
    const original = t?.alertSeverity || i.rawAlert?.severity || "—";
    let md = `# ${text(i.id)} — ${text(i.alertRule)}\n\n| Field | Value |\n| --- | --- |\n`;
    md += row("Alert", `${i.alertId} (${i.source})`) + row("Received", i.receivedAt) + row("Status", i.status)
      + row("Severity", `${t ? t.severity : "Pending"} (original alert: ${original})`)
      + row("Classification + confidence", t ? `${t.classification} — ${Math.round(t.confidence * 100)}%` : "Pending")
      + row("Playbook", t ? `${t.playbookId} — ${t.playbookName ?? "—"}` : "Pending")
      + row("Time to contain", i.timeToContainMillis == null ? "Pending" : `${i.timeToContainMillis} ms`);
    md += `\n## Summary\n\n${text(t ? t.summary : "Triage has not completed.")}\n`;
    md += `\n## Tampering attempt\n\n${text(t?.injectionDetected ? t.injectionReason : "None detected.")}\n`;
    if (t?.injectionDetected) md += t.injectionFindings.map((f) => `- ${text(f.field)}: ${text(f.rule)} — ${text(f.snippet)}\n`).join("");
    md += `\n## Escalation\n\n${text(t?.escalated ? t.escalationReason : "None.")}\n`;
    md += "\n## Indicators of compromise\n\n" + (t && Object.keys(t.iocs).length
      ? Object.entries(t.iocs).flatMap(([k, vs]) => vs.map((v) => `- ${text(k)}: ${text(v)}\n`)).join("") : "None recorded.\n");
    md += "\n## MITRE ATT&CK\n\n" + (t?.techniques.length ? t.techniques.map((x) => `- ${text(x.id)} — ${text(x.name)}\n`).join("") : "None recorded.\n");
    md += "\n## Threat intel\n\n" + (t?.cves.length ? t.cves.map((c) => `### ${text(c.id)} — ${text(c.title)}\n\nProduct: ${text(c.product)}; CVSS: ${c.cvss}; known exploited: ${c.knownExploited}.\n\n${text(c.summary)}\n\nRemediation: ${text(c.remediation)}\n`).join("") : "No matching CVEs.\n");
    md += "\n## Containment actions\n\n| # | Action | SOP section | Status | Approved by |\n| --- | --- | --- | --- | --- |\n";
    md += i.steps.map((s) => `| ${s.index} | ${text(s.action)}${s.highImpact ? " (approval required)" : ""} | ${text(s.sectionId)} — ${text(s.sectionTitle)} | ${s.status} | ${s.status === "APPROVED" ? text(s.decidedBy) : "—"} |\n`).join("");
    md += "\n## Audit log\n\n" + i.audit.map((a) => `- ${text(a.at)} · ${text(a.actor)} · ${text(a.event)}\n`).join("");
    return md + "\n---\nEvery containment step was verified against an approved SOP.\n";
  }

  function simulate(data, gapSeconds) {
    const run = generation;
    data.simulation.forEach((file, n) => later(n * gapSeconds * 1000, () => { if (run === generation) ingest(data, clone(data.alerts[file])); }));
    return data.simulation.length;
  }

  async function route(method, url, body) {
    const data = await ready;
    const path = url.pathname;
    const list = () => [...incidents.values()].sort((a, b) => b.receivedAtMillis - a.receivedAtMillis || b.id.localeCompare(a.id));
    let m;
    if (method === "GET" && path === "/api/status") {
      return json({ triageMode: "static demo", triageService: { ...data.health, retrievalMode: `${data.health.retrievalMode} (precomputed)` }, samples: data.samples, stats: stats() });
    }
    if (method === "GET" && path === "/api/incidents") return json(list());
    if (method === "POST" && path === "/api/alerts") {
      if (!body || typeof body !== "object" || Array.isArray(body)) return fail(400, "Alert must be a JSON object");
      return json(ingest(data, body), 202);
    }
    if (method === "POST" && path === "/api/triage") return json(findTriage(data, body || {}));
    if (method === "POST" && path === "/api/simulate") return json({ scheduled: simulate(data, Number(url.searchParams.get("gapSeconds") ?? 4)) });
    if (method === "POST" && path === "/api/incidents/clear") {
      generation++; timers.forEach(clearTimeout); timers.clear(); incidents.clear(); publish("cleared", {});
      return json({ cleared: true });
    }
    if ((m = /^\/api\/incidents\/([^/]+)\/steps\/(\d+)\/(approve|reject)$/.exec(path)) && method === "POST") {
      return decide(decodeURIComponent(m[1]), Number(m[2]), m[3] === "approve", url.searchParams.get("analyst"));
    }
    if ((m = /^\/api\/incidents\/([^/]+)\/ticket$/.exec(path)) && method === "GET") {
      const incident = incidents.get(decodeURIComponent(m[1]));
      return incident ? new Response(ticket(incident), { headers: { "Content-Type": "text/markdown" } }) : fail(404, "Incident not found");
    }
    if ((m = /^\/api\/incidents\/([^/]+)$/.exec(path)) && method === "GET") {
      const incident = incidents.get(decodeURIComponent(m[1]));
      return incident ? json(incident) : fail(404, "Incident not found");
    }
    if ((m = /^\/api\/samples\/([^/]+)$/.exec(path)) && method === "GET") {
      const alert = data.alerts[decodeURIComponent(m[1])];
      return alert ? json(alert) : fail(404, "Sample not found");
    }
    if (method === "GET" && path === "/api/playbooks") return json(data.playbooks);
    if (method === "POST" && path === "/api/eval") { await new Promise((r) => setTimeout(r, 900)); return json(data.eval); }
    return fail(404, `No demo route for ${method} ${path}`);
  }

  window.fetch = async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url, location.href);
    if (!url.pathname.startsWith("/api/")) return realFetch(input, options);
    let body;
    try { body = options.body ? JSON.parse(options.body) : undefined; } catch { return fail(400, "Malformed JSON"); }
    try { return await route((options.method || "GET").toUpperCase(), url, body); }
    catch (error) { return fail(503, `Demo data unavailable: ${error.message}`); }
  };

  window.EventSource = class DemoEventSource {
    constructor(url) {
      this.url = url;
      this.handlers = {};
      this.forward = (type, payload) => this.handlers[type]?.forEach((h) => h({ data: JSON.stringify(payload) }));
      ready.then(() => {
        listeners.add(this.forward);
        this.onopen?.();
        // Greet first-time visitors with a short live stream instead of an empty feed.
        if (!incidents.size && !sessionStorage.getItem("aegis.demo.seeded")) {
          sessionStorage.setItem("aegis.demo.seeded", "1");
          ready.then((data) => simulate(data, 1.1));
        }
      }, () => this.onerror?.());
    }
    addEventListener(type, handler) { (this.handlers[type] ||= []).push(handler); }
    close() { listeners.delete(this.forward); }
  };

  document.addEventListener("DOMContentLoaded", () => {
    const notice = document.getElementById("demoNotice");
    if (notice) notice.hidden = false;
  });
})();
