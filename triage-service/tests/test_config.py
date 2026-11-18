import pytest

from app.config import SERVICE_DIR, Settings


def test_defaults_do_not_depend_on_working_directory(monkeypatch, tmp_path):
    for name in ["OPENAI_API_KEY", "OPENAI_MODEL", "OPENAI_EMBEDDING_MODEL", "AEGIS_DATA_DIR", "PORT", "OPENAI_MAX_COMPLETION_TOKENS"]:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.chdir(tmp_path)
    settings = Settings()
    assert settings.openai_api_key is None
    assert settings.openai_model == "gpt-4o-mini"
    assert settings.openai_embedding_model == "text-embedding-3-small"
    assert settings.data_dir == (SERVICE_DIR / "../data").resolve()
    assert settings.port == 8000
    assert settings.openai_max_completion_tokens == 4096


def test_environment_overrides(monkeypatch):
    values = {
        "OPENAI_API_KEY": "test-only-key",
        "OPENAI_MODEL": "test-model",
        "OPENAI_EMBEDDING_MODEL": "test-embedding-model",
        "AEGIS_DATA_DIR": "fixtures/data",
        "PORT": "9000",
        "OPENAI_MAX_COMPLETION_TOKENS": "6000",
    }
    for name, value in values.items():
        monkeypatch.setenv(name, value)
    settings = Settings()
    assert settings.openai_api_key == values["OPENAI_API_KEY"]
    assert values["OPENAI_API_KEY"] not in repr(settings)
    assert settings.openai_model == values["OPENAI_MODEL"]
    assert settings.openai_embedding_model == values["OPENAI_EMBEDDING_MODEL"]
    assert settings.data_dir == (SERVICE_DIR / "fixtures/data").resolve()
    assert settings.port == 9000
    assert settings.openai_max_completion_tokens == 6000


def test_absolute_data_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("AEGIS_DATA_DIR", str(tmp_path))
    assert Settings().data_dir == tmp_path.resolve()


@pytest.mark.parametrize("value", ["1", "0", "-1", "999999", "invalid"])
def test_invalid_output_budget_is_rejected(monkeypatch, value):
    monkeypatch.setenv("OPENAI_MAX_COMPLETION_TOKENS", value)
    with pytest.raises(ValueError):
        Settings()
