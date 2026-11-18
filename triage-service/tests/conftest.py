import pytest


@pytest.fixture(autouse=True)
def no_openai_credentials(monkeypatch):
    """Tests must never use credentials inherited from the developer environment."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from app.retrieval import get_retriever
    get_retriever.cache_clear()
    yield
    get_retriever.cache_clear()
