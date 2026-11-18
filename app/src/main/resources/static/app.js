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
const state = { incidents: new Map(), updates: new Map(), revision: 0, generation: 0, selected: null,
  stats: {}, samples: [], view: "feed", sort: "newest", playbooksLoaded: false, decisions: new Set(), guardOpen: new Map() };
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
  $("toast").textContent = message;
  $("toast").className = `toast${error ? " error" : ""}`;
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
  return `<span class="status ${styles[value] || ""}">${value === "TRIAGING" ? '<span class="spinner" aria-hidden="true"></span>' : ""}${e(human(value))}</span>`;
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
  $("kpiOpen").textContent = formatNumber(s.open);
  $("kpiTotal").textContent = `${formatNumber(s.total)} total incidents`;
  $("kpiTriage").textContent = number(s.total) ? duration(s.avgTriageMillis) : "—";
  $("kpiVerified").textContent = "100%";
  $("kpiDropped").textContent = `Steps shown with verified SOP citation · ${formatNumber(s.droppedSteps)} dropped`;
  $("kpiInjection").textContent = formatNumber(s.injectionsBlocked);
  $("kpiEscalated").textContent = `${formatNumber(s.escalated)} incidents escalated to L2`;
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
  state.selected = null;
  state.stats = {};
  renderFeed();
  renderStats();
  scheduleStatus();
}
function renderList() {
  const all = orderedIncidents();
  const query = $("incidentSearch").value.toLowerCase().trim();
  const filtered = all.filter((i) => [i.id, i.alertRule, i.source, i.triage?.classification].some((v) => String(v || "").toLowerCase().includes(query)));
  $("navCount").textContent = all.length;
  $("listCount").textContent = all.length;
  $("incidentList").innerHTML = filtered.length ? filtered.map((i) => `<button class="incident-row${i.id === state.selected ? " selected" : ""}" data-incident="${e(i.id)}" aria-pressed="${i.id === state.selected}">
    <span class="incident-row-top"><span class="incident-id">${e(i.id)}</span><time class="incident-time">${e(time(i.receivedAt))}</time></span>
    ${severity(i.triage?.severity || i.rawAlert?.severity)}<div class="incident-rule">${e(i.alertRule || "Untitled alert")}</div>
    <div class="incident-meta">${e(i.source)} <span aria-hidden="true">·</span> ${e(human(i.triage?.classification || "Awaiting triage"))}</div>
    <div class="incident-bottom">${statusPill(i.status)}<span class="mono muted small">${i.triage ? e(duration(i.triage.millis)) : ""}</span></div></button>`).join("") :
    `<div class="empty-state"><span class="empty-symbol" aria-hidden="true">—</span><h2>${query ? "No matching incidents" : "All quiet. Stay ready."}</h2><p>${query ? "Try a different incident ID, source, or rule." : "Incoming alerts will appear here. Submit an alert or start a simulation."}</p></div>`;
}
function renderFeed() { renderList(); renderDetail(); }
function renderDetail() {
  stopContainmentTimer();
  const root = $("incidentDetail");
  const folds = new Set([...root.querySelectorAll("details[open]")].map((node) => node.dataset.fold));
  const i = state.incidents.get(state.selected);
  if (!i) {
    root.innerHTML = '<div class="empty-state"><span class="empty-symbol" aria-hidden="true">A / 01</span><h2>Your incident workspace</h2><p>Select an incident to inspect the evidence, review cited guidance, and approve the response.</p><button class="button secondary" data-action="open-submit">Submit your first alert <span aria-hidden="true">↗</span></button></div>';
    return;
  }
  const t = i.triage;
  const timer = ["AWAITING_APPROVAL", "CONTAINED"].includes(i.status)
    ? `<div id="containmentTimer" class="containment-timer${i.status === "CONTAINED" ? " complete" : ""}" role="timer" aria-live="off">${i.status === "CONTAINED" ? "Contained in" : "Time to contain"} · ${e(containmentTime(i))}</div>` : "";
  const heading = `<div class="detail-heading"><div><div class="case-file-label">INCIDENT CASE FILE</div><div class="id-line"><span>${e(i.id)}</span>${severity(t?.severity || i.rawAlert?.severity)}${statusPill(i.status)}</div><h2>${e(i.alertRule || "Incident detail")}</h2>${timer}</div><button class="button secondary" data-action="ticket">Generate incident ticket</button></div>`;
  if (i.status === "TRIAGING") {
    root.innerHTML = heading + `<div class="detail-content"><div class="triaging-message"><span class="spinner" aria-hidden="true"></span> Analyzing the signal and checking approved guidance…</div><h3>Raw alert JSON</h3><pre class="raw-alert">${e(JSON.stringify(i.rawAlert, null, 2))}</pre></div>`;
    return;
  }
  if (!t) {
    root.innerHTML = heading + `<div class="detail-content"><div class="banner danger"><h3>Triage could not complete</h3><p>Review the audit log and route this incident to L2.</p></div>${auditHtml(i.audit)}<details class="guard"><summary>Raw alert JSON</summary><pre class="raw-alert">${e(JSON.stringify(i.rawAlert, null, 2))}</pre></details></div>`;
    return;
  }
  const llmUsed = String(t.mode).startsWith("openai");
  const pipeline = ["Parse", "Injection scan", "IoCs", "Hybrid retrieval", "LLM triage", "Verify citations"].map((label) => {
    const skipped = (label === "LLM triage" && !llmUsed) || (label === "Hybrid retrieval" && t.mode === "fake");
    return `<span class="pipeline-chip${skipped ? " skipped" : ""}" title="${e(skipped ? `${label}: ${t.mode}` : label)}">${skipped ? "·" : "✓"} ${e(label)}</span>`;
  }).join("");
  root.innerHTML = heading + `<div class="detail-content"><div class="pipeline">${pipeline}<span class="pipeline-time">${e(duration(t.millis))} · ${e(t.mode)}</span></div>
    ${t.injectionDetected ? `<div class="banner danger"><h3>Tampering attempt detected</h3><p>${e(t.injectionReason || "Instructions aimed at the copilot were found in alert content.")}</p><ul>${(t.injectionFindings || []).map((f) => `<li><span class="mono">${e(f.field)}</span> · ${e(f.rule)}<br>“${e(f.snippet)}”</li>`).join("")}</ul></div>` : ""}
    ${t.escalated || i.status === "ESCALATED" ? `<div class="banner info"><h3>Escalated to L2</h3><p>${e(t.escalationReason || "Further analyst review is required.")}</p></div>` : ""}
    ${t.error ? `<div class="banner warning"><h3>Running on offline fallback</h3><p>${e(triageErrorMessage(t.error))}</p></div>` : ""}
    <section class="detail-section"><div class="section-label"><h3>Copilot summary</h3><span class="eyebrow">EVIDENCE → RESPONSE</span></div><p class="summary-text">${e(t.summary)}</p><div class="summary-facts"><span class="chip"><strong>${e(human(t.classification))}</strong></span><span class="chip">Confidence <strong>${e(Math.round(number(t.confidence) * 100))}%</strong></span><span class="chip mono">${e(t.playbookId)}${t.playbookName ? ` · ${e(t.playbookName)}` : ""}</span></div></section>
    <section class="detail-section"><div class="section-label"><h3>Containment checklist</h3><span class="eyebrow">${e((i.steps || []).length)} VERIFIED STEPS</span></div>${(i.steps || []).length ? i.steps.map((step) => stepHtml(i, step)).join("") : '<p class="small muted">No verified containment actions. Follow the L2 escalation process.</p>'}</section>
    <details class="guard${(t.rejectedSteps || []).length ? " has-rejections" : ""}" data-fold="guard" ${(t.rejectedSteps || []).length ? "open" : ""}><summary>Hallucination guard <span class="count-badge">${e((t.rejectedSteps || []).length)} dropped</span></summary><div class="guard-inner">Unverified suggestions are excluded from the checklist.${(t.rejectedSteps || []).map((s) => `<div class="rejected-row">${e(s.action)}<div class="mono">${e(s.sectionId)}</div><strong>${e(s.rejectReason)}</strong></div>`).join("") || '<p>No proposed steps were rejected.</p>'}</div></details>
    <div class="retrieval-box"><h3>Retrieval</h3>${(t.retrieval || []).length ? `<div class="table-wrap"><table><thead><tr><th>SECTION</th><th>SCORE</th><th>BM25 RANK</th><th>VECTOR RANK</th></tr></thead><tbody>${t.retrieval.map((hit) => `<tr><td class="mono cyan">${e(hit.sectionId)}</td><td class="mono">${e(number(hit.score).toFixed(4))}</td><td>${e(hit.bm25Rank)}</td><td>${e(hit.vectorRank)}</td></tr>`).join("")}</tbody></table></div>` : '<p class="small muted">No retrieval hits recorded for this result.</p>'}</div>
    <div class="two-column"><section class="detail-section"><div class="section-label"><h3>Indicators of compromise</h3></div>${Object.entries(t.iocs || {}).map(([kind, values]) => `<div class="ioc-group"><div class="ioc-kind">${e(kind)}</div><div class="ioc-values">${values.map((v) => `<span class="chip">${e(v)}</span>`).join("")}</div></div>`).join("") || '<p class="small muted">No indicators extracted.</p>'}</section><section class="detail-section"><div class="section-label"><h3>MITRE ATT&amp;CK</h3></div>${(t.techniques || []).map((v) => `<span class="technique-chip"><span class="mono">${e(v.id)}</span>${e(v.name)}</span>`).join("") || '<p class="small muted">No techniques confidently mapped.</p>'}</section></div>
    <section class="detail-section"><div class="section-label"><h3>Threat intel</h3><span class="eyebrow">LOCAL CVE FEED</span></div>${(t.cves || []).map((v) => `<article class="cve-card"><div class="cve-title"><strong class="mono">${e(v.id)}</strong><span>CVSS ${e(v.cvss)}${v.knownExploited ? " · Known exploited" : ""}</span></div><p><strong>${e(v.title)}</strong> · ${e(v.product)}</p><p>${e(v.summary)}</p><p><strong>Remediation</strong> ${e(v.remediation)}</p></article>`).join("") || '<p class="small muted">No matching CVEs in the local feed.</p>'}</section>
    ${auditHtml(i.audit)}<details class="guard" data-fold="raw"><summary>Raw alert JSON</summary><pre class="raw-alert">${e(JSON.stringify(i.rawAlert, null, 2))}</pre></details></div>`;
  for (const detail of root.querySelectorAll("details[data-fold]")) {
    if (detail.dataset.fold === "guard") {
      detail.open = state.guardOpen.get(i.id) ?? (t.rejectedSteps || []).length > 0;
      detail.addEventListener("toggle", () => state.guardOpen.set(i.id, detail.open));
    } else detail.open = folds.has(detail.dataset.fold);
  }
  startContainmentTimer(i);
}
function stepHtml(incident, step) {
  const key = `${incident.id}:${step.index}`;
  const canDecide = incident.status === "AWAITING_APPROVAL" && step.status === "PENDING";
  return `<article class="step-card"><div class="step-heading"><span class="step-number">${e(number(step.index) + 1)}</span><div class="step-title">${e(step.action)}${step.highImpact ? '<span class="approval-label">Approval required</span>' : ""}</div></div><blockquote class="sop-quote">“${e(step.quote)}”</blockquote><div class="step-foot"><div class="sop-ref"><span class="mono">${e(step.sectionId)}</span> · ${e(step.sectionTitle)}</div>${canDecide ? `<div class="step-actions"><button class="button reject" data-action="reject" data-index="${e(step.index)}" ${state.decisions.has(key) ? "disabled" : ""}>Reject</button><button class="button approve" data-action="approve" data-index="${e(step.index)}" ${state.decisions.has(key) ? "disabled" : ""}>✓ Approve</button></div>` : `<span class="decision">${e(human(step.status))}${step.decidedBy ? ` · ${e(step.decidedBy)}` : ""}</span>`}</div></article>`;
}
function auditHtml(entries) {
  return `<section class="detail-section"><div class="section-label"><h3>Audit log</h3><span class="eyebrow">UTC</span></div><ol class="audit-list">${(entries || []).map((a) => `<li><time>${e(time(a.at))}</time><div><span class="audit-actor">${e(a.actor)}</span><span class="audit-event">${e(a.event)}</span></div></li>`).join("")}</ol></section>`;
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
  $("breadcrumb").textContent = view === "feed" ? "LIVE FEED" : view.toUpperCase();
  if (view === "playbooks" && !state.playbooksLoaded) loadPlaybooks();
}
function loadingHtml(message) { return `<div class="empty-state"><span class="spinner" aria-hidden="true"></span><p>${e(message)}</p></div>`; }
function errorHtml(error, action) {
  const disconnected = error.status === 503 || error.status === 404;
  return `<div class="card view-error"><h2>${disconnected ? "Triage service not connected yet" : "Unable to load this view"}</h2><p>${e(disconnected ? "Connect the triage service, then try again." : error.message)}</p><button class="button secondary" data-action="${e(action)}">Try again</button></div>`;
}
async function loadPlaybooks() {
  $("reloadPlaybooks").disabled = true;
  $("playbookContent").innerHTML = loadingHtml("Loading approved playbooks…");
  try {
    const books = await api("/api/playbooks");
    $("playbookContent").innerHTML = books.map((b) => `<article class="card playbook-card"><div class="playbook-meta"><div class="eyebrow mono cyan">${e(b.id)} · ${e(human(b.classification))}</div><h2>${e(b.name)}</h2><span class="chip">${e((b.sections || []).length)} approved sections</span><p class="keyword-list">${(b.keywords || []).map(e).join(" · ")}</p></div><div class="playbook-sections">${(b.sections || []).map((s) => `<details class="playbook-section${s.requiresApproval ? " approval-section" : ""}"><summary><span class="mono">${e(s.id)}</span> · ${e(s.title)}${s.requiresApproval ? '<span class="approval-label">needs approval</span>' : ""}</summary><p>${e(s.text)}</p></details>`).join("")}</div></article>`).join("") || '<div class="card empty-state"><p>No approved playbooks are available.</p></div>';
    state.playbooksLoaded = true;
  } catch (error) { $("playbookContent").innerHTML = errorHtml(error, "playbooks"); }
  finally { $("reloadPlaybooks").disabled = false; }
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
    const labels = { classificationAccuracy: "Classification accuracy", injectionDetectionAccuracy: "Injection detection accuracy", escalationAccuracy: "Escalation accuracy", injectionRecall: "Injection recall", injectionFalsePositives: "Injection false positives", retrievalRecallAt1: "Retrieval recall @ 1", retrievalRecallAt3: "Retrieval recall @ 3", modelStepsPassingVerification: "Steps passing verification", avgTriageMillis: "Average triage time" };
    $("evaluationContent").innerHTML = `<div class="section-label"><h2>${e(s.cases)} evaluation cases</h2><span class="chip mono">${e(s.mode)}</span></div><div class="eval-metrics">${Object.entries(labels).map(([key, label]) => `<div class="eval-metric"><span>${e(label)}</span><strong>${e(key === "avgTriageMillis" ? duration(s[key]) : s[key])}</strong></div>`).join("")}</div><div class="table-wrap"><table><thead><tr><th>CASE / EXPECTED</th><th>CLASSIFICATION</th><th>PLAYBOOK</th><th>INJECTION</th><th>ESCALATION</th><th>STEPS</th><th>TIME</th></tr></thead><tbody>${(report.cases || []).map((c) => `<tr><td><span class="mono">${e(c.file)}</span><br><span class="muted">${e(human(c.expectedClassification))} · ${e(c.expectedPlaybook)}</span>${c.error ? `<p class="bad">${e(triageErrorMessage(c.error))}</p>` : ""}</td><td class="${c.classificationCorrect ? "good" : "bad"}">${c.classificationCorrect ? "✓" : "✕"} ${e(human(c.classification))}</td><td class="mono ${c.playbook === c.expectedPlaybook ? "good" : "bad"}">${c.playbook === c.expectedPlaybook ? "✓" : "✕"} ${e(c.playbook)}<br><span class="muted">Expected: ${e(c.expectedPlaybook)}</span></td><td class="${c.injectionCorrect ? "good" : "bad"}">${c.injectionCorrect ? "✓" : "✕"} ${c.injectionDetected ? "Detected" : "None"}<br><span class="muted">Expected: ${c.expectedInjection ? "yes" : "no"}</span></td><td class="${c.escalationCorrect ? "good" : "bad"}">${c.escalationCorrect ? "✓" : "✕"} ${c.escalated ? "L2" : "No"}<br><span class="muted">Expected: ${c.expectedEscalation ? "yes" : "no"}</span></td><td>${e(c.verifiedSteps)} verified<br>${e(c.droppedSteps)} dropped</td><td class="mono">${e(duration(c.millis))}</td></tr>`).join("")}</tbody></table></div>`;
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
  if (row) { state.selected = row.dataset.incident; renderFeed(); }
});
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  if (action === "open-submit") openSubmit();
  if (action === "approve" || action === "reject") decide(button.dataset.index, action === "approve");
  if (action === "playbooks") loadPlaybooks();
  if (action === "evaluation") runEvaluation();
  if (action === "ticket") generateTicket();
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
  toast(`Simulation started · ${result.scheduled} alerts, 4 seconds apart`);
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
try { $("analyst").value = localStorage.getItem("aegis.analyst") || "SOC Analyst"; } catch { /* Storage may be disabled. */ }
$("analyst").addEventListener("input", () => {
  try { localStorage.setItem("aegis.analyst", $("analyst").value); } catch { /* Approvals still work without storage. */ }
});
function clock() { $("utcClock").textContent = `${new Date().toLocaleDateString("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).toUpperCase()} · ${time(new Date().toISOString())} UTC`; }
renderFeed();
renderStats();
clock();
setInterval(clock, 1000);
refreshStatus().catch((error) => toast(error.message, true));
refreshIncidents().catch((error) => toast(error.message, true));
connect();
