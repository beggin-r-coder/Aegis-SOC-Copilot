"""Minimal official OpenAI SDK calls for embeddings and structured triage."""

import logging
import os

import numpy as np
from openai import (
    APIConnectionError, APIStatusError, APITimeoutError, AuthenticationError,
    LengthFinishReasonError, OpenAI, RateLimitError,
)
from pydantic import BaseModel, Field, ValidationError

from app.config import settings
from app.models import Classification, Severity, Technique


_LOG = logging.getLogger(__name__)


class LlmStep(BaseModel):
    action: str
    section_id: str
    quote: str


class LlmTriage(BaseModel):
    classification: Classification
    confidence: float = Field(ge=0, le=1)
    severity: Severity
    summary: str
    attack_techniques: list[Technique]
    playbook_id: str
    injection_suspected: bool
    injection_reason: str
    steps: list[LlmStep]


def enabled() -> bool:
    return bool(os.environ.get("OPENAI_API_KEY"))


def embed(texts: list[str]) -> np.ndarray:
    """Return embeddings in input order, batching at most 100 texts per request."""
    if not texts:
        return np.empty((0, 0), dtype=np.float32)
    if not enabled():
        raise RuntimeError("OPENAI_API_KEY is required for embeddings")
    vectors = []
    with OpenAI(timeout=30.0, max_retries=1) as client:
        for start in range(0, len(texts), 100):
            batch = texts[start:start + 100]
            response = client.embeddings.create(
                model=settings.openai_embedding_model,
                input=batch,
                encoding_format="float",
            )
            records = sorted(response.data, key=lambda item: item.index)
            if [item.index for item in records] != list(range(len(batch))):
                raise ValueError("Embedding response did not cover every input")
            vectors.extend(item.embedding for item in records)
    return np.asarray(vectors, dtype=np.float32)


def triage_call(system: str, user: str) -> LlmTriage:
    """Parse a structured answer, raising on refusals, invalid output, or API errors."""
    if not enabled():
        raise RuntimeError("OPENAI_API_KEY is required for LLM triage")
    # Two bounded requests leave room for retrieval within the app's HTTP timeout.
    with OpenAI(timeout=20.0, max_retries=0) as client:
        parse = getattr(client.chat.completions, "parse", None)
        if parse is None:
            parse = client.beta.chat.completions.parse
        initial_budget = settings.openai_max_completion_tokens
        for attempt, budget in enumerate((initial_budget, initial_budget * 2)):
            try:
                completion = parse(
                    model=settings.openai_model,
                    temperature=0,
                    max_completion_tokens=budget,
                    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                    response_format=LlmTriage,
                )
                choice = completion.choices[0]
                # Some compatible gateways return a completion instead of raising.
                if getattr(choice, "finish_reason", None) == "length":
                    raise LengthFinishReasonError(completion=completion)
            except LengthFinishReasonError:
                if attempt == 0:
                    _LOG.warning("Structured triage reached %d output tokens; retrying with %d", budget, budget * 2)
                    continue
                raise RuntimeError("Model response reached its output limit after two attempts.") from None
            message = choice.message
            if message.refusal:
                raise RuntimeError("The model declined to generate a triage response.")
            if message.parsed is None:
                raise RuntimeError("OpenAI returned no structured triage result")
            return LlmTriage.model_validate(message.parsed)


def failure_reason(exc: Exception) -> str:
    """Return an actionable error without SDK payloads or credentials."""
    if isinstance(exc, APITimeoutError):
        return "The model service timed out."
    if isinstance(exc, AuthenticationError):
        return "The model service rejected the API credentials."
    if isinstance(exc, RateLimitError):
        return "The model service is rate limited or its quota is exhausted."
    if isinstance(exc, APIConnectionError):
        return "Could not connect securely to the model service."
    if isinstance(exc, APIStatusError):
        return f"The model service returned HTTP {exc.status_code}."
    if isinstance(exc, ValidationError):
        return "The model returned an invalid structured response."
    message = str(exc) or type(exc).__name__
    key = os.environ.get("OPENAI_API_KEY")
    if key:
        message = message.replace(key, "[REDACTED]")
    return message[:500]
