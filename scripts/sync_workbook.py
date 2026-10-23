#!/usr/bin/env python3
"""Build the browser-readable register from the public Excel file in Google Drive.

Run by GitHub Actions before each Pages deployment. The workbook stays authoritative;
the generated JSON is an exact, read-only snapshot with source and sync timestamps.
"""

import argparse
import hashlib
import io
import json
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from zipfile import BadZipFile, ZipFile

from openpyxl import load_workbook

FILE_ID = "1L6F6JkDnGseYN_-vlvYdaYy-LVXkCwao"
PUB_ID = "2PACX-1vRlfaBuCeBa3jsKuPwX-hIw2Kzhko8SYY4PLVGycB21Sh5uxgAtIeqlAM_NUyJztg"
SOURCE_URL = f"https://docs.google.com/spreadsheets/d/{FILE_ID}/edit"
SHEETS = (
    "חומרים | Materials",
    "ערכי חומרים | Material values",
    "מונחים | Terms",
    "ערכי מונחים | Term values",
    "קשרים | Relations",
    "ערכי קשרים | Relation values",
)
OPTIONAL_SHEETS = ("מושגים | Concepts", "ערכי מושגים | Concept values")
DOWNLOAD_URLS = (
    f"https://drive.google.com/uc?export=download&id={FILE_ID}&confirm=t",
    f"https://drive.usercontent.google.com/download?id={FILE_ID}&export=download&confirm=t",
    f"https://docs.google.com/spreadsheets/d/e/{PUB_ID}/pub?output=xlsx",
)


def valid_xlsx(payload):
    if len(payload) < 100 or len(payload) > 20_000_000 or not payload.startswith(b"PK"):
        return False
    try:
        with ZipFile(io.BytesIO(payload)) as archive:
            return "xl/workbook.xml" in archive.namelist()
    except BadZipFile:
        return False


def download_workbook():
    errors = []
    for url in DOWNLOAD_URLS:
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 (research-data-register-sync)"})
            with urlopen(request, timeout=35) as response:
                payload = response.read(20_000_001)
            if valid_xlsx(payload):
                return payload
            errors.append(f"{url.split('/')[2]} returned content that is not an XLSX workbook")
        except (HTTPError, URLError, TimeoutError) as exc:
            errors.append(f"{url.split('/')[2]}: {exc}")
    raise RuntimeError("Could not download the public Excel workbook. " + "; ".join(errors))


def read_register(payload):
    workbook = load_workbook(io.BytesIO(payload), read_only=True, data_only=True)
    missing = [name for name in SHEETS if name not in workbook.sheetnames]
    if missing:
        raise ValueError("The source workbook is missing tabs: " + ", ".join(missing))
    sheets = {}
    for name in (*SHEETS, *OPTIONAL_SHEETS):
        if name not in workbook.sheetnames:
            continue
        rows = []
        for row in workbook[name].values:
            cells = [cell.isoformat() if hasattr(cell, "isoformat") else cell for cell in row]
            while cells and cells[-1] is None:
                cells.pop()
            if any(cell is not None and str(cell).strip() for cell in cells):
                rows.append(cells)
        if not any(any(str(cell or "").strip().startswith(("מזהה חומר |", "מזהה מונח |", "מזהה קשר |", "רמת תיעוד |", "סוג תווית |", "סוג צומת |", "מזהה מושג |", "מעמד מושגי |")) for cell in row) for row in rows[:8]):
            raise ValueError(f"No recognized bilingual header row in {name}")
        sheets[name] = rows
    if not any("TERM-" in str(row) for row in sheets["מונחים | Terms"]):
        raise ValueError("Terms tab has no TERM IDs; refusing to publish an empty register")
    return {"schemaVersion": 1, "sourceUrl": SOURCE_URL,
            "publishedUrl": f"https://docs.google.com/spreadsheets/d/e/{PUB_ID}/pubhtml",
            "fileId": FILE_ID, "generatedAt": datetime.now(timezone.utc).isoformat(),
            "sha256": hashlib.sha256(payload).hexdigest(), "sheets": sheets}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, help="Local workbook for an offline build/test")
    parser.add_argument("--output", type=Path, default=Path("data/register.json"))
    args = parser.parse_args()
    payload = args.file.read_bytes() if args.file else download_workbook()
    if not valid_xlsx(payload):
        raise ValueError("Input is not a valid .xlsx workbook")
    result = read_register(payload)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Validated {len(result['sheets'])} tabs from the original Excel workbook; snapshot: {args.output}")


if __name__ == "__main__":
    main()
