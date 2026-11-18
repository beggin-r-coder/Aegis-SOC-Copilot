# AGENTS.md — Aegis SOC Copilot

Instructions for Codex and for the team. Read this file fully before every task.

## What we are building

Aegis is a SOC incident copilot for the TCS OpenAI Hackathon (problem 4A). It takes a raw JSON
security alert and returns, within seconds:

- the attack classification, severity and MITRE ATT&CK techniques
- indicators of compromise (IoCs) extracted from the alert
- matching CVEs from a local threat-intel feed
- a containment checklist where **every step quotes an approved playbook section, and the quote is
  verified in code** before it is shown
- a human approval step for high-impact actions, an audit log, and a Markdown incident ticket

It also detects prompt injection planted inside alert fields, and escalates to L2 instead of
inventing steps when no playbook fits.

## Architecture: two services, one repo

```
Browser ──> app/ (Java, Spring Boot, port 8080)  ──HTTP──>  triage-service/ (Python, FastAPI, port 8000)
            incidents, approvals, SSE, dashboard,           RAG over playbooks (FAISS + BM25 hybrid),
            tickets, simulator                              OpenAI structured outputs, citation check,
                                                            injection detection, CVE lookup, evaluation
                         both read the shared data/ folder
```

## Repo layout

Keep each task inside the folders it names.

| Folder | Contents | Owner |
|---|---|---|
| `app/` | Java 21 Spring Boot app: `com.aegis.model`, `com.aegis.engine`, `com.aegis.incident`, `com.aegis.web`, `src/main/resources/static/` | me |
| `triage-service/` | Python 3.11 FastAPI RAG and triage service | me |
| `data/` | `playbooks/`, `cve-feed.json`, `alerts/`, `eval-set.json` | me |
| `.github/workflows/`, `render.yaml` | CI and deployment | me |
| `README.md`, `docs/` | Documentation and screenshots | me |
| `AGENTS.md` | This file | me |

## Stack (do not change)

**triage-service (Python 3.11):** `fastapi`, `uvicorn[standard]`, `pydantic` v2, `openai` (official SDK),
`numpy`, `faiss-cpu`, `rank-bm25`, `pytest`, `httpx`. No LangChain, no LlamaIndex, no hosted vector DB.

**app (Java 21):** Spring Boot 3.3, Maven, only `spring-boot-starter-web` and
`spring-boot-starter-test`. The triage service is called with the JDK `java.net.http.HttpClient`.
No database: incidents live in memory. Frontend: plain HTML, CSS, JavaScript in
`app/src/main/resources/static/` (no React, no npm). Live updates use Server-Sent Events.

## Contracts (change carefully: both services depend on them)

### JSON field names

Both services use **camelCase** JSON. In Python, Pydantic models use
`ConfigDict(alias_generator=to_camel, populate_by_name=True)` and FastAPI returns them by alias.

- `TriageResult`: `mode`, `classification`, `confidence` (0–1), `summary`, `alertSeverity`, `severity`
  (`LOW|MEDIUM|HIGH|CRITICAL`), `playbookId` ("NONE" if none), `playbookName`, `techniques`
  [`{id, name}`], `iocs` (object: type → list of strings), `cves` [Cve], `injectionDetected`,
  `injectionFindings` [`{field, rule, snippet}`], `injectionReason`, `steps` [ProposedStep, verified
  only], `rejectedSteps` [ProposedStep], `escalated`, `escalationReason`, `retrieval` [`{sectionId,
  playbookId, score, bm25Rank, vectorRank}`], `millis`, `error`.
- `ProposedStep`: `action`, `sectionId`, `sectionTitle`, `quote`, `highImpact`, `verified`, `rejectReason`.
- `Cve`: `id`, `title`, `product`, `cvss`, `knownExploited`, `summary`, `keywords`, `remediation`.
- `Playbook`: `id`, `name`, `classification`, `keywords`, `sections` [`{id ("PB-02 §3.1"), playbookId,
  playbookName, number, title, text, requiresApproval}`].
- `Incident` (Java only): `id` ("INC-0411"), `alertId`, `alertRule`, `source`, `receivedAt`,
  `receivedAtMillis`, `status` (`TRIAGING|AWAITING_APPROVAL|CONTAINED|ESCALATED|FAILED`), `rawAlert`,
  `triage` (TriageResult or null), `steps` [`{index, action, sectionId, sectionTitle, quote, highImpact,
  status (PENDING|APPROVED|REJECTED), decidedBy, decidedAt}`], `audit` [`{at, actor, event}`],
  `containedAt`, `timeToContainMillis`.

