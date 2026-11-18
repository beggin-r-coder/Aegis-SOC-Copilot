"""Match the local CVE feed to extracted identifiers and alert keywords."""

import json

from app.config import settings
from app.models import Cve


def load_cves() -> list[Cve]:
    records = json.loads((settings.data_dir / "cve-feed.json").read_text(encoding="utf-8"))
    return [Cve.model_validate(record) for record in records]


def match(alert_text: str, iocs: dict[str, list[str]]) -> list[Cve]:
    text = alert_text.casefold()
    identifiers = {value.casefold() for values in iocs.values() for value in values}
    return [
        cve for cve in load_cves()
        if cve.id.casefold() in identifiers
        or any(keyword and keyword.casefold() in text for keyword in cve.keywords)
    ]
