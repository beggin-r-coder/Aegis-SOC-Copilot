"""Build the data file for the static GitHub Pages demo.

Runs the real triage service in-process (offline rule-based mode, no API key)
over every sample alert, and records playbooks, triage results and the
evaluation report. Usage, from the repo root:

    python pages/build_demo_data.py site/demo-data.json
"""
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
os.environ["AEGIS_DATA_DIR"] = str(Path(os.environ.get("AEGIS_DATA_DIR") or ROOT / "data").resolve())
os.environ.pop("OPENAI_API_KEY", None)
sys.path.insert(0, str(ROOT / "triage-service"))

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402

def main(out: Path) -> None:
    cases = json.loads((ROOT / "data" / "eval-set.json").read_text())
    samples = [case["file"] for case in cases]
    simulation = [case["file"] for case in cases if case.get("demo")]
    with TestClient(app) as client:
        health = client.get("/health").json()
        alerts = {name: json.loads((ROOT / "data" / "alerts" / name).read_text()) for name in samples}
        triage = {name: client.post("/triage", json=alert).json() for name, alert in alerts.items()}
        data = {
            "health": health,
            "samples": samples,
            "simulation": simulation,
            "alerts": alerts,
            "triage": triage,
            "playbooks": client.get("/playbooks").json(),
            "eval": client.post("/eval").json(),
        }
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, ensure_ascii=False))
    print(f"Wrote {out} ({out.stat().st_size // 1024} KB, {len(triage)} triaged samples)")


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "site/demo-data.json"))
