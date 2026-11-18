"""Verify proposed citations against approved local playbook text."""

import re
from collections.abc import Iterable

from app.models import ProposedStep
from app.playbooks import get_section


def normalise(text: str) -> str:
    text = text.lower().translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'}))
    text = re.sub(r"\s+", " ", text).strip()
    while text and (text[0] in "'\"" or text[-1] in "'\"."):
        text = text.lstrip("'\"").rstrip("'\".").strip()
    return text


def verify(
    steps: Iterable[ProposedStep | dict], allowed_playbook_ids: Iterable[str]
) -> list[ProposedStep]:
    """Return every step with a verified flag or rejection reason; never trust model flags."""
    allowed = set(allowed_playbook_ids)
    seen_citations = set()
    seen_actions = set()
    results = []
    for raw_step in steps:
        step = ProposedStep.model_validate(raw_step).model_copy(update={
            "verified": False, "reject_reason": None, "section_title": "", "high_impact": False,
        })
        section = get_section(step.section_id)
        quote = normalise(step.quote)
        action = normalise(step.action)
        if section is None:
            step.reject_reason = "Cited section does not exist"
        else:
            step.section_id = section.id
            step.section_title = section.title
            step.high_impact = section.requires_approval
            if section.playbook_id not in allowed:
                step.reject_reason = "Section is outside the retrieved playbooks"
            elif len(quote) < 20:
                step.reject_reason = "Quote too short to verify"
            elif quote not in normalise(section.text):
                step.reject_reason = f"Quote not found in {section.id}"
            elif (section.id, quote) in seen_citations or action in seen_actions:
                step.reject_reason = "Duplicate step"
            else:
                step.verified = True
                seen_citations.add((section.id, quote))
                seen_actions.add(action)
        results.append(step)
    return results
