#!/usr/bin/env python3
"""Build a browser-readable fallback snapshot from the native public Google Sheet.

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

FILE_ID = "1SA4BpAIzvyGni1vWtfShJsrmiT4e6NsNKOUAawrg-Jg"
PUB_ID = "2PACX-1vQj4w296kYOOoABSkW-C8hOFo4DQI7DrLj_M5KEAthMTO5x5NOQ0Z_TCVU9uG9IfDCl9LwLx07cCbFc"
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
    f"https://docs.google.com/spreadsheets/d/{FILE_ID}/export?format=xlsx",
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
    term_rows = sheets["מונחים | Terms"]
    header_index = next(i for i, row in enumerate(term_rows) if "מזהה מונח | Term ID" in row)
    headers = term_rows[header_index]
    id_index, label_index = headers.index("מזהה מונח | Term ID"), headers.index("תווית | Label")
    ids = set()
    for row in term_rows[header_index + 1:]:
        term_id = str(row[id_index] or "").strip() if len(row) > id_index else ""
        label = str(row[label_index] or "").strip() if len(row) > label_index else ""
        if not term_id or not label or term_id in ids:
            raise ValueError("Missing or duplicate Term ID / Label: " + term_id)
        ids.add(term_id)
    if not ids:
        raise ValueError("Terms tab is empty; refusing to publish an empty register")
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
    bundle = args.output.with_name("register-bundled.js")
    bundle.write_text("window.BUNDLED_REGISTER=" + json.dumps(result, ensure_ascii=True, separators=(",", ":")) + ";\n", encoding="utf-8")
    print(f"Validated {len(result['sheets'])} tabs from the public Google Sheet; snapshot: {args.output}")


if __name__ == "__main__":
    main()
