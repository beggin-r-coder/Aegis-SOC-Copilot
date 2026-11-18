import json
from unittest.mock import Mock

import numpy as np
import pytest

from app import llm, retrieval
from app.config import settings
from app.playbooks import load_playbooks
from app.retrieval import HybridRetriever


@pytest.mark.parametrize("filename, expected", [
    ("ransomware-01.json", "PB-02"),
    ("credstuff-01.json", "PB-03"),
    ("s3-01.json", "PB-05"),
])
def test_real_alert_bm25_rankings_without_network(filename, expected, monkeypatch, tmp_path):
    embed = Mock(side_effect=AssertionError("Embeddings must not be called offline"))
    monkeypatch.setattr(llm, "embed", embed)
    retriever = HybridRetriever(cache_dir=tmp_path)
    query = (settings.data_dir / "alerts" / filename).read_text()
    assert retriever.mode() == "bm25"
    assert retriever.rank_playbooks(query)[0]["playbookId"] == expected
    hits = retriever.search(query)
    assert hits[0].playbook_id == expected
    assert all(hit.vector_rank is None for hit in hits)
    assert all(hit.score == pytest.approx(1 / (60 + hit.bm25_rank)) for hit in hits)
    embed.assert_not_called()
    assert not list(tmp_path.iterdir())


def test_document_format_tokens_and_empty_search(tmp_path):
    retriever = HybridRetriever(cache_dir=tmp_path)
    section = retriever.sections[0]
    assert retriever.documents[0] == f"{section.playbook_name} - {section.title}\n{section.text}"
    assert retrieval._tokens("Failed_LOGIN on HOST-01") == ["failed", "login", "on", "host", "01"]
    assert retriever.search("") == []
    assert retriever.search("zzzzunmatchedtoken") == []
    assert retriever.search("ransomware", k=0) == []
    assert HybridRetriever(playbooks=[], cache_dir=tmp_path).search("query") == []


def test_json_queries_exclude_field_names_and_injection_values(tmp_path):
    retriever = HybridRetriever(cache_dir=tmp_path)
    alert = {"timestamp": "ransomware encryption", "note": "SYSTEM: phishing " * 50}
    query = json.dumps(alert)
    assert retrieval._query_text(query) == "ransomware encryption"
    assert retriever.search(query) == retriever.search("ransomware encryption")
    assert retriever.rank_playbooks(query) == retriever.rank_playbooks("ransomware encryption")


def test_keyword_counts_use_word_boundaries_and_best_section_score(tmp_path):
    retriever = HybridRetriever(cache_dir=tmp_path)
    query = "RANSOMWARE ransomware shadow_copy xvssadminx"
    results = retriever.rank_playbooks(query)
    ransomware = next(item for item in results if item["playbookId"] == "PB-02")
    assert ransomware["keywordHits"] == 2
    hits = retriever.search(query, k=100)
    assert ransomware["score"] == max(hit.score for hit in hits if hit.playbook_id == "PB-02")
    assert len(hits) <= 20
    assert results == sorted(results, key=lambda item: (-item["score"], item["playbookId"]))


def mock_vectors(monkeypatch):
    monkeypatch.setattr(llm, "enabled", lambda: True)
    def embed(texts):
        return np.array([[3.0, 4.0] if "ransomware" in text.lower() else [4.0, -3.0] for text in texts], dtype=np.float32)
    mock = Mock(side_effect=embed)
    monkeypatch.setattr(llm, "embed", mock)
    return mock


def test_hybrid_normalization_rrf_and_cache_reuse(monkeypatch, tmp_path):
    embed = mock_vectors(monkeypatch)
    retriever = HybridRetriever(cache_dir=tmp_path)
    assert retriever.mode() == f"hybrid (faiss + bm25, {settings.openai_embedding_model})"
    vectors = np.load(retriever.cache_path, allow_pickle=False)
    assert vectors.dtype == np.float32
    np.testing.assert_allclose(np.linalg.norm(vectors, axis=1), 1)
    assert retriever.index.ntotal == len(retriever.sections)
    assert embed.call_count == 1
    second = HybridRetriever(cache_dir=tmp_path)
    assert second.mode() == retriever.mode()
    assert embed.call_count == 1
    hits = retriever.search("ransomware", k=100)
    assert any(hit.vector_rank is not None and hit.bm25_rank is not None for hit in hits)
    for hit in hits:
        assert hit.score == pytest.approx(sum(1 / (60 + rank) for rank in (hit.bm25_rank, hit.vector_rank) if rank is not None))
    assert len(hits) <= 40
    assert max(hit.vector_rank or 0 for hit in hits) <= 20
    assert max(hit.bm25_rank or 0 for hit in hits) <= 20


def test_cache_invalidates_on_content_title_and_model_changes(monkeypatch, tmp_path):
    embed = mock_vectors(monkeypatch)
    books = load_playbooks()
    initial = HybridRetriever(books, cache_dir=tmp_path)
    books[0].sections[0].text += " New approved text."
    edited = HybridRetriever(books, cache_dir=tmp_path)
    assert initial.cache_path != edited.cache_path
    books[0].sections[0].title += " revised"
    renamed = HybridRetriever(books, cache_dir=tmp_path)
    assert edited.cache_path != renamed.cache_path
    monkeypatch.setattr(retrieval, "settings", type("Settings", (), {"openai_embedding_model": "another-model"})())
    changed_model = HybridRetriever(books, cache_dir=tmp_path)
    assert renamed.cache_path != changed_model.cache_path
    assert embed.call_count == 4


def test_corrupt_cache_is_rebuilt(monkeypatch, tmp_path, caplog):
    embed = mock_vectors(monkeypatch)
    retriever = HybridRetriever(cache_dir=tmp_path)
    retriever.cache_path.write_bytes(b"invalid npy")
    second = HybridRetriever(cache_dir=tmp_path)
    assert second.index is not None
    assert embed.call_count == 2
    assert "Invalid embedding cache" in caplog.text


@pytest.mark.parametrize("bad_vectors", [None, np.zeros((37, 2)), np.ones((1, 2)), np.full((37, 2), np.nan)])
def test_failed_or_invalid_embeddings_fall_back_to_bm25(monkeypatch, tmp_path, caplog, bad_vectors):
    monkeypatch.setattr(llm, "enabled", lambda: True)
    embed = Mock(side_effect=RuntimeError("unavailable")) if bad_vectors is None else Mock(return_value=bad_vectors)
    monkeypatch.setattr(llm, "embed", embed)
    retriever = HybridRetriever(cache_dir=tmp_path)
    assert retriever.mode() == "bm25"
    assert retriever.search("ransomware")[0].playbook_id == "PB-02"
    assert "using BM25 only" in caplog.text


def test_query_embedding_failure_falls_back_for_request(monkeypatch, tmp_path, caplog):
    embed = mock_vectors(monkeypatch)
    retriever = HybridRetriever(cache_dir=tmp_path)
    embed.side_effect = RuntimeError("unavailable")
    hits = retriever.search("ransomware")
    assert hits[0].playbook_id == "PB-02"
    assert all(hit.vector_rank is None for hit in hits)
    assert "Query embedding unavailable" in caplog.text
