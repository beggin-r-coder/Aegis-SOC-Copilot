"""Detect instruction-like content in every string leaf of an alert."""

import re
from typing import Any

from app.iocs import flatten
from app.models import InjectionFinding


_PATTERNS = {
    "override-instructions": r"\b(?:ignore|disregard|forget)\b.*?\b(?:previous|prior|above)\b.*?\b(?:instructions|rules)\b",
    "role-marker": r"\b(?:system|assistant|developer)\s*:",
    "chat-template-token": r"<\|im_start\|>|\[INST\]|###\s*instruction\b",
    "verdict-manipulation": r"\b(?:mark|classify|label|treat)\b.*?\bas\s+(?:benign|safe|resolved|false\s+positive|closed)\b",
    "suppress-escalation": r"\b(?:do\s+not|don't|never)\b.*?\b(?:escalate|report|flag|notify)\b",
    "persona-hijack": r"\byou\s+are\s+now\s+an?\s+(?:assistant|AI)\b",
}
_RULES = [(name, re.compile(pattern, re.IGNORECASE | re.DOTALL)) for name, pattern in _PATTERNS.items()]


def scan(alert: Any) -> list[InjectionFinding]:
    findings = []
    for path, key, value in flatten(alert):
        if not isinstance(value, str):
            continue
        for rule, pattern in _RULES:
            match = pattern.search(value)
            if match is not None:
                start = max(0, match.start() - 20)
                findings.append(InjectionFinding(
                    field=path, rule=rule, snippet=value[start:start + 80],
                ))
    return findings
