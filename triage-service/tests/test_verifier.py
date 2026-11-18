import pytest

from app.models import ProposedStep
from app.playbooks import get_section
from app.verifier import normalise, verify


def step(section_id="PB-02 §3.1", quote=None, **kwargs):
    section = get_section(section_id)
    return ProposedStep(
        action=kwargs.pop("action", "Isolate FIN-WS-042"), section_id=section_id,
        quote=quote if quote is not None else section.text.split(". ")[0] + ".",
        **kwargs,
    )


def test_fabricated_quote_is_rejected():
    proposed = step("PB-02 §5.2", quote="Contact the attacker and transfer the demanded ransom immediately.", verified=True)
    result = verify([proposed], {"PB-02"})[0]
    assert result.verified is False
    assert result.reject_reason == "Quote not found in PB-02 §5.2"


@pytest.mark.parametrize("section_id, quote, allowed, reason", [
    ("PB-99 §1.1", "This section was invented by a model.", {"PB-02"}, "Cited section does not exist"),
    ("PB-02 §3.1", None, {"PB-01"}, "Section is outside the retrieved playbooks"),
    ("PB-02 §3.1", "Isolate.", {"PB-02"}, "Quote too short to verify"),
])
def test_rejection_reasons(section_id, quote, allowed, reason):
    proposed = step(section_id, quote)
    result = verify([proposed], allowed)[0]
    assert result.verified is False
    assert result.reject_reason == reason


def test_normalised_quote_and_authoritative_metadata():
    original = step(section_title="Invented title", high_impact=False, reject_reason="Invented rejection")
    original.quote = '“' + original.quote.upper().replace(" ", "\n  ") + '”'
    result = verify([original], {"PB-02"})[0]
    assert result.verified is True
    assert result.reject_reason is None
    assert result.section_title == "Isolate the affected endpoint"
    assert result.high_impact is True
    assert original.section_title == "Invented title"
    assert normalise(" ‘Attacker’s   demand.’ ") == "attacker's demand"


def test_non_approval_step_cannot_gain_high_impact_flag():
    result = verify([step("PB-02 §3.3", high_impact=True)], {"PB-02"})[0]
    assert result.verified
    assert result.high_impact is False


def test_duplicates_cannot_bypass_with_alias_ids_or_reworded_actions():
    first = step()
    second = first.model_copy(update={"action": "Disconnect FIN-WS-042", "section_id": "[PB-02 §3.1]"})
    result = verify([first, second], {"PB-02"})
    assert result[0].verified
    assert result[1].reject_reason == "Duplicate step"
    assert not result[1].verified
    repeated_action = step("PB-02 §3.3", action=first.action.upper())
    assert verify([first, repeated_action], {"PB-02"})[1].reject_reason == "Duplicate step"


def test_dictionary_input_and_rejected_attempt_does_not_reserve_quote():
    first = step(quote="Invented containment instruction with no supporting text.")
    valid = step()
    result = verify([first, {"action": valid.action, "sectionId": valid.section_id, "quote": valid.quote}], {"PB-02"})
    assert not result[0].verified
    assert result[1].verified


def test_normalisation_length_limit():
    proposed = step(quote='“   ' + 'a ' * 10 + ' ”')
    assert len(normalise(proposed.quote)) < 20
    assert verify([proposed], {"PB-02"})[0].reject_reason == "Quote too short to verify"
