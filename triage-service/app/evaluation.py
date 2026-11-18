"""Evaluate triage and retrieval against the configured local alert fixtures."""

from concurrent.futures import ThreadPoolExecutor
import json
from typing import Any

from app.config import settings
from app.injection import scan
from app.models import TriageResult
from app.retrieval import get_retriever
from app.triage import build_retrieval_query, mode, triage


def _accuracy(correct: int, total: int) -> str:
    percentage = 100 * correct / total if total else 0
    return f"{percentage:.0f}% ({correct}/{total})"


def run_eval() -> dict[str, Any]:
    cases = json.loads((settings.data_dir / "eval-set.json").read_text(encoding="utf-8"))
    # Warm the shared index before workers start, avoiding concurrent cold builds.
    retriever = get_retriever()

    def evaluate(case):
        ranked_ids = []
        completed = False
        try:
            alert = json.loads((settings.data_dir / "alerts" / case["file"]).read_text(encoding="utf-8"))
            result = triage(alert)
            completed = True
            query = build_retrieval_query(alert, scan(alert))
            ranked_ids = [item["playbookId"] for item in retriever.rank_playbooks(query)]
        except Exception as exc:
            message = str(exc) or type(exc).__name__
            if completed:
                result = result.model_copy(update={"error": "; ".join(filter(None, [result.error, message]))})
            else:
                result = TriageResult(
                    mode=mode(), escalated=True, error=message,
                    escalation_reason="Evaluation case failed; L2 review is required.",
                )
        row = {
            "file": case["file"],
            "expectedClassification": case["expected_classification"],
            "classification": result.classification,
            "classificationCorrect": completed and result.classification == case["expected_classification"],
            "expectedPlaybook": case["expected_playbook"],
            "playbook": result.playbook_id,
            "expectedInjection": case["expected_injection"],
            "injectionDetected": result.injection_detected,
            "injectionCorrect": completed and result.injection_detected == case["expected_injection"],
            "expectedEscalation": case["expected_escalation"],
            "escalated": result.escalated,
            "escalationCorrect": completed and result.escalated == case["expected_escalation"],
            "severity": result.severity,
            "verifiedSteps": len(result.steps),
            "droppedSteps": len(result.rejected_steps),
            "millis": result.millis,
            "error": result.error,
        }
        return row, ranked_ids, result.mode

    with ThreadPoolExecutor(max_workers=4) as executor:
        evaluated = list(executor.map(evaluate, cases))
    rows = [row for row, _, _ in evaluated]
    total = len(rows)
    expected_injections = sum(row["expectedInjection"] for row in rows)
    detected_injections = sum(row["expectedInjection"] and row["injectionDetected"] for row in rows)
    retrieval_cases = [(row, ranked) for row, ranked, _ in evaluated if row["expectedPlaybook"] != "NONE"]
    verified = sum(row["verifiedSteps"] for row in rows)
    proposed = verified + sum(row["droppedSteps"] for row in rows)
    modes = sorted({result_mode for _, _, result_mode in evaluated})
    summary = {
        "mode": modes[0] if len(modes) == 1 else f"mixed ({', '.join(modes)})" if modes else mode(),
        "cases": total,
        "classificationAccuracy": _accuracy(sum(row["classificationCorrect"] for row in rows), total),
        "injectionDetectionAccuracy": _accuracy(sum(row["injectionCorrect"] for row in rows), total),
        "escalationAccuracy": _accuracy(sum(row["escalationCorrect"] for row in rows), total),
        "injectionRecall": f"{detected_injections}/{expected_injections}",
        "injectionFalsePositives": sum(row["injectionDetected"] and not row["expectedInjection"] for row in rows),
        "retrievalRecallAt1": _accuracy(sum(row["expectedPlaybook"] in ranked[:1] for row, ranked in retrieval_cases), len(retrieval_cases)),
        "retrievalRecallAt3": _accuracy(sum(row["expectedPlaybook"] in ranked[:3] for row, ranked in retrieval_cases), len(retrieval_cases)),
        "modelStepsPassingVerification": _accuracy(verified, proposed),
        "avgTriageMillis": round(sum(row["millis"] for row in rows) / total, 2) if total else 0.0,
    }
    return {"summary": summary, "cases": rows}
