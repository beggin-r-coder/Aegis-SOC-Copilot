"""Load approved playbook text without rewriting citation content."""

import re

from app.config import settings
from app.models import Playbook, PlaybookSection


_HEADER = re.compile(r"^# (PB-\d{2}) (.+)$", re.MULTILINE)
_SECTION = re.compile(r"^## §(\d+\.\d+) (.+)$", re.MULTILINE)
_SECTION_ID = re.compile(r"(PB-\d{2})\s+§?(\d+\.\d+)")


def _parse(text: str) -> Playbook:
    header = _HEADER.search(text)
    headings = list(_SECTION.finditer(text))
    if header is None or not headings:
        raise ValueError("Playbook requires a PB header and numbered sections")
    playbook_id, name = header.groups()
    metadata = text[header.end():headings[0].start()]
    classification = re.search(r"^classification: (.+)$", metadata, re.MULTILINE)
    keywords = re.search(r"^keywords: (.+)$", metadata, re.MULTILINE)
    if classification is None or keywords is None:
        raise ValueError(f"{playbook_id}: missing classification or keywords")

    sections = []
    for index, heading in enumerate(headings):
        number, title = heading.groups()
        approval = title.endswith(" (approval)")
        if approval:
            title = title.removesuffix(" (approval)")
        end = headings[index + 1].start() if index + 1 < len(headings) else len(text)
        body = text[heading.end():end].strip()
        if not body:
            raise ValueError(f"{playbook_id} §{number}: empty section")
        sections.append(PlaybookSection(
            id=f"{playbook_id} §{number}", playbook_id=playbook_id,
            playbook_name=name, number=number, title=title, text=body,
            requires_approval=approval,
        ))
    if len({section.id for section in sections}) != len(sections):
        raise ValueError(f"{playbook_id}: duplicate section id")
    return Playbook(
        id=playbook_id, name=name, classification=classification.group(1).strip(),
        keywords=[keyword.strip() for keyword in keywords.group(1).split(",") if keyword.strip()],
        sections=sections,
    )


def load_playbooks() -> list[Playbook]:
    directory = (settings.data_dir / "playbooks").resolve()
    playbooks = []
    for filename in (directory / "index.txt").read_text(encoding="utf-8").splitlines():
        if not filename.strip():
            continue
        path = (directory / filename.strip()).resolve()
        if path.parent != directory:
            raise ValueError("Playbook index entries must name files in the playbooks directory")
        playbooks.append(_parse(path.read_text(encoding="utf-8")))
    if len({book.id for book in playbooks}) != len(playbooks):
        raise ValueError("Duplicate playbook id in index")
    return playbooks


def all_sections() -> list[PlaybookSection]:
    return [section for book in load_playbooks() for section in book.sections]


def get_section(raw_id: str) -> PlaybookSection | None:
    identifier = raw_id.strip()
    if identifier.startswith("[") and identifier.endswith("]"):
        identifier = identifier[1:-1].strip()
    match = _SECTION_ID.fullmatch(identifier)
    if match is None:
        return None
    canonical = f"{match[1]} §{match[2]}"
    return next((section for section in all_sections() if section.id == canonical), None)
