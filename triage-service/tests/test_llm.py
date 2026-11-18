from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pytest

from app import llm


def test_enabled_and_empty_input(monkeypatch):
    assert llm.enabled() is False
    assert llm.embed([]).shape == (0, 0)
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        llm.embed(["text"])
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    assert llm.enabled() is True


def test_embeddings_batching_order_dtype_and_model(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    client = MagicMock()
    client.__enter__.return_value = client
    factory = MagicMock(return_value=client)
    monkeypatch.setattr(llm, "OpenAI", factory)

    def create(**kwargs):
        return SimpleNamespace(data=[
            SimpleNamespace(index=index, embedding=[float(text), 1.0])
            for index, text in reversed(list(enumerate(kwargs["input"])))
        ])

    client.embeddings.create.side_effect = create
    vectors = llm.embed([str(i) for i in range(205)])
    assert vectors.dtype == np.float32
    assert vectors.shape == (205, 2)
    np.testing.assert_array_equal(vectors[:, 0], np.arange(205))
    calls = client.embeddings.create.call_args_list
    assert [len(call.kwargs["input"]) for call in calls] == [100, 100, 5]
    assert all(call.kwargs["model"] == llm.settings.openai_embedding_model for call in calls)
    assert all(call.kwargs["encoding_format"] == "float" for call in calls)
    client.__exit__.assert_called_once()


def test_embedding_errors_propagate_to_retriever(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    client = MagicMock()
    client.__enter__.return_value = client
    monkeypatch.setattr(llm, "OpenAI", MagicMock(return_value=client))
    client.embeddings.create.side_effect = RuntimeError("unavailable")
    with pytest.raises(RuntimeError, match="unavailable"):
        llm.embed(["text"])
    client.embeddings.create.side_effect = None
    client.embeddings.create.return_value = SimpleNamespace(data=[])
    with pytest.raises(ValueError, match="every input"):
        llm.embed(["text"])


@pytest.mark.parametrize("use_beta", [False, True])
def test_structured_triage_call_with_installed_and_legacy_sdk(monkeypatch, use_beta):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    proposed = llm.LlmTriage(
        classification="other", confidence=0.1, severity="MEDIUM",
        summary="No playbook fits. Escalate to L2.", attack_techniques=[],
        playbook_id="NONE", injection_suspected=False, injection_reason="", steps=[],
    )
    parse = MagicMock(return_value=SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=proposed, refusal=None))]))
    client = MagicMock()
    client.__enter__.return_value = client
    client.chat = SimpleNamespace(completions=SimpleNamespace() if use_beta else SimpleNamespace(parse=parse))
    client.beta = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(parse=parse)))
    monkeypatch.setattr(llm, "OpenAI", MagicMock(return_value=client))
    assert llm.triage_call("system rules", "untrusted data") == proposed
    arguments = parse.call_args.kwargs
    assert arguments["response_format"] is llm.LlmTriage
    assert arguments["max_completion_tokens"] == 4096
    assert arguments["temperature"] == 0
    assert arguments["model"] == llm.settings.openai_model
    assert arguments["messages"] == [{"role": "system", "content": "system rules"}, {"role": "user", "content": "untrusted data"}]


@pytest.mark.parametrize("refusal, expected", [("Cannot comply", "declined"), (None, "no structured triage")])
def test_structured_triage_rejects_refusal_or_missing_output(monkeypatch, refusal, expected):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    client = MagicMock()
    client.__enter__.return_value = client
    client.chat.completions.parse.return_value = SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(parsed=None, refusal=refusal))])
    monkeypatch.setattr(llm, "OpenAI", MagicMock(return_value=client))
    with pytest.raises(RuntimeError, match=expected):
        llm.triage_call("rules", "data")


def test_triage_requires_key():
    with pytest.raises(RuntimeError, match="OPENAI_API_KEY"):
        llm.triage_call("rules", "data")


def truncated_completion():
    from openai.types.chat import ChatCompletion
    return ChatCompletion.model_validate({
        "id": "test-truncated", "object": "chat.completion", "created": 0, "model": "test",
        "choices": [{"index": 0, "finish_reason": "length", "message": {"role": "assistant", "content": "{"}}],
        "usage": {"completion_tokens": 1, "prompt_tokens": 2126, "total_tokens": 2127},
    })


@pytest.mark.parametrize("sdk_raises", [True, False])
def test_truncated_completion_retries_with_larger_explicit_budget(monkeypatch, sdk_raises):
    from openai import LengthFinishReasonError
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    result = llm.LlmTriage(
        classification="other", confidence=0, severity="MEDIUM", summary="L2 review required.",
        attack_techniques=[], playbook_id="NONE", injection_suspected=False,
        injection_reason="", steps=[],
    )
    short = truncated_completion()
    first = LengthFinishReasonError(completion=short) if sdk_raises else short
    success = SimpleNamespace(choices=[SimpleNamespace(finish_reason="stop", message=SimpleNamespace(parsed=result, refusal=None))])
    client = MagicMock()
    client.__enter__.return_value = client
    parse = client.chat.completions.parse
    parse.side_effect = [first, success]
    factory = MagicMock(return_value=client)
    monkeypatch.setattr(llm, "OpenAI", factory)
    assert llm.triage_call("trusted rules", "untrusted alert") == result
    assert [c.kwargs["max_completion_tokens"] for c in parse.call_args_list] == [4096, 8192]
    assert parse.call_args_list[0].kwargs["messages"] == parse.call_args_list[1].kwargs["messages"]
    assert factory.call_args.kwargs == {"timeout": 20.0, "max_retries": 0}


def test_repeated_truncation_stops_and_omits_sdk_dump(monkeypatch):
    from openai import LengthFinishReasonError
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    client = MagicMock()
    client.__enter__.return_value = client
    parse = client.chat.completions.parse
    parse.side_effect = LengthFinishReasonError(completion=truncated_completion())
    monkeypatch.setattr(llm, "OpenAI", MagicMock(return_value=client))
    with pytest.raises(RuntimeError, match="output limit after two attempts") as caught:
        llm.triage_call("trusted rules", "untrusted alert")
    assert parse.call_count == 2
    assert "CompletionUsage" not in str(caught.value)


@pytest.mark.parametrize("error_type, expected", [
    ("AuthenticationError", "rejected the API credentials"),
    ("RateLimitError", "quota"),
    ("BadRequestError", "HTTP 400"),
    ("APIConnectionError", "connect securely"),
    ("APITimeoutError", "timed out"),
])
def test_provider_errors_have_safe_actionable_messages(error_type, expected):
    import httpx
    import openai
    request = httpx.Request("POST", "https://gateway.example/chat/completions")
    cls = getattr(openai, error_type)
    if error_type in ["APIConnectionError", "APITimeoutError"]:
        error = cls(request=request)
    else:
        status = {"AuthenticationError": 401, "RateLimitError": 429, "BadRequestError": 400}[error_type]
        error = cls("SDK payload with sensitive details", response=httpx.Response(status, request=request), body=None)
    reason = llm.failure_reason(error)
    assert expected in reason
    assert "sensitive details" not in reason


def test_unknown_error_redacts_key_and_bounds_message(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-secret")
    message = llm.failure_reason(RuntimeError("test-secret " + "x" * 1000))
    assert "test-secret" not in message
    assert "[REDACTED]" in message
    assert len(message) <= 500
