"""HTTP entry point for retrieval and citation-verified incident triage."""

from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.models import Playbook, RetrievalHit, TriageResult
from app.cve import load_cves
from app.evaluation import run_eval
from app.playbooks import load_playbooks
from app.retrieval import get_retriever
from app.triage import mode, triage as run_triage


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.retriever = get_retriever()
    yield


app = FastAPI(title="Aegis Triage Service", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def invalid_request(request: Request, exc: RequestValidationError) -> JSONResponse:
    message = "Invalid request parameters."
    if any(error["loc"][0] == "body" for error in exc.errors()):
        message = "Request body must be a JSON object."
    return JSONResponse(
        status_code=400, content={"error": message}
    )


@app.get("/health")
def health(request: Request) -> dict[str, str | int]:
    retriever = request.app.state.retriever
    playbooks = retriever.playbooks
    return {
        "status": "ok",
        "mode": mode(),
        "retrievalMode": retriever.mode(),
        "playbooks": len(playbooks),
        "sections": sum(len(book.sections) for book in playbooks),
        "cves": len(load_cves()),
    }


class RetrievalResult(RetrievalHit):
    section_title: str


@app.get("/retrieve", response_model=list[RetrievalResult], response_model_by_alias=True)
def retrieve(request: Request, q: str = Query(min_length=1), k: int = Query(default=5, ge=1, le=100)):
    retriever = request.app.state.retriever
    titles = {section.id: section.title for section in retriever.sections}
    return [
        RetrievalResult(**hit.model_dump(), section_title=titles[hit.section_id])
        for hit in retriever.search(q, k)
    ]


@app.post("/triage", response_model=TriageResult, response_model_by_alias=True)
def triage(alert: dict[str, Any]) -> TriageResult:
    return run_triage(alert)


@app.get("/playbooks", response_model=list[Playbook], response_model_by_alias=True)
def playbooks() -> list[Playbook]:
    return load_playbooks()


@app.post("/eval")
def evaluate() -> dict[str, Any]:
    return run_eval()
