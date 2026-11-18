/* Run with Node's built-in modules; no npm packages or build step required. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Blob } = require('node:buffer');
const source = fs.readFileSync(path.join(__dirname, '../../main/resources/static/app.js'), 'utf8');

async function fixture() {
  const elements = new Map();
  class Element {
    constructor() { this.value = ''; this.innerHTML = ''; this.textContent = ''; this.listeners = {}; this.dataset = {}; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    querySelectorAll() { return []; }
    setAttribute() {}
    removeAttribute() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
    select() { this.selected = true; }
    append() {}
    click() { this.clicked = true; }
    remove() {}
    classList = { add() {}, remove() {}, toggle() {} };
  }
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  element('analyst').value = 'SOC Analyst';
  const calls = [];
  const copied = [];
  const downloads = [];
  const blobs = [];
  const routes = new Map([
    ['/api/status', { triageMode: 'fake', stats: {}, samples: ['ransomware-01.json'] }],
    ['/api/incidents', []]
  ]);
  class EventSource {
    constructor(url) { this.url = url; this.listeners = {}; EventSource.latest = this; }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    close() {}
  }
  const context = vm.createContext({
    console, Intl, Date, Map, Set, JSON, encodeURIComponent, Blob,
    navigator: { clipboard: { writeText: async (value) => copied.push(value) } },
    URL: { createObjectURL: (blob) => { blobs.push(blob); return 'blob:test'; }, revokeObjectURL() {} },
    document: { getElementById: element, querySelector: element, querySelectorAll: () => [], addEventListener() {},
      body: new Element(), createElement: () => { const link = new Element(); downloads.push(link); return link; } },
    window: { EventSource, addEventListener() {} }, EventSource,
    localStorage: { getItem() { throw Error('Storage blocked'); }, setItem() { throw Error('Storage blocked'); } },
    setTimeout: () => 1, clearTimeout() {}, setInterval() {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      const route = routes.get(url);
      if (typeof route === 'function') return route();
      return { ok: route !== undefined, status: route === undefined ? 503 : 200, json: async () => route || { error: 'Unavailable' } };
    }
  });
  vm.runInContext(source, context);
  await new Promise(setImmediate);
  return { context, element, routes, calls, copied, downloads, blobs, stream: EventSource.latest,
    run: (code) => vm.runInContext(code, context),
    set: (name, value) => { context[name] = value; } };
}

function incident(overrides = {}) {
  return {
    id: 'INC-0411', receivedAtMillis: 1, receivedAt: '2026-11-18T10:00:00Z',
    alertRule: 'Ransomware', source: 'edr', status: 'AWAITING_APPROVAL', rawAlert: {},
    audit: [{ at: '2026-11-18T10:00:00Z', actor: 'system', event: 'Alert received' }],
    steps: [{ index: 0, action: 'Isolate host', quote: 'An approved quote.', sectionId: 'PB-02 §3.1', sectionTitle: 'Isolate', highImpact: true, status: 'PENDING' }],
    triage: { mode: 'fake', severity: 'CRITICAL', summary: 'Ransomware activity.', classification: 'ransomware', confidence: .94,
      playbookId: 'PB-02', steps: [], rejectedSteps: [], retrieval: [], iocs: {}, techniques: [], cves: [] },
    ...overrides
  };
}

async function run() {
  let passed = 0;
  async function test(name, body) { await body(); passed++; console.log('PASS ' + name); }
  await test('startup survives blocked localStorage', async () => {
    const f = await fixture();
    assert.equal(f.element('analyst').value, 'SOC Analyst');
    assert.equal(f.element('triageMode').textContent, 'fake');
    assert.equal(f.stream.url, '/api/stream');
  });
  await test('footer refresh checks the current service and updates status', async () => {
    const f = await fixture();
    f.routes.set('/api/status', { triageMode: 'http', triageService: { retrievalMode: 'hybrid' }, stats: {}, samples: [] });
    const before = f.calls.length;
    await f.element('refreshStatus').listeners.click();
    assert.equal(f.calls.length, before + 1);
    assert.equal(f.element('triageMode').textContent, 'http');
    assert.equal(f.element('retrievalMode').textContent, 'hybrid');
    assert.match(f.element('lastSync').textContent, /Status checked .* UTC/);
    assert.equal(f.element('refreshStatus').disabled, false);
  });
  await test('all alert-derived markup is escaped in incident detail and list', async () => {
    const f = await fixture();
    const attack = '<img src=x onerror="alert(1)"> & <script>bad()</script>';
    const value = incident({ alertRule: attack });
    value.triage.summary = attack;
    value.triage.iocs = { ip: [attack] };
    value.triage.cves = [{ id: attack, summary: attack, remediation: attack }];
    value.steps[0].quote = attack;
    f.set('sampleIncident', value);
    f.run('upsertIncident(sampleIncident)');
    for (const id of ['incidentList', 'incidentDetail']) {
      assert.ok(!f.element(id).innerHTML.includes('<img'));
      assert.ok(!f.element(id).innerHTML.includes('<script>'));
      assert.ok(f.element(id).innerHTML.includes('&lt;img'));
    }
  });
  await test('older POST response cannot overwrite newer SSE progress', async () => {
    const f = await fixture();
    f.set('newer', incident({ audit: [{}, {}] }));
    f.set('older', incident({ status: 'TRIAGING', audit: [{}] }));
    f.run('upsertIncident(newer); upsertIncident(older)');
    assert.equal(f.run('state.incidents.get("INC-0411").status'), 'AWAITING_APPROVAL');
  });
  await test('in-flight initial snapshot cannot overwrite an SSE update', async () => {
    const f = await fixture();
    let resolve;
    f.routes.set('/api/incidents', () => new Promise((r) => { resolve = r; }));
    const pending = f.run('refreshIncidents()');
    f.set('sampleIncident', incident());
    f.run('upsertIncident(sampleIncident)');
    resolve({ ok: true, json: async () => [incident({ status: 'TRIAGING' })] });
    await pending;
    assert.equal(f.run('state.incidents.get("INC-0411").status'), 'AWAITING_APPROVAL');
  });
  await test('clear blocks resurrection from an in-flight list request', async () => {
    const f = await fixture();
    let resolve;
    f.routes.set('/api/incidents', () => new Promise((r) => { resolve = r; }));
    const pending = f.run('refreshIncidents()');
    f.run('resetFeed()');
    resolve({ ok: true, json: async () => [incident()] });
    await pending;
    assert.equal(f.run('state.incidents.size'), 0);
  });
  await test('SSE events update selection and clear the feed', async () => {
    const f = await fixture();
    f.stream.listeners.incident({ data: JSON.stringify(incident()) });
    assert.equal(f.run('state.selected'), 'INC-0411');
    f.stream.listeners.cleared();
    assert.equal(f.run('state.incidents.size'), 0);
    assert.equal(f.run('state.selected'), null);
  });
  await test('approval encodes analyst names and records returned decisions', async () => {
    const f = await fixture();
    f.set('sampleIncident', incident());
    f.run('upsertIncident(sampleIncident)');
    f.element('analyst').value = 'Alice & Bob';
    const url = '/api/incidents/INC-0411/steps/0/approve?analyst=Alice%20%26%20Bob';
    const approved = incident({ audit: [{}, {}] });
    approved.steps[0].status = 'APPROVED';
    f.routes.set(url, approved);
    await f.run('decide(0, true)');
    assert.ok(f.calls.some((call) => call.url === url && call.options.method === 'POST'));
    assert.equal(f.run('state.incidents.get("INC-0411").steps[0].status'), 'APPROVED');
  });
  await test('JSON form rejects non-object payloads without sending them', async () => {
    const f = await fixture();
    const before = f.calls.length;
    f.element('alertJson').value = '[]';
    await f.element('alertForm').listeners.submit({ preventDefault() {} });
    assert.equal(f.calls.length, before);
    assert.equal(f.element('submitError').textContent, 'The alert must be a JSON object.');
  });
  await test('historical length-limit errors show a readable fallback note', async () => {
    const f = await fixture();
    const sample = incident();
    sample.triage.mode = 'offline fallback (LLM error)';
    sample.triage.error = 'Could not parse response content as the length limit was reached - CompletionUsage(completion_tokens=1)';
    f.set('sampleIncident', sample);
    f.run('upsertIncident(sampleIncident)');
    const html = f.element('incidentDetail').innerHTML;
    assert.ok(html.includes('Running on offline fallback'));
    assert.ok(html.includes('model response reached its output limit'));
    assert.ok(!html.includes('CompletionUsage'));
  });
  await test('playbook service errors render retry state safely', async () => {
    const f = await fixture();
    await f.run('loadPlaybooks()');
    assert.ok(f.element('playbookContent').innerHTML.includes('Try again'));
    assert.equal(f.element('reloadPlaybooks').disabled, false);
  });
  await test('ticket dialog safely displays, copies, and downloads exact Markdown', async () => {
    const f = await fixture();
    const markdown = '# INC-0411\n\n<img src=x onerror="alert(1)">\n';
    f.set('sampleIncident', incident());
    f.run('upsertIncident(sampleIncident)');
    f.routes.set('/api/incidents/INC-0411/ticket', () => ({ ok: true, text: async () => markdown }));
    await f.run('generateTicket()');
    assert.equal(f.element('ticketDialog').open, true);
    assert.equal(f.element('ticketMarkdown').value, markdown);
    assert.equal(f.element('ticketMarkdown').innerHTML, '');
    assert.equal(f.element('copyTicket').disabled, false);
    await f.run('copyTicket()');
    assert.deepEqual(f.copied, [markdown]);
    f.run('downloadTicket()');
    assert.equal(f.downloads[0].download, 'INC-0411.md');
    assert.equal(f.downloads[0].clicked, true);
    assert.equal(await f.blobs[0].text(), markdown);
    assert.equal(f.blobs[0].type, 'text/markdown;charset=utf-8');
  });
  await test('report preview formats metadata, sections and tables without interpreting alert HTML', async () => {
    const f = await fixture();
    const markdown = [
      '# INC-0411 — Security incident', '', '| Field | Value |', '| --- | --- |',
      '| Alert | Suspicious \\| activity |', '| Status | AWAITING\\_APPROVAL |', '',
      '## Summary', '', '&lt;img src=x onerror=alert(1)&gt;', '',
      '## Containment actions', '', '| # | Action |', '| --- | --- |', '| 1 | Isolate host |', '',
      '## Audit log', '', '- Analyst approved', '', '---', 'Verified SOPs.'
    ].join('\n');
    f.set('reportMarkdown', markdown);
    const html = f.run('renderTicketMarkdown(reportMarkdown)');
    assert.ok(html.includes('report-letterhead') && html.includes('report-overview'));
    assert.ok(html.includes('Suspicious | activity') && html.includes('AWAITING_APPROVAL'));
    assert.ok(html.includes('<h2>Containment actions</h2>') && html.includes('<td>Isolate host</td>'));
    assert.ok(html.includes('<li>Analyst approved</li>'));
    assert.ok(html.includes('&lt;img') && !html.includes('<img'));
  });
  await test('ticket opens in report view and switches to the original source', async () => {
    const f = await fixture();
    f.set('sampleIncident', incident());
    f.run('upsertIncident(sampleIncident)');
    f.routes.set('/api/incidents/INC-0411/ticket', () => ({ ok: true, text: async () => '# Report' }));
    await f.run('generateTicket()');
    assert.equal(f.element('ticketPreview').hidden, false);
    assert.equal(f.element('ticketSource').hidden, true);
    f.element('ticketSourceButton').listeners.click();
    assert.equal(f.element('ticketPreview').hidden, true);
    assert.equal(f.element('ticketSource').hidden, false);
    assert.equal(f.element('ticketMarkdown').value, '# Report');
    f.element('ticketPreviewButton').listeners.click();
    assert.equal(f.element('ticketPreview').hidden, false);
  });
  await test('clipboard denial selects Markdown for manual copy', async () => {
    const f = await fixture();
    f.run('ticket.ready = true; ticket.markdown = "# Ticket"; navigator.clipboard.writeText = async () => { throw Error("denied"); }');
    await f.run('copyTicket()');
    assert.equal(f.element('ticketMarkdown').selected, true);
    assert.ok(f.element('ticketStatus').textContent.includes('Clipboard access unavailable'));
  });
  await test('failed ticket requests keep copy and download disabled', async () => {
    const f = await fixture();
    f.set('sampleIncident', incident());
    f.run('upsertIncident(sampleIncident)');
    await f.run('generateTicket()');
    assert.equal(f.element('copyTicket').disabled, true);
    assert.equal(f.element('downloadTicket').disabled, true);
    assert.ok(f.element('ticketStatus').textContent.includes('Could not generate ticket'));
  });
  await test('closing a ticket prevents stale responses from populating the dialog', async () => {
    const f = await fixture();
    let resolve;
    f.set('sampleIncident', incident());
    f.run('upsertIncident(sampleIncident)');
    f.routes.set('/api/incidents/INC-0411/ticket', () => new Promise((r) => { resolve = r; }));
    const request = f.run('generateTicket()');
    f.element('ticketDialog').listeners.close();
    resolve({ ok: true, text: async () => '# Stale ticket' });
    await request;
    assert.equal(f.element('ticketMarkdown').value, '');
    assert.equal(f.element('downloadTicket').disabled, true);
  });
  await test('404 and 503 show the requested disconnected state even for HTML errors', async () => {
    for (const status of [404, 503]) {
      for (const [endpoint, action, element] of [
        ['/api/eval', 'runEvaluation()', 'evaluationContent'],
        ['/api/playbooks', 'loadPlaybooks()', 'playbookContent']
      ]) {
        const f = await fixture();
        f.routes.set(endpoint, () => ({ ok: false, status, json: async () => { throw Error('HTML error page'); } }));
        await f.run(action);
        assert.ok(f.element(element).innerHTML.includes('Triage service not connected yet'));
        assert.ok(f.element(element).innerHTML.includes('Try again'));
      }
    }
  });
  await test('evaluation shows a spinner while pending and all metrics and checks afterward', async () => {
    const f = await fixture();
    let resolve;
    f.routes.set('/api/eval', () => new Promise((r) => { resolve = r; }));
    const pending = f.run('runEvaluation()');
    assert.equal(f.element('runEval').disabled, true);
    assert.ok(f.element('runEval').innerHTML.includes('spinner'));
    assert.ok(f.element('evaluationContent').innerHTML.includes('up to a minute'));
    await f.run('runEvaluation()');
    assert.equal(f.calls.filter((c) => c.url === '/api/eval').length, 1);
    resolve({ ok: true, json: async () => ({ summary: {
      mode: 'offline', cases: 1, classificationAccuracy: '0%', injectionDetectionAccuracy: '100%',
      escalationAccuracy: '100%', injectionRecall: '0/0', injectionFalsePositives: 0,
      retrievalRecallAt1: '25%', retrievalRecallAt3: '75%', modelStepsPassingVerification: '100%', avgTriageMillis: 10
    }, cases: [{ file: '<script>bad</script>', expectedClassification: 'ransomware', classification: 'other', classificationCorrect: false,
      expectedPlaybook: 'PB-02', playbook: 'NONE', expectedInjection: false, injectionDetected: false, injectionCorrect: true,
      expectedEscalation: true, escalated: true, escalationCorrect: true, verifiedSteps: 0, droppedSteps: 1, millis: 10 }] }) });
    await pending;
    const html = f.element('evaluationContent').innerHTML;
    assert.equal((html.match(/class="eval-metric"/g) || []).length, 9);
    assert.ok(html.includes('Retrieval recall @ 1') && html.includes('Retrieval recall @ 3'));
    assert.ok(html.includes('✕ NONE') && html.includes('Expected: PB-02'));
    assert.ok(html.includes('✓ None') && html.includes('✓ L2'));
    assert.ok(!html.includes('<script>'));
    assert.equal(f.element('runEval').disabled, false);
  });
  await test('sample changes load pretty JSON and submitting selects the returned incident', async () => {
    const f = await fixture();
    const alert = { source: 'edr', host: 'FIN-WS-042' };
    f.routes.set('/api/samples/ransomware-01.json', alert);
    f.element('sampleSelect').value = 'ransomware-01.json';
    await f.element('sampleSelect').listeners.change();
    assert.equal(f.element('alertJson').value, JSON.stringify(alert, null, 2));
    f.routes.set('/api/alerts', incident());
    await f.element('alertForm').listeners.submit({ preventDefault() {} });
    assert.equal(f.run('state.selected'), 'INC-0411');
    assert.equal(f.element('alertDialog').open, false);
    assert.equal(JSON.parse(f.calls.find((c) => c.url === '/api/alerts').options.body).host, 'FIN-WS-042');
  });
  await test('playbook approval sections are marked and all section text is escaped', async () => {
    const f = await fixture();
    f.routes.set('/api/playbooks', [{ id: 'PB-02', name: 'Ransomware', keywords: [], sections: [
      { id: 'PB-02 §3.1', title: 'Isolate', text: '<script>unsafe</script>', requiresApproval: true }
    ] }]);
    await f.run('loadPlaybooks()');
    const html = f.element('playbookContent').innerHTML;
    assert.ok(html.includes('approval-section') && html.includes('needs approval'));
    assert.ok(html.includes('&lt;script&gt;unsafe'));
    assert.ok(!html.includes('<script>'));
  });
  console.log(`${passed} frontend tests passed.`);
  return passed;
}
module.exports = { run };
if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });
