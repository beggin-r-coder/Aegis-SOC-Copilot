from dataclasses import replace
import json
from threading import Barrier, Lock, get_ident
from types import SimpleNamespace

from app import evaluation
from app.config import settings
from app.models import ProposedStep, TriageResult


SUMMARY_KEYS = {
    "mode", "cases", "classificationAccuracy", "injectionDetectionAccuracy",
    "escalationAccuracy", "injectionRecall", "injectionFalsePositives",
    "retrievalRecallAt1", "retrievalRecallAt3", "modelStepsPassingVerification",
    "avgTriageMillis",
}
ROW_KEYS = {
    "file", "expectedClassification", "classification", "classificationCorrect",
    "expectedPlaybook", "playbook", "expectedInjection", "injectionDetected",
    "injectionCorrect", "expectedEscalation", "escalated", "escalationCorrect",
    "severity", "verifiedSteps", "droppedSteps", "millis", "error",
}


def test_run_eval_with_real_configured_data():
    expected = json.loads((settings.data_dir / "eval-set.json").read_text())
    report = evaluation.run_eval()
    assert set(report) == {"summary", "cases"}
    assert set(report["summary"]) == SUMMARY_KEYS
    assert report["summary"]["cases"] == len(expected)
    assert [row["file"] for row in report["cases"]] == [case["file"] for case in expected]
    assert all(set(row) == ROW_KEYS for row in report["cases"])
    assert report["summary"]["mode"] == "offline (rule-based)"
    assert report["summary"]["injectionRecall"] == "2/2"
    assert report["summary"]["injectionFalsePositives"] == 0
    assert report["summary"]["avgTriageMillis"] >= 0


def configure_cases(monkeypatch, tmp_path, cases):
    (tmp_path / "alerts").mkdir()
    (tmp_path / "eval-set.json").write_text(json.dumps(cases))
    monkeypatch.setattr(evaluation, "settings", replace(settings, data_dir=tmp_path))


def test_metrics_denominators_and_four_concurrent_workers(monkeypatch, tmp_path):
    expected = [
        ("phishing", "PB-01", True, False),
        ("ransomware", "PB-02", False, False),
        ("other", "NONE", True, True),
        ("ddos", "PB-04", False, False),
    ]
    cases = [dict(file=f"{i}.json", expected_classification=c, expected_playbook=p,
                  expected_injection=inj, expected_escalation=esc, demo=False)
             for i, (c, p, inj, esc) in enumerate(expected)]
    configure_cases(monkeypatch, tmp_path, cases)
    for i in range(4):
        (tmp_path / "alerts" / f"{i}.json").write_text(json.dumps({"case": i}))
    step = ProposedStep(action="Preserve evidence", section_id="PB-02 §3.3", quote="Preserve available evidence.", verified=True)
    results = [
        TriageResult(mode="openai (test)", classification="phishing", playbook_id="PB-01", injection_detected=True,
                     steps=[step], rejected_steps=[step.model_copy(update={"verified": False})], millis=10),
        TriageResult(mode="offline fallback (LLM error)", classification="other", escalated=True, injection_detected=True,
                     rejected_steps=[step.model_copy(update={"verified": False})], millis=30, error="LLM unavailable"),
        TriageResult(mode="openai (test)", classification="other", escalated=True, millis=20),
        TriageResult(mode="openai (test)", classification="ddos", playbook_id="PB-04", steps=[step, step], millis=20),
    ]
    barrier = Barrier(4)
    lock = Lock()
    threads = set()

    def fake_triage(alert):
        with lock:
            threads.add(get_ident())
        barrier.wait(timeout=5)
        return results[alert["case"]]

    def rank(query):
        index = int(query.split(": ")[1])
        order = [
            ["PB-01", "PB-02", "PB-03"],
            ["PB-01", "PB-02", "PB-03"],
            ["NONE"],
            ["PB-01", "PB-02", "PB-03", "PB-04"],
        ][index]
        return [{"playbookId": identifier} for identifier in order]

    monkeypatch.setattr(evaluation, "triage", fake_triage)
    monkeypatch.setattr(evaluation, "get_retriever", lambda: SimpleNamespace(rank_playbooks=rank))
    report = evaluation.run_eval()
    assert len(threads) == 4
    assert report["summary"] == {
        "mode": "mixed (offline fallback (LLM error), openai (test))",
        "cases": 4,
        "classificationAccuracy": "75% (3/4)",
        "injectionDetectionAccuracy": "50% (2/4)",
        "escalationAccuracy": "75% (3/4)",
        "injectionRecall": "1/2",
        "injectionFalsePositives": 1,
        "retrievalRecallAt1": "33% (1/3)",
        "retrievalRecallAt3": "67% (2/3)",
        "modelStepsPassingVerification": "60% (3/5)",
        "avgTriageMillis": 20.0,
    }
    assert report["cases"][1]["error"] == "LLM unavailable"


def test_empty_eval_set_has_defined_zero_denominators(monkeypatch, tmp_path):
    configure_cases(monkeypatch, tmp_path, [])
    report = evaluation.run_eval()
    assert report["cases"] == []
    assert report["summary"]["cases"] == 0
    assert report["summary"]["injectionRecall"] == "0/0"
    assert report["summary"]["modelStepsPassingVerification"] == "0% (0/0)"
    assert report["summary"]["retrievalRecallAt1"] == "0% (0/0)"
    assert report["summary"]["avgTriageMillis"] == 0


def test_failed_case_is_reported_without_counting_as_correct(monkeypatch, tmp_path):
    case = dict(file="missing.json", expected_classification="other", expected_playbook="NONE",
                expected_injection=False, expected_escalation=True, demo=False)
    configure_cases(monkeypatch, tmp_path, [case])
    report = evaluation.run_eval()
    assert len(report["cases"]) == 1
    row = report["cases"][0]
    assert row["error"]
    assert row["escalated"]
    assert not row["classificationCorrect"]
    assert not row["injectionCorrect"]
    assert not row["escalationCorrect"]
    assert report["summary"]["classificationAccuracy"] == "0% (0/1)"
