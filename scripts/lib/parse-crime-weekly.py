#!/usr/bin/env python3
"""Download 13166 crime weekly ZIP, parse latest ODS, emit JSON on stdout."""
from __future__ import annotations

import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

DATASET_PAGE_URL = "https://data.gov.tw/dataset/13166"
ZIP_URL = (
    "https://opdadm.moi.gov.tw/api/v1/no-auth/resource/api/dataset/"
    "6D9C7F00-3E4C-4FC7-BEDB-28D70FF96FEE/resource/"
    "2135CF37-2C60-494B-9286-C5AA44A7A957/download"
)
ZIP_URL_RE = re.compile(
    r"https://opdadm\.moi\.gov\.tw/api/v1/no-auth/resource/api/dataset/"
    r"6D9C7F00-3E4C-4FC7-BEDB-28D70FF96FEE/resource/"
    r"[0-9A-Fa-f-]{36}/download"
)
USER_AGENT = "Mozilla/5.0 (compatible; TaiwanIntelDashboard/1.0)"
CASE_TYPES = ["強盜", "搶奪", "強制性交", "汽車竊盜", "住宅竊盜", "毒品", "機車竊盜"]
NS = {
    "office": "urn:oasis:names:tc:opendocument:xmlns:office:1.0",
    "table": "urn:oasis:names:tc:opendocument:xmlns:table:1.0",
    "text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0",
}


def roc_key(name: str) -> tuple[int, ...]:
    digits = re.findall(r"\d+", name)
    return tuple(int(x) for x in digits[:6]) if len(digits) >= 6 else (0,)


def period_label(key: tuple[int, ...]) -> str:
    if len(key) < 6:
        return ""
    y1, m1, d1, y2, m2, d2 = key
    return f"{y1}年{m1}月{d1}日至{y2}年{m2}月{d2}日"


def period_end_iso(key: tuple[int, ...]) -> str | None:
    if len(key) < 6:
        return None
    y2, m2, d2 = key[3], key[4], key[5]
    year = y2 + 1911
    return f"{year}-{m2:02d}-{d2:02d}T12:00:00+08:00"


def cell_val(cell: ET.Element) -> str:
    value = cell.get("{urn:oasis:names:tc:opendocument:xmlns:office:1.0}value")
    if value is not None:
        return str(value).strip()
    texts = [node.text or "" for node in cell.findall(".//text:p", NS)]
    return "".join(texts).strip()


def row_vals(row: ET.Element) -> list[str]:
    cells: list[str] = []
    for cell in row.findall("table:table-cell", NS):
        repeated = int(
            cell.get("{urn:oasis:names:tc:opendocument:xmlns:table:1.0}number-columns-repeated", "1")
        )
        val = cell_val(cell)
        cells.extend([val] * repeated)
    return cells


def parse_table(rows: list[list[str]]) -> dict[str, int]:
    header: list[str] | None = None
    current: dict[str, int] = {}
    for row in rows:
        trimmed = row[:20]
        if not any(str(x).strip() for x in trimmed):
            continue
        if "強盜" in trimmed and ("案類別" in trimmed or trimmed[1] == "案類別"):
            header = trimmed
            continue
        if not header or len(trimmed) < 2:
            continue
        label = trimmed[1]
        if label != "當期發生數":
            continue
        for case_type in CASE_TYPES:
            if case_type not in header:
                continue
            idx = header.index(case_type)
            raw = trimmed[idx] if idx < len(trimmed) else ""
            try:
                current[case_type] = int(float(raw))
            except (TypeError, ValueError):
                current[case_type] = 0
        break
    return current


def fetch_bytes(url: str, *, timeout: int, limit: int) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        data = response.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"resource exceeds {limit} bytes")
    return data


def discover_zip_url() -> str | None:
    page = fetch_bytes(DATASET_PAGE_URL, timeout=20, limit=1_000_000).decode("utf-8", "replace")
    match = ZIP_URL_RE.search(page)
    return match.group(0) if match else None


def download_zip() -> bytes:
    # The portal rotates resource IDs. Prefer its current official link, while
    # retaining the last verified link if the portal page itself is unavailable.
    try:
        discovered = discover_zip_url()
    except (OSError, ValueError) as error:
        print(f"dataset page unavailable: {error}", file=sys.stderr)
        discovered = None
    urls = list(dict.fromkeys(url for url in (discovered, ZIP_URL) if url))
    last_error: Exception | None = None
    for index, url in enumerate(urls):
        attempts = 3 if index == 0 else 1
        for attempt in range(attempts):
            try:
                data = fetch_bytes(url, timeout=30, limit=40_000_000)
                if not data.startswith(b"PK"):
                    raise ValueError("weekly crime resource is not a ZIP")
                return data
            except urllib.error.HTTPError as error:
                last_error = error
                transient = error.code == 429 or 500 <= error.code <= 599
            except (urllib.error.URLError, TimeoutError) as error:
                last_error = error
                transient = True
            if not transient or attempt + 1 >= attempts:
                break
            time.sleep(2 ** attempt)
    raise RuntimeError(f"weekly crime ZIP download failed: {last_error}")


def main() -> int:
    data = download_zip()
    outer = zipfile.ZipFile(io.BytesIO(data))
    ods_names = [name for name in outer.namelist() if name.lower().endswith(".ods")]
    if not ods_names:
        print(json.dumps({"error": "no ODS in ZIP"}, ensure_ascii=False))
        return 1

    best_name = max(ods_names, key=roc_key)
    key = roc_key(best_name)
    inner = zipfile.ZipFile(io.BytesIO(outer.read(best_name)))
    root = ET.fromstring(inner.read("content.xml"))

    stats: dict[str, int] = {}
    compiled_at = ""
    for table in root.findall(".//table:table", NS):
        rows = [row_vals(tr) for tr in table.findall("table:table-row", NS)]
        parsed = parse_table(rows)
        if parsed:
            stats = parsed
            for row in rows:
                for cell in row:
                    if "中華民國" in str(cell) and "編製" in str(cell):
                        compiled_at = str(cell).strip()
            break

    if not stats:
        print(json.dumps({"error": "failed to parse weekly stats"}, ensure_ascii=False))
        return 1

    payload = {
        "fileName": best_name,
        "period": period_label(key),
        "periodEnd": period_end_iso(key),
        "compiledAt": compiled_at,
        "currentCounts": stats,
        "totalCurrent": sum(stats.values()),
        "datasetId": "13166",
        "sourceUrl": "https://data.gov.tw/dataset/13166",
    }
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
