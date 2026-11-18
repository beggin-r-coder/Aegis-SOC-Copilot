"""Environment configuration without additional settings dependencies."""

from dataclasses import dataclass, field
import os
from pathlib import Path


SERVICE_DIR = Path(__file__).resolve().parent.parent


def _data_dir() -> Path:
    path = Path(os.environ.get("AEGIS_DATA_DIR", "../data")).expanduser()
    return (SERVICE_DIR / path).resolve()


@dataclass(frozen=True)
class Settings:
    openai_api_key: str | None = field(
        default_factory=lambda: os.environ.get("OPENAI_API_KEY") or None,
        repr=False,
    )
    openai_model: str = field(
        default_factory=lambda: os.environ.get("OPENAI_MODEL", "gpt-4o-mini")
    )
    openai_embedding_model: str = field(
        default_factory=lambda: os.environ.get(
            "OPENAI_EMBEDDING_MODEL", "text-embedding-3-small"
        )
    )
    openai_max_completion_tokens: int = field(
        default_factory=lambda: int(os.environ.get("OPENAI_MAX_COMPLETION_TOKENS", "4096"))
    )
    data_dir: Path = field(default_factory=_data_dir)
    port: int = field(default_factory=lambda: int(os.environ.get("PORT", "8000")))

    def __post_init__(self):
        if not 512 <= self.openai_max_completion_tokens <= 16384:
            raise ValueError("OPENAI_MAX_COMPLETION_TOKENS must be between 512 and 16384")


settings = Settings()
