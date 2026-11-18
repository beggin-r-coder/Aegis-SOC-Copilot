"""BM25 and optional cached FAISS retrieval over approved playbook sections."""

import hashlib
from functools import lru_cache
import json
import logging
from pathlib import Path
import re
import tempfile

import faiss
import numpy as np
from rank_bm25 import BM25Okapi

from app import llm
from app.config import SERVICE_DIR, settings
from app.injection import scan
from app.iocs import flatten
from app.models import Playbook, RetrievalHit
from app.playbooks import load_playbooks


logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_retriever() -> "HybridRetriever":
    return HybridRetriever()


def _tokens(text: str) -> list[str]:
    return re.findall(r"\b\w+\b", text.lower().replace("_", " "))


def _query_text(query: str) -> str:
    """Use alert values, excluding injection fields, when a query is JSON."""
    try:
        alert = json.loads(query)
    except (ValueError, RecursionError):
        return query
    if not isinstance(alert, (dict, list)):
        return query
    excluded = {finding.field for finding in scan(alert)}
    return " ".join(
        value for path, _, value in flatten(alert)
        if isinstance(value, str) and path not in excluded
    )


def _normalise(vectors: np.ndarray, rows: int) -> np.ndarray:
    vectors = np.array(vectors, dtype=np.float32, order="C", copy=True)
    if vectors.ndim != 2 or vectors.shape[0] != rows or vectors.shape[1] == 0:
        raise ValueError("Invalid embedding dimensions")
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    if not np.isfinite(vectors).all() or not np.isfinite(norms).all() or (norms == 0).any():
        raise ValueError("Embeddings must contain finite, nonzero vectors")
    return np.ascontiguousarray(vectors / norms, dtype=np.float32)


class HybridRetriever:
    def __init__(self, playbooks: list[Playbook] | None = None, cache_dir: Path | None = None):
        self.playbooks = load_playbooks() if playbooks is None else playbooks
        self.sections = [section for book in self.playbooks for section in book.sections]
        self.documents = [
            f"{section.playbook_name} - {section.title}\n{section.text}"
            for section in self.sections
        ]
        corpus = [_tokens(document) for document in self.documents]
        self.bm25 = BM25Okapi(corpus) if corpus else None
        self.embedding_model = settings.openai_embedding_model
        digest = hashlib.sha1(json.dumps(self.documents, ensure_ascii=False).encode("utf-8")).hexdigest()
        safe_model = re.sub(r"[^A-Za-z0-9._-]", "_", self.embedding_model)
        self.cache_path = (cache_dir if cache_dir is not None else SERVICE_DIR / ".cache") / f"embeddings-{safe_model}-{digest}.npy"
        self.index = None
        if self.sections and llm.enabled():
            try:
                vectors = self._document_vectors()
                index = faiss.IndexFlatIP(vectors.shape[1])
                index.add(vectors)
                self.index = index
            except Exception as exc:
                logger.warning("Embedding index unavailable (%s); using BM25 only", type(exc).__name__)

    def _document_vectors(self) -> np.ndarray:
        if self.cache_path.exists():
            try:
                return _normalise(np.load(self.cache_path, allow_pickle=False), len(self.sections))
            except Exception as exc:
                logger.warning("Invalid embedding cache (%s); rebuilding", type(exc).__name__)
        vectors = _normalise(llm.embed(self.documents), len(self.sections))
        # Cache failures should not discard a working in-memory vector index.
        temporary = None
        try:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(dir=self.cache_path.parent, suffix=".npy", delete=False) as handle:
                temporary = Path(handle.name)
                np.save(handle, vectors, allow_pickle=False)
            temporary.replace(self.cache_path)
        except OSError as exc:
            logger.warning("Could not save embedding cache (%s)", type(exc).__name__)
        finally:
            if temporary is not None and temporary.exists():
                temporary.unlink()
        return vectors

    def mode(self) -> str:
        return f"hybrid (faiss + bm25, {self.embedding_model})" if self.index is not None else "bm25"

    def search(self, query: str, k: int = 5) -> list[RetrievalHit]:
        query = _query_text(query)
        tokens = _tokens(query)
        if k <= 0 or not tokens or self.bm25 is None:
            return []
        scores = self.bm25.get_scores(tokens)
        bm25_order = [int(i) for i in np.argsort(-scores, kind="stable") if scores[i] > 0][:20]
        bm25_ranks = {index: rank for rank, index in enumerate(bm25_order, 1)}
        vector_ranks = {}
        if self.index is not None:
            try:
                vector = _normalise(llm.embed([query]), 1)
                if vector.shape[1] != self.index.d:
                    raise ValueError("Query embedding dimension changed")
                _, indices = self.index.search(vector, min(20, len(self.sections)))
                vector_ranks = {int(index): rank for rank, index in enumerate(indices[0], 1) if index >= 0}
            except Exception as exc:
                logger.warning("Query embedding unavailable (%s); using BM25 only", type(exc).__name__)
        hits = []
        for index in bm25_ranks.keys() | vector_ranks.keys():
            bm25_rank = bm25_ranks.get(index)
            vector_rank = vector_ranks.get(index)
            score = sum(1 / (60 + rank) for rank in (bm25_rank, vector_rank) if rank is not None)
            section = self.sections[index]
            hits.append(RetrievalHit(
                section_id=section.id, playbook_id=section.playbook_id, score=score,
                bm25_rank=bm25_rank, vector_rank=vector_rank,
            ))
        return sorted(hits, key=lambda hit: (-hit.score, hit.section_id))[:k]

    def rank_playbooks(self, query: str) -> list[dict[str, str | float | int]]:
        """Return playbookId, best section score, and keywordHits for each playbook."""
        query = _query_text(query)
        best = {}
        for hit in self.search(query, k=len(self.sections)):
            best[hit.playbook_id] = max(best.get(hit.playbook_id, 0), hit.score)
        query = query.lower().replace("_", " ")
        rankings = []
        for book in self.playbooks:
            keyword_hits = sum(
                bool(re.search(r"(?<!\w)" + re.escape(keyword.lower().replace("_", " ")) + r"(?!\w)", query))
                for keyword in book.keywords if keyword
            )
            rankings.append({"playbookId": book.id, "score": best.get(book.id, 0.0), "keywordHits": keyword_hits})
        return sorted(rankings, key=lambda item: (-item["score"], item["playbookId"]))
