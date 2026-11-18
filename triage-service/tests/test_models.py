import pytest
from pydantic import ValidationError

from app.models import (
    Cve, InjectionFinding, Playbook, PlaybookSection, ProposedStep,
    RetrievalHit, Technique, TriageResult,
)


@pytest.mark.parametrize("model, data, alias", [
    (Technique, {"id": "T1486", "name": "Data Encrypted for Impact"}, "id"),
    (InjectionFinding, {"field": "note", "rule": "role spoofing", "snippet": "SYSTEM:"}, "snippet"),
    (ProposedStep, {"action": "Preserve evidence.", "section_id": "PB-02 §3.3", "section_title": "Preserve evidence", "quote": "Preserve evidence."}, "sectionId"),
    (Cve, {"id": "CVE-2023-4966", "title": "Citrix Bleed", "product": "NetScaler", "cvss": 9.4, "known_exploited": True, "summary": "Session disclosure.", "remediation": "Apply vendor updates."}, "knownExploited"),
    (PlaybookSection, {"id": "PB-02 §3.3", "playbook_id": "PB-02", "playbook_name": "Ransomware Response", "number": "3.3", "title": "Preserve evidence", "text": "Preserve evidence."}, "requiresApproval"),
    (Playbook, {"id": "PB-02", "name": "Ransomware Response", "classification": "ransomware"}, "sections"),
    (RetrievalHit, {"section_id": "PB-02 §3.3", "playbook_id": "PB-02", "score": 0.5, "bm25_rank": 1}, "bm25Rank"),
    (TriageResult, {"mode": "stub"}, "playbookId"),
])
def test_contract_alias_round_trip(model, data, alias):
    instance = model.model_validate(data)
    serialized = instance.model_dump(by_alias=True)
    assert alias in serialized
    assert not any("_" in key for key in serialized)
    assert model.model_validate(serialized) == instance


@pytest.mark.parametrize("field, value", [
    ("confidence", -0.1), ("confidence", 1.1),
    ("severity", "URGENT"), ("classification", "benign"),
])
def test_triage_contract_constraints(field, value):
    with pytest.raises(ValidationError):
        TriageResult(mode="stub", **{field: value})


def test_result_collections_are_independent():
    first = TriageResult(mode="stub")
    second = TriageResult(mode="stub")
    first.iocs["ip"] = ["192.0.2.1"]
    assert second.iocs == {}
