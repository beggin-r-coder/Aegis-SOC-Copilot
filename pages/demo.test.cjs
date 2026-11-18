/* Tests the static demo backend. Run after pages/build.sh: node pages/demo.test.cjs site */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const site = path.resolve(process.argv[2] || 'site');
const data = JSON.parse(fs.readFileSync(path.join(site, 'demo-data.json'), 'utf8'));
const source = fs.readFileSync(path.join(__dirname, 'demo.js'), 'utf8');

function boot() {
  const timers = [];
  const store = new Map();
  const window = {
    fetch: async (url) => ({ ok: url === 'demo-data.json', status: 200, json: async () => JSON.parse(JSON.stringify(data)) })
  };
  const context = vm.createContext({
    window, Response, URL, JSON, Math, Date, Promise, console,
    location: { href: 'https://example.github.io/Aegis-SOC-Copilot/' },
    sessionStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    document: { addEventListener() {}, getElementById: () => null },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {}
  });
  vm.runInContext(source, context);
  const flush = () => { while (timers.length) timers.shift().fn(); };
  const call = async (url, options) => { const r = await window.fetch(url, options); return { status: r.status, body: r.headers.get('Content-Type')?.includes('json') ? await r.json() : await r.text() }; };
  const post = (url, body) => call(url, { method: 'POST', ...(body ? { body: JSON.stringify(body) } : {}) });
  return { window, flush, call, post, store };
}

(async () => {
  let passed = 0;
  const test = async (name, body) => { await body(); passed++; console.log('PASS ' + name); };

  await test('status reports the static engine, samples and empty stats', async () => {
    const d = boot();
    const { body } = await d.call('/api/status');
    assert.equal(body.triageMode, 'static demo');
    assert.deepEqual(body.samples, data.samples);
    assert.equal(body.stats.total, 0);
  });

  await test('bundled sample follows the real lifecycle to CONTAINED with an audit trail', async () => {
    const d = boot();
    const alert = data.alerts['ransomware-01.json'];
    const created = await d.post('/api/alerts', alert);
    assert.equal(created.status, 202);
    assert.equal(created.body.status, 'TRIAGING');
    d.flush();
    let incident = (await d.call(`/api/incidents/${created.body.id}`)).body;
    assert.equal(incident.status, 'AWAITING_APPROVAL');
    assert.equal(incident.triage.classification, data.triage['ransomware-01.json'].classification);
    assert.ok(incident.steps.length > 0 && incident.steps.every((s) => s.status === 'PENDING'));
    const denied = await d.post(`/api/incidents/${incident.id}/steps/0/approve?analyst=`);
    assert.equal(denied.status, 400);
    for (const step of incident.steps) {
      const r = await d.post(`/api/incidents/${incident.id}/steps/${step.index}/${step.index ? 'approve' : 'reject'}?analyst=Dana%20Ito`);
      assert.equal(r.status, 200);
      incident = r.body;
    }
    assert.equal(incident.status, 'CONTAINED');
    assert.equal(incident.steps[0].status, 'REJECTED');
    assert.ok(incident.audit.some((a) => a.actor === 'Dana Ito'));
    const again = await d.post(`/api/incidents/${incident.id}/steps/1/approve?analyst=Dana`);
    assert.equal(again.status, 400);
  });

  await test('injection sample escalates with findings and no steps', async () => {
    const d = boot();
    const { body } = await d.post('/api/alerts', data.alerts['injection-01.json']);
    d.flush();
    const incident = (await d.call(`/api/incidents/${body.id}`)).body;
    assert.equal(incident.status, 'ESCALATED');
    assert.equal(incident.triage.injectionDetected, true);
    assert.equal(incident.steps.length, 0);
  });

  await test('unknown alerts go to L2 instead of receiving invented guidance', async () => {
    const d = boot();
    const { body } = await d.post('/api/alerts', { alert_id: 'X-1', source: 'EDR', severity: 'HIGH', rule: 'Custom' });
    d.flush();
    const incident = (await d.call(`/api/incidents/${body.id}`)).body;
    assert.equal(incident.status, 'ESCALATED');
    assert.equal(incident.triage.steps.length, 0);
    assert.equal(incident.triage.severity, 'HIGH');
  });

  await test('ticket mirrors TicketWriter and escapes alert markup', async () => {
    const d = boot();
    const { body } = await d.post('/api/alerts', { rule: '<img src=x> | pipe', source: 'edr' });
    d.flush();
    const ticket = (await d.call(`/api/incidents/${body.id}/ticket`)).body;
    assert.match(ticket, /^# INC-\d{4} — &lt;img src=x&gt; \\\| pipe/);
    assert.ok(ticket.includes('| Field | Value |') && ticket.includes('## Containment actions') && ticket.includes('## Audit log'));
  });

  await test('simulate streams the demo set and clear cancels pending alerts', async () => {
    const d = boot();
    const { body } = await d.post('/api/simulate?gapSeconds=4');
    assert.equal(body.scheduled, data.simulation.length);
    await d.post('/api/incidents/clear');
    d.flush();
    assert.equal((await d.call('/api/incidents')).body.length, 0);
  });

  await test('playbooks, samples and evaluation are served from build-time data', async () => {
    const d = boot();
    assert.equal((await d.call('/api/playbooks')).body.length, data.playbooks.length);
    assert.equal((await d.call('/api/samples/phishing-01.json')).body.alert_id, data.alerts['phishing-01.json'].alert_id);
    assert.equal((await d.call('/api/samples/nope.json')).status, 404);
    const evaluation = d.post('/api/eval');
    for (let i = 0; i < 5; i++) await new Promise(setImmediate);
    d.flush();
    assert.equal((await evaluation).body.summary.cases, data.eval.summary.cases);
  });

  console.log(`${passed} demo backend tests passed.`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
