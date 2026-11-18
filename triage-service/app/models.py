"""Shared triage contracts, serialized with camelCase field names."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


Severity = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
Classification = Literal[
    "phishing", "ransomware", "credential_stuffing", "ddos", "public_s3_bucket", "other"
]


class ContractModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Technique(ContractModel):
    id: str
    name: str


class InjectionFinding(ContractModel):
    field: str
    rule: str
    snippet: str


class ProposedStep(ContractModel):
    action: str
    section_id: str
    section_title: str = ""
    quote: str
    high_impact: bool = False
    verified: bool = False
    reject_reason: str | None = None


class Cve(ContractModel):
    id: str
    title: str
    product: str
    cvss: float = Field(ge=0, le=10)
    known_exploited: bool
    summary: str
    keywords: list[str] = Field(default_factory=list)
    remediation: str


class PlaybookSection(ContractModel):
    id: str
    playbook_id: str
    playbook_name: str
    number: str
    title: str
    text: str
    requires_approval: bool = False


class Playbook(ContractModel):
    id: str
    name: str
    classification: Classification
    keywords: list[str] = Field(default_factory=list)
    sections: list[PlaybookSection] = Field(default_factory=list)


class RetrievalHit(ContractModel):
    section_id: str
    playbook_id: str
    score: float
    bm25_rank: int | None = Field(default=None, ge=1)
    vector_rank: int | None = Field(default=None, ge=1)


class TriageResult(ContractModel):
    mode: str
    classification: Classification = "other"
    confidence: float = Field(default=0, ge=0, le=1)
    summary: str = ""
    alert_severity: str | None = None
    severity: Severity = "MEDIUM"
    playbook_id: str = "NONE"
    playbook_name: str = ""
    techniques: list[Technique] = Field(default_factory=list)
    iocs: dict[str, list[str]] = Field(default_factory=dict)
    cves: list[Cve] = Field(default_factory=list)
    injection_detected: bool = False
    injection_findings: list[InjectionFinding] = Field(default_factory=list)
    injection_reason: str | None = None
    steps: list[ProposedStep] = Field(default_factory=list)
    rejected_steps: list[ProposedStep] = Field(default_factory=list)
    escalated: bool = False
    escalation_reason: str | None = None
    retrieval: list[RetrievalHit] = Field(default_factory=list)
    millis: int = Field(default=0, ge=0)
    error: str | None = None
