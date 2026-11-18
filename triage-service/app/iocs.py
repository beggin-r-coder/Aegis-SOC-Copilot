"""Walk untrusted alert data and extract indicators without executing content."""

from collections import defaultdict
from collections.abc import Iterator
import ipaddress
import json
import re
from typing import Any
from urllib.parse import urlsplit


_IPV4 = re.compile(r"(?<![\w.])(?:\d{1,3}\.){3}\d{1,3}(?![\w.])")
_SHA256 = re.compile(r"(?<!\w)[a-f0-9]{64}(?!\w)", re.IGNORECASE)
_MD5 = re.compile(r"(?<!\w)[a-f0-9]{32}(?!\w)", re.IGNORECASE)
_URL = re.compile(r"https?://[^\s<>\"']+", re.IGNORECASE)
_EMAIL = re.compile(r"(?<![\w.+-])[\w.!#$%&'*+/=?^`{|}~-]+@(?:[a-z0-9-]+\.)+[a-z]{2,}\b", re.IGNORECASE)
_CVE = re.compile(r"\bCVE-\d{4}-\d{4,}\b", re.IGNORECASE)
_NAMED = {
    "host": "host", "hostname": "host", "target": "host",
    "user": "user", "username": "user", "principal": "user",
    "bucket": "bucket", "process": "process",
}


def flatten(alert: Any) -> Iterator[tuple[str, str, Any]]:
    """Yield dotted paths with array indices; preserve scalar leaf values."""
    def walk(value: Any, path: str, key: str):
        if isinstance(value, dict):
            for child_key, child in value.items():
                if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", child_key):
                    child_path = f"{path}.{child_key}" if path else child_key
                else:
                    child_path = f"{path}[{json.dumps(child_key, ensure_ascii=False)}]"
                yield from walk(child, child_path, child_key)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                yield from walk(child, f"{path}[{index}]", key)
        else:
            yield path, key, value

    yield from walk(alert, "", "")


def extract_iocs(alert: Any) -> dict[str, list[str]]:
    found: dict[str, set[str]] = defaultdict(set)
    for path, key, value in flatten(alert):
        if not isinstance(value, str):
            continue
        if key.casefold() in _NAMED and value.strip():
            found[_NAMED[key.casefold()]].add(value.strip())
        # EDR alerts commonly represent a process as an object rather than a string.
        if re.search(r"(?:^|\.)process\.(?:name|executable)$", path, re.IGNORECASE) and value.strip():
            found["process"].add(value.strip())
        for candidate in _IPV4.findall(value):
            try:
                address = ipaddress.IPv4Address(candidate)
            except ipaddress.AddressValueError:
                continue
            found["ip"].add(str(address))
        found["sha256"].update(token.lower() for token in _SHA256.findall(value))
        found["md5"].update(token.lower() for token in _MD5.findall(value))
        found["cve"].update(token.upper() for token in _CVE.findall(value))
        for raw_url in _URL.findall(value):
            url = raw_url.rstrip(".,;:!?)]}")
            try:
                domain = urlsplit(url).hostname
            except ValueError:
                continue
            if domain:
                found["url"].add(url)
                try:
                    ipaddress.ip_address(domain)
                except ValueError:
                    found["domain"].add(domain.lower())
        for email in _EMAIL.findall(value):
            found["email"].add(email.lower())
            found["domain"].add(email.rsplit("@", 1)[1].lower())
    return {kind: sorted(values) for kind, values in sorted(found.items()) if values}
