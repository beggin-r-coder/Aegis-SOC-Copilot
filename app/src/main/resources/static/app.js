"use strict";

const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "—").replace(/[&<>"']/g, (c) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[c]);
const e = escapeHtml;
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const formatNumber = (value) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(number(value));
const duration = (value) => number(value) >= 1000 ? `${(number(value) / 1000).toFixed(2)} s` : `${Math.round(number(value))} ms`;
const human = (value) => String(value ?? "Pending").replaceAll("_", " ");
const time = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString("en-GB", { timeZone: "UTC", hour12: false });
};
const LABELS = { ddos: "DDoS", public_s3_bucket: "Public S3 bucket", credential_stuffing: "Credential stuffing", phishing: "Phishing", ransomware: "Ransomware", other: "Other" };
const label = (value) => LABELS[String(value ?? "").toLowerCase()] || human(value);
const plural = (count, word) => `${formatNumber(count)} ${word}${number(count) === 1 ? "" : "s"}`;
const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  shield: '<path d="M12 3l7.5 2.8v5.7c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V5.8L12 3z"/>',
  shieldCheck: '<path d="M12 3l7.5 2.8v5.7c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V5.8L12 3z"/><path d="m8.8 12.2 2.2 2.2 4.4-4.6"/>',
  shieldX: '<path d="M12 3l7.5 2.8v5.7c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V5.8L12 3z"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  layers: '<path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 17v4M17 19h4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  server: '<rect x="3" y="4" width="18" height="7" rx="2"/><rect x="3" y="13" width="18" height="7" rx="2"/><path d="M7 7.5h.01M7 16.5h.01"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  external: '<path d="M7 17 17 7M8 7h9v9"/>',
  chevron: '<path d="m6 9 6 6 6-6"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  bug: '<rect x="7" y="6" width="10" height="14" rx="5"/><path d="M12 20v-8M3 13h4M17 13h4M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2M9 6a3 3 0 0 1 6 0"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z"/><path d="M20 17v4H6.5A2.5 2.5 0 0 1 4 18.5"/>',
  chart: '<path d="M3 3v18h18"/><path d="M7 16v-4M12 16V8M17 16v-7"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.1z"/>',
  plug: '<path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ""}</svg>`;
const state = { incidents: new Map(), updates: new Map(), revision: 0, generation: 0, selected: null,
  stats: {}, samples: [], view: "feed", sort: "newest", playbooksLoaded: false, decisions: new Set(), guardOpen: new Map(),
  tab: "response", seen: new Set(), loaded: false, shown: {} };
let toastTimer;
let statusTimer;
let statusRequest = 0;
let sampleRequest = 0;
let sampleLoading = false;
let submittingAlert = false;
let containmentInterval = null;
const ticket = { id: null, markdown: "", request: 0, ready: false };

async function responseError(response) {
  let message = `Request failed (${response.status}).`;
  try { message = (await response.json()).error || message; } catch { /* Error pages may not be JSON. */ }
  const error = new Error(message);
  error.status = response.status;
  return error;
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { Accept: "application/json", ...options.headers } });
  if (!response.ok) throw await responseError(response);
  let body;
  try { body = await response.json(); } catch { throw new Error(`The server returned an unreadable response (${response.status}).`); }
  return body;
}
const post = (path, body) => api(path, { method: "POST", ...(body === undefined ? {} : {
  headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
}) });

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $("toast").innerHTML = `<span class="toast-icon">${icon(error ? "x" : "check")}</span><span>${e(message)}</span>`;
  $("toast").className = `toast${error ? " error" : ""}`;
  $("toast").hidden = true;
  void $("toast").offsetWidth; // Restart the entrance animation.
  $("toast").hidden = false;
  toastTimer = setTimeout(() => { $("toast").hidden = true; }, error ? 8000 : 4500);
}
async function busy(button, work) {
  if (button.disabled) return;
  button.disabled = true;
  try { await work(); } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
}
function severity(value) {
  const name = String(value ?? "").toUpperCase();
  const allowed = ["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(name);
  return `<span class="severity ${allowed ? name.toLowerCase() : "unknown"}">${e(allowed ? name : "PENDING")}</span>`;
}
function statusPill(value) {
  const styles = { TRIAGING: "triaging", AWAITING_APPROVAL: "awaiting", CONTAINED: "contained", ESCALATED: "escalated", FAILED: "failed" };
  const marker = value === "TRIAGING" ? '<span class="spinner" aria-hidden="true"></span>' : '<span class="status-dot" aria-hidden="true"></span>';
  return `<span class="status ${styles[value] || ""}">${marker}${e(human(value).toLowerCase())}</span>`;
}
function severityName(incident) {
  const name = String(incident?.triage?.severity || incident?.rawAlert?.severity || "").toLowerCase();
  return ["critical", "high", "medium", "low"].includes(name) ? name : "unknown";
}
/** Animates a KPI number from its last shown value; falls back to plain text without rAF. */
function countTo(id, target) {
  const node = $(id);
  const end = number(target);
  const start = state.shown[id] ?? 0;
  state.shown[id] = end;
  if (typeof requestAnimationFrame !== "function" || typeof performance === "undefined" || start === end) {
    node.textContent = formatNumber(end);
    return;
  }
  const began = performance.now();
  const frame = (now) => {
    const progress = Math.min(1, (now - began) / 650);
    node.textContent = formatNumber(Math.round(start + (end - start) * (1 - Math.pow(1 - progress, 3))));
    if (progress < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
function triageErrorMessage(error) {
  const message = String(error || "");
  if (message.includes("Could not parse response content as the length limit was reached")) {
    return "The model response reached its output limit. Verified offline guidance is shown.";
  }
  return message;
}
function renderStats() {
  const s = state.stats;
  countTo("kpiOpen", s.open);
  $("kpiTotal").textContent = `${plural(s.total, "incident")} in this session`;
  $("kpiTriage").textContent = number(s.total) ? duration(s.avgTriageMillis) : "—";
  $("kpiContain").textContent = number(s.avgTimeToContainMillis) ? `Avg time to contain · ${duration(s.avgTimeToContainMillis)}` : "Alert received → grounded response";
  const verified = number(s.verifiedSteps);
  $("kpiVerified").textContent = verified ? "100%" : "—";
  $("kpiDropped").textContent = verified || number(s.droppedSteps)
    ? `${plural(verified, "step")} verified · ${formatNumber(s.droppedSteps)} unsupported blocked`
    : "Every shown step quotes a verified SOP";
  countTo("kpiInjection", s.injectionsBlocked);
  $("kpiEscalated").textContent = `${plural(s.escalated, "incident")} escalated to L2`;
}
function scheduleStatus() {
  clearTimeout(statusTimer);
  statusTimer = setTimeout(() => refreshStatus().catch((error) => toast(error.message, true)), 250);
}
async function refreshStatus() {
  const request = ++statusRequest;
  const data = await api("/api/status");
  if (request !== statusRequest) return;
  state.stats = data.stats || {};
  state.samples = Array.isArray(data.samples) ? data.samples : [];
  $("triageMode").textContent = data.triageMode || "Unavailable";
  $("retrievalMode").textContent = data.triageService?.retrievalMode || (data.triageMode === "fake" ? "Canned demo results" : "Service unavailable");
  const selected = $("sampleSelect").value;
  $("sampleSelect").innerHTML = '<option value="">Choose a sample alert…</option>' + state.samples.map((file) => `<option value="${e(file)}">${e(file)}</option>`).join("");
  $("sampleSelect").value = selected;
  $("lastSync").textContent = `Status checked ${time(new Date().toISOString())} UTC`;
  renderStats();
}
async function refreshIncidents() {
  const revision = state.revision;
  const generation = state.generation;
  const incidents = await api("/api/incidents");
  if (generation !== state.generation) return;
  for (const incident of incidents) {
    if ((state.updates.get(incident.id) || 0) <= revision) state.incidents.set(incident.id, incident);
  }
  if (!state.selected && incidents.length) state.selected = orderedIncidents()[0]?.id;
  renderFeed();
  state.loaded = true;
}
function orderedIncidents() {
  const levels = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  return [...state.incidents.values()].sort((a, b) => {
    if (state.sort === "severity") {
      const difference = (levels[String(b.triage?.severity || b.rawAlert?.severity).toUpperCase()] || 0)
        - (levels[String(a.triage?.severity || a.rawAlert?.severity).toUpperCase()] || 0);
      if (difference) return difference;
    }
    return number(b.receivedAtMillis) - number(a.receivedAtMillis)
      || number(String(b.id).split("-")[1]) - number(String(a.id).split("-")[1]);
  });
}
function containmentTime(incident, now = Date.now()) {
  const elapsed = incident.status === "CONTAINED" ? incident.timeToContainMillis : now - number(incident.receivedAtMillis);
  if (elapsed == null || !Number.isFinite(Number(elapsed))) return "—";
  const seconds = Math.floor(Math.max(0, Number(elapsed)) / 1000);
  const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60];
  return parts.map((part) => String(part).padStart(2, "0")).join(":");
}
function stopContainmentTimer() {
  if (containmentInterval != null) clearInterval(containmentInterval);
  containmentInterval = null;
}
function startContainmentTimer(incident) {
  if (incident.status !== "AWAITING_APPROVAL") return;
  containmentInterval = setInterval(() => {
    if (state.selected !== incident.id) { stopContainmentTimer(); return; }
    const timer = $("containmentTimer");
    if (timer) timer.textContent = `Time to contain · ${containmentTime(incident)}`;
  }, 1000);
}
function upsertIncident(incident, select = false) {
  if (!incident || typeof incident.id !== "string") return;
  const existing = state.incidents.get(incident.id);
  if (existing && (existing.audit || []).length > (incident.audit || []).length) {
    if (select) { state.selected = incident.id; renderFeed(); }
    return;
  }
  state.updates.set(incident.id, ++state.revision);
  state.incidents.set(incident.id, incident);
  if (!state.selected || select) state.selected = incident.id;
  renderList();
  if (state.selected === incident.id) renderDetail();
  scheduleStatus();
}
function resetFeed() {
  ++state.generation;
  ++state.revision;
  state.incidents.clear();
  state.updates.clear();
  state.guardOpen.clear();
  state.seen.clear();
  state.selected = null;
  state.stats = {};
  renderFeed();
  renderStats();
  scheduleStatus();
}
function filteredIncidents() {
  const query = $("incidentSearch").value.toLowerCase().trim();
  return orderedIncidents().filter((i) => [i.id, i.alertRule, i.source, i.triage?.classification].some((v) => String(v || "").toLowerCase().includes(query)));
}
function renderSeverityBar(all) {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const incident of all) if (incident.status !== "CONTAINED" && severityName(incident) in counts) counts[severityName(incident)]++;
  $("sevBar").innerHTML = Object.entries(counts).filter(([, n]) => n).map(([name, n]) => `<span class="${name}" style="flex-grow:${n}" title="${n} ${name}"></span>`).join("");
}
function renderList() {
  const all = orderedIncidents();
  const query = $("incidentSearch").value.toLowerCase().trim();
  const filtered = filteredIncidents();
  $("navCount").textContent = all.length;
  $("listCount").textContent = all.length;
  renderSeverityBar(all);
  let entering = 0;
  $("incidentList").innerHTML = filtered.length ? filtered.map((i) => {
    const isNew = !state.seen.has(i.id);
    const motion = isNew ? ` enter${state.loaded ? " fresh" : ""}" style="animation-delay:${Math.min(entering++, 10) * 35}ms` : "";
    return `<button class="incident-row sev-${severityName(i)}${i.id === state.selected ? " selected" : ""}${motion}" data-incident="${e(i.id)}" aria-pressed="${i.id === state.selected}">
    <span class="incident-row-top"><span class="incident-id">${e(i.id)}</span><time class="incident-time">${e(time(i.receivedAt))}</time></span>
    <div class="incident-rule">${e(i.alertRule || "Untitled alert")}</div>
    <div class="incident-meta">${e(i.source)} <span aria-hidden="true">·</span> ${e(i.triage ? label(i.triage.classification) : "Awaiting triage")}</div>
    <div class="incident-bottom"><span class="incident-tags">${severity(i.triage?.severity || i.rawAlert?.severity)}${statusPill(i.status)}</span><span class="incident-time">${i.triage ? e(duration(i.triage.millis)) : ""}</span></div></button>`;
  }).join("") :
    `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon(query ? "search" : "inbox")}</span><h2>${query ? "No matching incidents" : "All quiet. Stay ready."}</h2><p>${query ? "Try a different incident ID, source, or rule." : "Incoming alerts appear here. Submit an alert or start a simulation."}</p></div>`;
  for (const incident of all) state.seen.add(incident.id);
}
function renderFeed() { renderList(); renderDetail(); }
function highlightJson(value) {
  const json = JSON.stringify(value, null, 2) ?? "null";
  const pattern = /("(?:\\.|[^"\\])*")(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let html = "", last = 0;
  for (const match of json.matchAll(pattern)) {
    html += e(json.slice(last, match.index));
    const kind = match[1] ? (match[2] ? "j-key" : "j-str") : /^[tfn]/.test(match[0]) ? "j-lit" : "j-num";
    html += `<span class="${kind}">${e(match[1] || match[0])}</span>${match[2] ? e(match[2]) : ""}`;
    last = match.index + match[0].length;
  }
  return html + e(json.slice(last));
}
function rawAlertHtml(incident, fold = "raw") {
  return `<details class="guard" data-fold="${fold}"><summary><span class="sum-icon">${icon("code")}</span>Raw alert JSON<span class="sum-sub">untrusted input</span>${icon("chevron").replace("<svg", '<svg class="chev"')}</summary><pre class="raw-alert">${highlightJson(incident.rawAlert)}</pre></details>`;
}
function pipelineHtml(i, t) {
  const llmUsed = t ? String(t.mode).startsWith("openai") : false;
  const iocCount = t ? Object.values(t.iocs || {}).reduce((n, v) => n + v.length, 0) : 0;
  const proposed = t ? (i.steps || []).length + (t.rejectedSteps || []).length : 0;
  const stages = t ? [
    ["Parse", "code", "done", "JSON object"],
    ["Injection scan", "scan", t.injectionDetected ? "flag" : "done", t.injectionDetected ? plural((t.injectionFindings || []).length, "finding") : "Clean"],
    ["IoCs", "target", "done", `${formatNumber(iocCount)} extracted`],
    ["Hybrid retrieval", "layers", t.mode === "fake" ? "skipped" : "done", t.mode === "fake" ? "Demo mode" : plural((t.retrieval || []).length, "section")],
    ["LLM triage", "sparkles", llmUsed ? "done" : "skipped", llmUsed ? "OpenAI" : t.mode === "fake" ? "Canned" : "Offline rules"],
    ["Verify citations", "shieldCheck", "done", proposed ? `${(i.steps || []).length}/${proposed} verified` : "Nothing to verify"]
  ] : ["Parse", "Injection scan", "IoCs", "Hybrid retrieval", "LLM triage", "Verify citations"].map((label, n) =>
    [label, ["code", "scan", "target", "layers", "sparkles", "shieldCheck"][n], n === 0 ? "done" : n === 1 ? "running" : "pending", n === 0 ? "JSON object" : n === 1 ? "Running…" : "Queued"]);
  return `<div class="pipeline" aria-label="Triage pipeline">${stages.map(([label, glyph, status, sub], n) =>
    `<div class="pipe-step ${status}" style="--i:${n}" title="${e(`${label}: ${sub}`)}"><span class="pipe-node">${icon(status === "done" ? "check" : status === "flag" ? "alert" : glyph)}</span><span class="pipe-label">${e(label)}</span><span class="pipe-sub">${e(sub)}</span></div>`).join("")}</div>`;
}
function bannerHtml(kind, glyph, title, body, extra = "", fresh = false) {
  return `<div class="banner ${kind}${fresh ? " is-new" : ""}"><span class="banner-icon">${icon(glyph)}</span><div class="banner-body"><h3>${title}</h3><p>${body}</p>${extra}</div></div>`;
}
function renderDetail() {
  stopContainmentTimer();
  const root = $("incidentDetail");
  const folds = new Set([...root.querySelectorAll("details[open]")].map((node) => node.dataset.fold));
  const i = state.incidents.get(state.selected);
  if (!i) {
    root.dataset.rendered = "";
    root.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">${icon("shield")}</span><h2>Your incident workspace</h2><p>Select an incident to inspect the evidence, review cited guidance, and approve the response.</p><div class="empty-actions"><button class="button primary" data-action="simulate">${icon("zap")}Simulate attack</button><button class="button secondary" data-action="open-submit">${icon("plus")}Submit your first alert</button></div></div>`;
    return;
  }
  const t = i.triage;
  const key = `${i.id}|${i.status}|${state.tab}`;
  const fresh = root.dataset.rendered !== key;
  const freshIncident = !String(root.dataset.rendered || "").startsWith(`${i.id}|${i.status}|`);
  root.dataset.rendered = key;
  root.classList.toggle("is-fresh", freshIncident);
  const timer = ["AWAITING_APPROVAL", "CONTAINED"].includes(i.status)
    ? `<div id="containmentTimer" class="containment-timer${i.status === "CONTAINED" ? " complete" : ""}" role="timer" aria-live="off">${i.status === "CONTAINED" ? "Contained in" : "Time to contain"} · ${e(containmentTime(i))}</div>` : "";
  const alertSeverity = String(t?.alertSeverity || i.rawAlert?.severity || "").toUpperCase();
  const finalSeverity = String(t?.severity || "").toUpperCase();
  const severityShift = t && alertSeverity && finalSeverity && alertSeverity !== finalSeverity
    ? `<span title="Alert severity → triaged severity">${icon("arrowUp")}${e(alertSeverity.toLowerCase())} <span class="arrow">→</span> ${e(finalSeverity.toLowerCase())}</span>` : "";
  const heading = `<div class="detail-heading"><div><div class="id-line"><span class="incident-code">${e(i.id)}</span>${severity(t?.severity || i.rawAlert?.severity)}${statusPill(i.status)}</div><h2>${e(i.alertRule || "Incident detail")}</h2>
    <div class="meta-row"><span>${icon("server")}${e(i.source)}</span><span>${icon("clock")}${e(time(i.receivedAt))} UTC</span>${t ? `<span>${icon("zap")}Triaged in ${e(duration(t.millis))}</span>` : ""}${severityShift}</div></div>
    <div class="heading-actions"><button class="button secondary small" data-action="ticket">${icon("file")}Generate ticket</button>${timer}</div></div>`;
  if (i.status === "TRIAGING") {
    root.innerHTML = heading + `<div class="detail-content stagger">${pipelineHtml(i, null)}<div class="triaging-message"><span class="spinner" aria-hidden="true"></span> Analyzing the signal and checking approved guidance…</div><div class="skeleton" aria-hidden="true"><span></span><span></span><span></span></div>${rawAlertHtml(i)}</div>`;
    return;
  }
  if (!t) {
    root.innerHTML = heading + `<div class="detail-content stagger">${bannerHtml("danger", "alert", "Triage could not complete", "Review the audit log and route this incident to L2.")}${auditHtml(i.audit)}${rawAlertHtml(i)}</div>`;
    return;
  }
  const steps = i.steps || [];
  const rejected = t.rejectedSteps || [];
  const iocCount = Object.values(t.iocs || {}).reduce((n, v) => n + v.length, 0);
  const banners = [
    t.injectionDetected ? bannerHtml("danger", "shieldX", "Tampering attempt detected", e(t.injectionReason || "Instructions aimed at the copilot were found in alert content."),
      `<ul class="findings">${(t.injectionFindings || []).map((f) => `<li><span class="field">${e(f.field)}</span><span class="rule">${e(f.rule)}</span><span class="snippet">“${e(f.snippet)}”</span></li>`).join("")}</ul>`, freshIncident) : "",
    t.escalated || i.status === "ESCALATED" ? bannerHtml("info", "arrowUp", "Escalated to L2", e(t.escalationReason || "Further analyst review is required.")) : "",
    t.error ? bannerHtml("warning", "alert", "Running on offline fallback", e(triageErrorMessage(t.error))) : ""
  ].join("");
  const tabs = [["response", "Response", steps.length, rejected.length > 0], ["evidence", "Evidence & intel", iocCount + (t.techniques || []).length + (t.cves || []).length, false], ["activity", "Activity", (i.audit || []).length, false]];
  const tabBar = `<div class="tabs" role="tablist">${tabs.map(([id, label, count]) => `<button class="tab${state.tab === id ? " active" : ""}" role="tab" aria-selected="${state.tab === id}" data-tab="${id}">${label}<span class="count-badge">${e(count)}</span></button>`).join("")}</div>`;
  let panel;
  if (state.tab === "evidence") panel = evidenceHtml(t);
  else if (state.tab === "activity") panel = `${auditHtml(i.audit)}${rawAlertHtml(i)}`;
  else panel = responseHtml(i, t, steps, rejected);
  root.innerHTML = heading + `<div class="detail-content stagger">${pipelineHtml(i, t)}${banners}${tabBar}<div class="tab-panel${fresh ? " tab-fresh" : ""}" role="tabpanel">${panel}</div></div>`;
  for (const detail of root.querySelectorAll("details[data-fold]")) {
    if (detail.dataset.fold === "guard") {
      detail.open = state.guardOpen.get(i.id) ?? rejected.length > 0;
      detail.addEventListener("toggle", () => state.guardOpen.set(i.id, detail.open));
    } else detail.open = folds.has(detail.dataset.fold);
  }
  startContainmentTimer(i);
}
function responseHtml(i, t, steps, rejected) {
  const confidence = Math.round(number(t.confidence) * 100);
  const decided = steps.filter((s) => s.status !== "PENDING").length;
  const facts = `<dl class="facts"><div class="fact"><dt>Classification</dt><dd class="fact-value">${e(label(t.classification))}</dd></div>
    <div class="fact"><dt>Confidence</dt><dd class="fact-value">${e(confidence)}%</dd><div class="meter"><span style="width:${Math.max(0, Math.min(100, confidence))}%"></span></div></div>
    <div class="fact"><dt>Playbook</dt><dd class="fact-value mono">${e(t.playbookId)}</dd>${t.playbookName ? `<div class="fact-sub">${e(t.playbookName)}</div>` : ""}</div>
    <div class="fact"><dt>MITRE techniques</dt><dd class="fact-value mono">${(t.techniques || []).map((v) => e(v.id)).join(", ") || "—"}</dd></div></dl>`;
  const checklist = steps.length
    ? `<div class="progress-row"><span>${e(decided)} of ${e(steps.length)} decided</span><div class="meter"><span style="width:${steps.length ? (decided / steps.length) * 100 : 0}%"></span></div></div><div class="steps">${steps.map((step) => stepHtml(i, step)).join("")}</div>`
    : `<div class="empty-inline">${icon("arrowUp")}No verified containment actions. Follow the L2 escalation process.</div>`;
  const guard = `<details class="guard${rejected.length ? " has-rejections" : ""}" data-fold="guard" ${rejected.length ? "open" : ""}><summary><span class="sum-icon">${icon(rejected.length ? "shieldX" : "shieldCheck")}</span>Hallucination guard<span class="sum-sub">${e(plural(rejected.length, "suggestion"))} blocked</span>${icon("chevron").replace("<svg", '<svg class="chev"')}</summary><div class="guard-inner">Suggestions whose quote is not found in the cited playbook section never reach the checklist.${rejected.map((s) => `<div class="rejected-row"><span class="action">${e(s.action)}</span>${s.quote ? `<span class="quote">“${e(s.quote)}”</span>` : ""}<span class="sop-ref"><span class="mono">${e(s.sectionId)}</span></span><strong>${icon("x")}${e(s.rejectReason)}</strong></div>`).join("") || '<p style="margin-top:8px">No proposed steps were rejected.</p>'}</div></details>`;
  return `<section class="detail-section"><div class="assessment"><div class="assessment-head">${icon("sparkles")}Copilot assessment</div><p class="summary-text">${e(t.summary)}</p>${facts}</div></section>
    <section class="detail-section"><div class="section-label"><h3>${icon("list")}Containment checklist</h3><span class="badge ok">${icon("shieldCheck")}${e(plural(steps.length, "verified step"))}</span></div>${checklist}${guard}</section>`;
}
function evidenceHtml(t) {
  const iocs = Object.entries(t.iocs || {}).map(([kind, values]) => `<div class="ioc-group"><div class="ioc-kind">${e(kind)}</div><div class="ioc-values">${values.map((v) => `<button type="button" class="ioc-chip" data-copy="${e(v)}" title="Copy ${e(v)}"><span>${e(v)}</span>${icon("copy")}</button>`).join("")}</div></div>`).join("") || '<p class="small muted">No indicators extracted.</p>';
  const techniques = (t.techniques || []).map((v) => {
    const id = String(v.id || "");
    const inner = `<span class="tid">${e(id)}</span><span class="tname">${e(v.name)}</span>`;
    return /^T\d{4}(\.\d{3})?$/.test(id)
      ? `<a class="technique" href="https://attack.mitre.org/techniques/${id.replace(".", "/")}/" target="_blank" rel="noopener noreferrer">${inner}${icon("external")}</a>`
      : `<div class="technique">${inner}</div>`;
  }).join("") || '<p class="small muted">No techniques confidently mapped.</p>';
  const cvssClass = (score) => number(score) >= 9 ? "c" : number(score) >= 7 ? "h" : number(score) >= 4 ? "m" : "l";
  const cves = (t.cves || []).map((v) => `<article class="cve-card"><div class="cve-title"><span class="cve-id">${e(v.id)}</span><span class="cve-badges"><span class="cvss ${cvssClass(v.cvss)}">CVSS ${e(v.cvss)}</span>${v.knownExploited ? `<span class="badge danger">${icon("alert")}Known exploited</span>` : ""}</span></div><h4>${e(v.title)}</h4><div class="sop-ref">${e(v.product)}</div><p>${e(v.summary)}</p><div class="remediation"><strong>Remediation</strong> · ${e(v.remediation)}</div></article>`).join("") || '<div class="empty-inline">' + icon("bug") + 'No matching CVEs in the local feed.</div>';
  const hits = t.retrieval || [];
  const top = Math.max(...hits.map((h) => number(h.score)), 0) || 1;
  const retrieval = hits.length ? `<div class="table-wrap"><table><thead><tr><th>Section</th><th>Score</th><th>BM25 rank</th><th>Vector rank</th></tr></thead><tbody>${hits.map((hit) => `<tr><td class="mono cyan">${e(hit.sectionId)}</td><td><div class="score-cell"><span class="mono">${e(number(hit.score).toFixed(4))}</span><span class="score-bar"><span style="width:${(number(hit.score) / top) * 100}%"></span></span></div></td><td class="mono">${e(hit.bm25Rank)}</td><td class="mono">${e(hit.vectorRank)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small muted">No retrieval hits recorded for this result.</p>';
  return `<div class="evidence-grid"><section class="panel"><div class="section-label"><h3>${icon("target")}Indicators of compromise</h3><span class="eyebrow">Click to copy</span></div>${iocs}</section><section class="panel"><div class="section-label"><h3>${icon("activity")}MITRE ATT&amp;CK</h3></div>${techniques}</section></div>
    <section class="detail-section"><div class="section-label"><h3>${icon("bug")}Threat intel</h3><span class="eyebrow">Local CVE feed</span></div>${cves}</section>
    <section class="detail-section"><div class="section-label"><h3>${icon("layers")}Retrieval</h3><span class="eyebrow">Hybrid BM25 + vector</span></div>${retrieval}</section>`;
}
function stepHtml(incident, step) {
  const key = `${incident.id}:${step.index}`;
  const canDecide = incident.status === "AWAITING_APPROVAL" && step.status === "PENDING";
  const status = String(step.status || "PENDING").toLowerCase();
  const decision = canDecide
    ? `<div class="step-actions"><button class="button reject" data-action="reject" data-index="${e(step.index)}" ${state.decisions.has(key) ? "disabled" : ""}>Reject</button><button class="button approve" data-action="approve" data-index="${e(step.index)}" ${state.decisions.has(key) ? "disabled" : ""}>${icon("check")}Approve</button></div>`
    : `<span class="decision ${e(status)}">${status === "approved" ? icon("check") : status === "rejected" ? icon("x") : icon("clock")}<strong>${e(human(step.status).toLowerCase().replace(/^./, (c) => c.toUpperCase()))}</strong>${step.decidedBy ? ` by ${e(step.decidedBy)}` : ""}${step.decidedAt ? ` · ${e(time(step.decidedAt))}` : ""}</span>`;
  return `<article class="step-card ${e(status)}"><div class="step-heading"><span class="step-number">${status === "approved" ? icon("check") : e(number(step.index) + 1)}</span><div class="step-main"><div class="step-title">${e(step.action)}</div>${step.highImpact ? `<div class="step-tags"><span class="approval-label">${icon("lock")}Approval required</span></div>` : ""}</div></div>
    <blockquote class="sop-quote"><div class="quote-head"><span class="sop-ref"><span class="mono">${e(step.sectionId)}</span> · ${e(step.sectionTitle)}</span><span class="verified-tag">${icon("shieldCheck")}Quote verified</span></div>“${e(step.quote)}”</blockquote><div class="step-foot">${decision}</div></article>`;
}
function auditHtml(entries) {
  const tone = (a) => /reject|fail|injection|tamper/i.test(a.event) ? "bad" : /approv|contain/i.test(a.event) ? "good" : a.actor !== "system" ? "human" : "";
  return `<section class="detail-section"><div class="section-label"><h3>${icon("history")}Audit log</h3><span class="eyebrow">UTC</span></div><ol class="audit-list">${(entries || []).map((a) => `<li><span class="audit-dot ${tone(a)}" aria-hidden="true"></span><div><span class="audit-actor">${e(a.actor)}</span><span class="audit-event">${e(a.event)}</span></div><time>${e(time(a.at))}</time></li>`).join("")}</ol></section>`;
}
async function decide(index, approve) {
  const id = state.selected;
  const analyst = $("analyst").value.trim();
  if (!analyst) { toast("Enter the analyst name before recording a decision.", true); $("analyst").focus(); return; }
  const key = `${id}:${index}`;
  if (state.decisions.has(key)) return;
  state.decisions.add(key);
  renderDetail();
  try {
    const generation = state.generation;
    const incident = await post(`/api/incidents/${encodeURIComponent(id)}/steps/${encodeURIComponent(index)}/${approve ? "approve" : "reject"}?analyst=${encodeURIComponent(analyst)}`);
    if (generation === state.generation) upsertIncident(incident);
  } catch (error) { toast(error.message, true); }
  finally { state.decisions.delete(key); renderDetail(); }
}

function showView(view) {
  state.view = view;
  for (const name of ["feed", "evaluations", "playbooks"]) $("view-" + name).hidden = name !== view;
  for (const button of document.querySelectorAll("[data-view]")) {
    button.classList.toggle("active", button.dataset.view === view);
    if (button.dataset.view === view) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  }
  $("breadcrumb").textContent = { feed: "Live feed", evaluations: "Evaluations", playbooks: "Playbooks" }[view] || view;
  if (view === "playbooks" && !state.playbooksLoaded) loadPlaybooks();
}
function loadingHtml(message) { return `<div class="empty-state"><span class="empty-icon" aria-hidden="true"><span class="spinner"></span></span><p>${e(message)}</p></div>`; }
function errorHtml(error, action) {
  const disconnected = error.status === 503 || error.status === 404;
  return `<div class="card view-error"><span class="empty-icon" aria-hidden="true">${icon(disconnected ? "plug" : "alert")}</span><h2>${disconnected ? "Triage service not connected yet" : "Unable to load this view"}</h2><p>${e(disconnected ? "Start the Python triage service and switch the app to the http engine, then try again." : error.message)}</p><button class="button secondary" data-action="${e(action)}">Try again</button></div>`;
}
async function loadPlaybooks() {
  $("reloadPlaybooks").disabled = true;
  $("playbookContent").innerHTML = loadingHtml("Loading approved playbooks…");
  try {
    const books = await api("/api/playbooks");
    $("playbookContent").innerHTML = books.map((b) => {
      const sections = b.sections || [];
      const approvals = sections.filter((s) => s.requiresApproval).length;
      return `<article class="card playbook-card"><div class="playbook-meta"><div class="pb-id"><span class="badge accent mono">${e(b.id)}</span><span class="badge plain">${e(label(b.classification))}</span></div><h2>${e(b.name)}</h2><div class="pb-stats"><span><strong>${e(sections.length)}</strong> approved sections</span><span><strong>${e(approvals)}</strong> need approval</span></div><div class="keyword-list">${(b.keywords || []).map((k) => `<span>${e(k)}</span>`).join("")}</div></div>
        <div class="playbook-sections">${sections.map((s) => `<details class="playbook-section${s.requiresApproval ? " approval-section" : ""}"><summary><span class="mono">${e(s.id)}</span><span class="title">${e(s.title)}</span>${s.requiresApproval ? `<span class="approval-label">${icon("lock")}needs approval</span>` : ""}${icon("chevron").replace("<svg", '<svg class="chev"')}</summary><p>${e(s.text)}</p></details>`).join("")}</div></article>`;
    }).join("") || `<div class="card empty-state"><span class="empty-icon" aria-hidden="true">${icon("book")}</span><p>No approved playbooks are available.</p></div>`;
    state.playbooksLoaded = true;
  } catch (error) { $("playbookContent").innerHTML = errorHtml(error, "playbooks"); }
  finally { $("reloadPlaybooks").disabled = false; }
}
/** Renders a metric as a progress ring when it is a percentage or a fraction, otherwise as an icon tile. */
function metricVisual(key, value) {
  const text = String(value ?? "");
  let percent = null;
  const pct = /^(\d+(?:\.\d+)?)%/.exec(text);
  if (pct) percent = Number(pct[1]);
  const fraction = /^(\d+)\s*\/\s*(\d+)$/.exec(text);
  if (fraction && Number(fraction[2]) > 0) percent = (Number(fraction[1]) / Number(fraction[2])) * 100;
  if (percent == null || !Number.isFinite(percent)) return `<span class="metric-icon">${icon(key === "avgTriageMillis" ? "clock" : "shieldX")}</span>`;
  const circumference = 125.66;
  const tone = percent >= 90 ? "good" : percent >= 60 ? "mid" : "low";
  return `<svg class="ring" viewBox="0 0 48 48" aria-hidden="true"><circle class="track" cx="24" cy="24" r="20"/><circle class="value ${tone}" cx="24" cy="24" r="20" style="--circ:${circumference};stroke-dasharray:${circumference};stroke-dashoffset:${(circumference * (1 - Math.min(100, Math.max(0, percent)) / 100)).toFixed(2)}"/></svg>`;
}
/** Splits "70% (7/10)" into a headline value and a quieter count. */
function metricValue(key, value) {
  if (key === "avgTriageMillis") return e(duration(value));
  const parts = /^(\S+)\s+(\(.*\))$/.exec(String(value ?? ""));
  return parts ? `${e(parts[1])}<small>${e(parts[2])}</small>` : e(value);
}
async function runEvaluation() {
  if ($("runEval").disabled) return;
  $("runEval").disabled = true;
  $("evaluationContent").setAttribute("aria-busy", "true");
  $("runEval").innerHTML = '<span class="spinner" aria-hidden="true"></span> Running evaluation…';
  $("evaluationContent").innerHTML = loadingHtml("Evaluating the labeled alert set. This can take up to a minute…");
  try {
    const report = await post("/api/eval");
    const s = report.summary || {};
    const cases = report.cases || [];
    const labels = { classificationAccuracy: "Classification accuracy", injectionDetectionAccuracy: "Injection detection accuracy", escalationAccuracy: "Escalation accuracy", injectionRecall: "Injection recall", injectionFalsePositives: "Injection false positives", retrievalRecallAt1: "Retrieval recall @ 1", retrievalRecallAt3: "Retrieval recall @ 3", modelStepsPassingVerification: "Steps passing verification", avgTriageMillis: "Average triage time" };
    const perfect = cases.filter((c) => c.classificationCorrect && c.injectionCorrect && c.escalationCorrect && c.playbook === c.expectedPlaybook).length;
    const mark = (ok, text) => `<span class="check ${ok ? "good" : "bad"}">${ok ? "✓" : "✕"} ${text}</span>`;
    $("evaluationContent").innerHTML = `<div class="eval-head"><div><h2>${e(s.cases)} evaluation cases</h2><p class="small">${e(perfect)} of ${e(cases.length)} cases fully correct across every check</p></div><span class="badge accent mono">${e(s.mode)}</span></div>
      <div class="eval-metrics">${Object.entries(labels).map(([key, label], n) => `<div class="eval-metric" style="animation-delay:${n * 40}ms">${metricVisual(key, s[key])}<div><span>${e(label)}</span><strong>${metricValue(key, s[key])}</strong></div></div>`).join("")}</div>
      <div class="table-wrap"><table><thead><tr><th>Case / expected</th><th>Classification</th><th>Playbook</th><th>Injection</th><th>Escalation</th><th>Steps</th><th>Time</th></tr></thead><tbody>${cases.map((c) => `<tr><td><span class="mono">${e(c.file)}</span><span class="sub">${e(label(c.expectedClassification))} · ${e(c.expectedPlaybook)}</span>${c.error ? `<p class="bad">${e(triageErrorMessage(c.error))}</p>` : ""}</td>
        <td>${mark(c.classificationCorrect, e(label(c.classification)))}</td>
        <td class="mono">${mark(c.playbook === c.expectedPlaybook, e(c.playbook))}<span class="sub">Expected: ${e(c.expectedPlaybook)}</span></td>
        <td>${mark(c.injectionCorrect, c.injectionDetected ? "Detected" : "None")}<span class="sub">Expected: ${c.expectedInjection ? "yes" : "no"}</span></td>
        <td>${mark(c.escalationCorrect, c.escalated ? "L2" : "No")}<span class="sub">Expected: ${c.expectedEscalation ? "yes" : "no"}</span></td>
        <td>${e(c.verifiedSteps)} verified<span class="sub">${e(c.droppedSteps)} dropped</span></td><td class="mono">${e(duration(c.millis))}</td></tr>`).join("")}</tbody></table></div>`;
  } catch (error) { $("evaluationContent").innerHTML = errorHtml(error, "evaluation"); }
  finally {
    $("runEval").disabled = false;
    $("runEval").textContent = "Run evaluation";
    $("evaluationContent").setAttribute("aria-busy", "false");
  }
}

// Render only the server ticket's small Markdown vocabulary; raw HTML stays inert.
function ticketText(text) {
  const literal = String(text).replace(/\\([\\|`*_\[\]#])/g, "$1")
    .replace(/&(amp|lt|gt);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">" })[name]);
  return e(literal);
}
function ticketCells(line) {
  const cells = [];
  let cell = "", slashes = 0;
  for (const char of line.trim().slice(1, -1)) {
    if (char === "|" && slashes % 2 === 0) { cells.push(cell.trim()); cell = ""; }
    else cell += char;
    slashes = char === "\\" ? slashes + 1 : 0;
  }
  cells.push(cell.trim());
  return cells;
}
function renderTicketMarkdown(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  let html = '<div class="report-letterhead"><span class="report-emblem">A</span><div><strong>AEGIS</strong><span>SECURITY OPERATIONS · INCIDENT REPORT</span></div></div>';
  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    if (line.startsWith("|") && /^\|[ :|-]+\|$/.test(lines[index + 1] || "")) {
      const headers = ticketCells(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].startsWith("|")) rows.push(ticketCells(lines[index++]));
      if (headers.join("|") === "Field|Value") {
        html += '<dl class="report-overview">' + rows.map((row) => `<div><dt>${ticketText(row[0])}</dt><dd>${ticketText(row[1] || "—")}</dd></div>`).join("") + '</dl>';
      } else {
        html += '<div class="table-wrap report-table"><table><thead><tr>' + headers.map((h) => `<th scope="col">${ticketText(h)}</th>`).join("") + '</tr></thead><tbody>' + rows.map((row) => '<tr>' + headers.map((_, i) => `<td>${ticketText(row[i] || "—")}</td>`).join("") + '</tr>').join("") + '</tbody></table></div>';
      }
      continue;
    }
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html += `<h${level}>${ticketText(heading[2])}</h${level}>`;
      index++; continue;
    }
    if (line === "---") { html += '<hr>'; index++; continue; }
    if (line.startsWith("- ")) {
      html += '<ul class="report-list">';
      while (index < lines.length && lines[index].startsWith("- ")) html += `<li>${ticketText(lines[index++].slice(2))}</li>`;
      html += '</ul>'; continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^(#{1,3} |\| |- |---$)/.test(lines[index])) paragraph.push(lines[index++]);
    if (!paragraph.length) paragraph.push(lines[index++]);
    html += `<p>${paragraph.map(ticketText).join('<br>')}</p>`;
  }
  return html;
}
function setTicketView(view) {
  const preview = view !== "source";
  $("ticketPreview").hidden = !preview;
  $("ticketSource").hidden = preview;
  for (const [id, active] of [["ticketPreviewButton", preview], ["ticketSourceButton", !preview]]) {
    $(id).classList.toggle("active", active);
    $(id).setAttribute("aria-pressed", String(active));
  }
}

async function generateTicket() {
  const id = state.selected;
  if (!id) return;
  const request = ++ticket.request;
  ticket.id = id;
  ticket.ready = false;
  ticket.markdown = "";
  $("ticketDialogTitle").textContent = `${id} · Incident ticket`;
  $("ticketMarkdown").value = "";
  $("ticketPreview").innerHTML = '<div class="report-placeholder"><span class="spinner" aria-hidden="true"></span> Preparing your incident report…</div>';
  setTicketView("preview");
  $("ticketStatus").textContent = "Generating incident ticket…";
  $("copyTicket").disabled = true;
  $("downloadTicket").disabled = true;
  if (!$("ticketDialog").open) $("ticketDialog").showModal();
  try {
    const response = await fetch(`/api/incidents/${encodeURIComponent(id)}/ticket`, { headers: { Accept: "text/markdown" } });
    if (!response.ok) throw await responseError(response);
    const markdown = await response.text();
    if (request !== ticket.request) return;
    ticket.markdown = markdown;
    ticket.ready = true;
    $("ticketMarkdown").value = markdown;
    $("ticketPreview").innerHTML = renderTicketMarkdown(markdown);
    $("ticketStatus").textContent = "Ready to copy or download.";
    $("copyTicket").disabled = false;
    $("downloadTicket").disabled = false;
  } catch (error) {
    if (request === ticket.request) {
      $("ticketPreview").textContent = "The report could not be loaded. Close this dialog and try again.";
      $("ticketStatus").textContent = `Could not generate ticket: ${error.message}`;
    }
  }
}
async function copyTicket() {
  if (!ticket.ready) return;
  try {
    await navigator.clipboard.writeText(ticket.markdown);
    $("ticketStatus").textContent = "Markdown copied.";
  } catch {
    setTicketView("source");
    $("ticketMarkdown").focus();
    $("ticketMarkdown").select();
    $("ticketStatus").textContent = "Clipboard access unavailable. The Markdown is selected; copy it with Ctrl+C or ⌘C.";
  }
}
function downloadTicket() {
  if (!ticket.ready) return;
  const url = URL.createObjectURL(new Blob([ticket.markdown], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${ticket.id.replace(/[^a-zA-Z0-9_-]/g, "_")}.md`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function loadSelectedSample() {
  const file = $("sampleSelect").value;
  const request = ++sampleRequest;
  if (!file) {
    sampleLoading = false;
    $("loadSample").disabled = false;
    $("loadSample").textContent = "Load";
    $("submitButton").disabled = submittingAlert;
    return;
  }
  sampleLoading = true;
  $("loadSample").disabled = true;
  $("loadSample").textContent = "Loading…";
  $("submitButton").disabled = true;
  $("submitError").hidden = true;
  try {
    const alert = await api(`/api/samples/${encodeURIComponent(file)}`);
    if (request === sampleRequest) $("alertJson").value = JSON.stringify(alert, null, 2);
  } catch (error) {
    if (request === sampleRequest) {
      $("submitError").textContent = error.message;
      $("submitError").hidden = false;
    }
  } finally {
    if (request === sampleRequest) {
      sampleLoading = false;
      $("loadSample").disabled = false;
      $("loadSample").textContent = "Load";
      $("submitButton").disabled = submittingAlert;
    }
  }
}
function openSubmit() {
  $("submitError").hidden = true;
  $("alertDialog").showModal();
}
function connect() {
  if (!("EventSource" in window)) { $("connectionText").textContent = "Live updates unsupported"; return; }
  const stream = new EventSource("/api/stream");
  stream.onopen = () => {
    $("connection").classList.add("live");
    $("connectionText").textContent = "Live";
    refreshIncidents().catch((error) => toast(error.message, true));
    scheduleStatus();
  };
  stream.onerror = () => { $("connection").classList.remove("live"); $("connectionText").textContent = "Reconnecting"; };
  stream.addEventListener("incident", (event) => {
    try { upsertIncident(JSON.parse(event.data)); } catch { toast("A live update could not be read. Reconnecting will refresh the feed.", true); }
  });
  stream.addEventListener("cleared", resetFeed);
  window.addEventListener("pagehide", () => stream.close(), { once: true });
  window.addEventListener("pagehide", stopContainmentTimer, { once: true });
}

document.querySelector("nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-view]");
  if (button) showView(button.dataset.view);
});
$("incidentSearch").addEventListener("input", renderList);
$("incidentSort").addEventListener("click", (event) => {
  const button = event.target.closest("[data-sort]");
  if (!button) return;
  state.sort = button.dataset.sort === "severity" ? "severity" : "newest";
  for (const item of document.querySelectorAll("[data-sort]")) {
    item.classList.toggle("active", item.dataset.sort === state.sort);
    item.setAttribute("aria-pressed", String(item.dataset.sort === state.sort));
  }
  renderList();
  $("incidentList").scrollTop = 0;
});
$("incidentList").addEventListener("click", (event) => {
  const row = event.target.closest("[data-incident]");
  if (row) selectIncident(row.dataset.incident);
});
function selectIncident(id) {
  if (!id || id === state.selected) return;
  state.selected = id;
  state.tab = "response";
  renderFeed();
  document.querySelector(`[data-incident="${CSS.escape(id)}"]`)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
}
async function copyIoc(button) {
  try {
    await navigator.clipboard.writeText(button.dataset.copy);
    button.classList.add("copied");
    setTimeout(() => button.classList.remove("copied"), 1200);
    toast(`Copied ${button.dataset.copy}`);
  } catch { toast("Clipboard access is unavailable in this browser.", true); }
}
document.addEventListener("keydown", (event) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "") || document.querySelector("dialog[open]");
  if (typing || event.metaKey || event.ctrlKey || event.altKey || state.view !== "feed") return;
  if (event.key === "/") { event.preventDefault(); $("incidentSearch").focus(); return; }
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "j" && event.key !== "k") return;
  const ids = filteredIncidents().map((i) => i.id);
  if (!ids.length) return;
  event.preventDefault();
  const step = event.key === "ArrowDown" || event.key === "j" ? 1 : -1;
  const index = ids.indexOf(state.selected);
  selectIncident(ids[Math.max(0, Math.min(ids.length - 1, index < 0 ? 0 : index + step))]);
});
window.addEventListener("scroll", () => document.querySelector(".topbar")?.classList.toggle("scrolled", window.scrollY > 4), { passive: true });
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "open-submit") openSubmit();
  if (action === "approve" || action === "reject") decide(button.dataset.index, action === "approve");
  if (action === "playbooks") loadPlaybooks();
  if (action === "evaluation") runEvaluation();
  if (action === "ticket") generateTicket();
  if (action === "simulate") $("simulateButton").click();
});
document.addEventListener("click", (event) => {
  const tab = event.target.closest("[data-tab]");
  if (tab && tab.dataset.tab !== state.tab) { state.tab = tab.dataset.tab; renderDetail(); }
  const chip = event.target.closest("[data-copy]");
  if (chip) copyIoc(chip);
});
$("submitOpen").addEventListener("click", openSubmit);
$("submitClose").addEventListener("click", () => $("alertDialog").close());
$("alertDialog").addEventListener("click", (event) => { if (event.target === $("alertDialog")) $("alertDialog").close(); });
$("loadSample").addEventListener("click", loadSelectedSample);
$("sampleSelect").addEventListener("change", loadSelectedSample);
$("ticketClose").addEventListener("click", () => $("ticketDialog").close());
$("ticketDialog").addEventListener("close", () => { ++ticket.request; });
$("ticketPreviewButton").addEventListener("click", () => setTicketView("preview"));
$("ticketSourceButton").addEventListener("click", () => setTicketView("source"));
$("copyTicket").addEventListener("click", copyTicket);
$("downloadTicket").addEventListener("click", downloadTicket);
$("alertForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("submitError").hidden = true;
  const button = $("submitButton");
  if (button.disabled) return;
  submittingAlert = true;
  button.disabled = true;
  try {
    const alert = JSON.parse($("alertJson").value);
    if (!alert || typeof alert !== "object" || Array.isArray(alert)) throw new Error("The alert must be a JSON object.");
    const generation = state.generation;
    const incident = await post("/api/alerts", alert);
    if (generation === state.generation) upsertIncident(incident, true);
    $("alertDialog").close();
    showView("feed");
    toast(`Alert received · ${incident.id}`);
  } catch (error) { $("submitError").textContent = error.message; $("submitError").hidden = false; }
  finally { submittingAlert = false; button.disabled = sampleLoading; }
});
$("simulateButton").addEventListener("click", () => busy($("simulateButton"), async () => {
  const result = await post("/api/simulate?gapSeconds=4");
  toast(`Simulation started · ${plural(result.scheduled, "alert")}, 4 seconds apart`);
}));
$("clearButton").addEventListener("click", () => busy($("clearButton"), async () => {
  const generation = state.generation;
  await post("/api/incidents/clear");
  if (generation === state.generation) resetFeed();
  toast("Incident feed cleared. Scheduled demo alerts stopped.");
}));
$("runEval").addEventListener("click", runEvaluation);
$("reloadPlaybooks").addEventListener("click", loadPlaybooks);
$("refreshStatus").addEventListener("click", () => busy($("refreshStatus"), async () => {
  await refreshStatus();
  toast("Service status updated.");
}));
function renderAvatar() {
  const initials = $("analyst").value.trim().split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  $("analystAvatar").textContent = initials || "?";
}
try { $("analyst").value = localStorage.getItem("aegis.analyst") || "SOC Analyst"; } catch { /* Storage may be disabled. */ }
renderAvatar();
$("analyst").addEventListener("input", () => {
  renderAvatar();
  try { localStorage.setItem("aegis.analyst", $("analyst").value); } catch { /* Approvals still work without storage. */ }
});
function clock() { $("utcClock").textContent = `${new Date().toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short" })} · ${time(new Date().toISOString())} UTC`; }
renderFeed();
renderStats();
clock();
setInterval(clock, 1000);
refreshStatus().catch((error) => toast(error.message, true));
refreshIncidents().catch((error) => toast(error.message, true));
connect();