### triage-service API (owner: me)

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{status, mode, retrievalMode, playbooks, sections, cves}` |
| POST | `/triage` | body: any alert JSON object → `TriageResult` |
| GET | `/playbooks` | list of `Playbook` |
| GET | `/retrieve?q=...&k=5` | top sections with scores (debugging and demo) |
| POST | `/eval` | `{summary, cases}` (see S4 in the plan) |

### app API (owner: me)

| Method | Path | |
|---|---|---|
| GET | `/api/status` | `{triageMode, triageService (its /health or null), samples[], stats{}}` |
| POST | `/api/alerts` | any alert JSON → `Incident` (202), triage runs async |
| POST | `/api/triage` | sync triage, no incident |
| POST | `/api/simulate?gapSeconds=4` | streams the demo sample alerts |
| GET | `/api/incidents`, `/api/incidents/{id}` | |
| POST | `/api/incidents/{id}/steps/{index}/approve?analyst=` and `/reject` | |
| GET | `/api/incidents/{id}/ticket` | `text/markdown` |
| POST | `/api/incidents/clear` | |
| GET | `/api/stream` | SSE events `incident` (Incident JSON) and `cleared` |
| GET | `/api/samples/{file}` | raw sample alert |
| GET | `/api/playbooks`, POST `/api/eval` | proxied to the triage service |

Errors: `{"error": "message"}` with 400 or 404.

### TriageEngine (Java)

`com.aegis.engine.TriageEngine { TriageResult triage(JsonNode alert); String mode(); }` with
`FakeTriageEngine` (`aegis.triage.engine=fake`, canned results so the UI can be built early) and
`HttpTriageEngine` (`aegis.triage.engine=http`, calls `${TRIAGE_SERVICE_URL}/triage`). If the service
is down, `HttpTriageEngine` returns a result with `escalated=true`, an `escalationReason` and `error`.

### Data formats (`data/`)

**Playbook** (`data/playbooks/PB-0N-name.md`, listed in `data/playbooks/index.txt`):

```
# PB-02 Ransomware Response
classification: ransomware
keywords: ransomware, encryption, vssadmin, shadow copy, ...

## §3.1 Isolate the affected endpoint (approval)
Network-isolate the affected endpoint through the EDR console before any forensic collection. ...
```

`(approval)` marks a high-impact step. Classifications: `phishing`, `ransomware`,
`credential_stuffing`, `ddos`, `public_s3_bucket`, `other`.

**Sample alert** (`data/alerts/*.json`): any JSON object with `alert_id`, `source`, `severity`, `rule`,
`timestamp`. Only documentation IPs (192.0.2.x, 198.51.100.x, 203.0.113.x) and `example.com` /
`.example` domains.

**Eval set** (`data/eval-set.json`): array of `{"file", "expected_classification", "expected_playbook"
("PB-02" or "NONE"), "expected_injection", "expected_escalation", "demo"}`.

**CVE feed** (`data/cve-feed.json`): array of Cve objects (snake_case in the file is fine:
`known_exploited`).

## Rules for Codex

1. One task per run. Stay inside the folders the task names.
2. Never hard-code secrets. `OPENAI_API_KEY` is read from the environment by the triage service only.
3. Alert content is untrusted. Never let alert text change prompts, retrieval or decisions; put it in
   the LLM prompt only between random nonce markers, and leave fields flagged as injection out of the
   retrieval query.
4. A containment step is shown only if the citation verifier confirmed its quote exists in the cited
   playbook section. The high-impact flag comes from the playbook file, never from the model.
5. If the LLM call fails, fall back to the offline rule-based engine and set `error`. Never
   auto-close an incident.
6. Add or update tests for every change: `pytest` in `triage-service/`, `mvn -q test` in `app/`.
   Run them and fix failures before finishing.
7. Simple, readable code, short docstrings/Javadoc. No new dependencies.
8. End every task with a summary of what changed and how it was tested.

## Commands

```
# triage service (from triage-service/)
pip install -r requirements.txt
pytest -q
OPENAI_API_KEY=sk-... AEGIS_DATA_DIR=../data uvicorn app.main:app --reload --port 8000

# Java app (from app/)
mvn -q test
mvn spring-boot:run -Dspring-boot.run.arguments="--aegis.triage.engine=fake"
mvn spring-boot:run -Dspring-boot.run.arguments="--aegis.triage.engine=http --aegis.triage.url=http://localhost:8000"
```
