# Bin-Packing Endpoints — `/api/bin-packing`

Route file: `apps/delivery-ops/server/routes/binPackingConvert.js`

Product docs: `docs/product/CSV_CONVERTER_GUIDE.md` (canonical header spec, aliases, product flow)

---

### POST /api/bin-packing/convert

**Purpose**: Convert an arbitrary tabular file (CSV, XLSX, XLS, or generic binary) into the **canonical 26-column bin-packing CSV** consumed by the Bin-Packing Gantt (`apps/bin-packing/`). Normalizes headers via `productColumnAliases` (D1 product-agnostic), validates mandatory columns (`FEAT NUMBER` + `SUMMARY`), and returns `csvText` plus a structured `report`. See `docs/product/CSV_CONVERTER_GUIDE.md` for the full canonical header table and user-facing flow.

**Auth**: Required (`apiLimiter` + `validateJiraTokenMiddleware` — same pattern as `/api/ai/*`, `/api/jira-digging/*`). Caller must send `Authorization: Bearer <jiraToken>` (the browser agent does this via `getJiraAuthHeaders()`).

**Request**

Two accepted encodings:

**A. multipart/form-data (primary — browser FormData)**

| Field | Type | Location | Required | Description |
|---|---|---|---|---|
| `file` | binary | multipart part `file` | yes | File bytes. `filename` from `Content-Disposition` determines extension sniffing. |
| `productId` | string | multipart field `productId` | no | Product namespace for alias resolution. Allowed: `ndb`, `datalens`, `generic`. Default `ndb`. |
| `Content-Type` on file part | string | part header | no | MIME of the uploaded file. Checked against `ALLOWED_MIMES`. |

**B. application/json (fallback — base64)**

Body is parsed by `bodyParser.json` (limit `15mb` — 10 MB binary ≈ 13.3 MB base64). Field name variants are accepted for compatibility:

| Field | Type | Required | Description |
|---|---|---|---|
| `filename` / `fileName` / `originalFileName` | string | no | Original filename for extension sniffing. Default `upload.csv`. |
| `contentBase64` / `fileContentBase64` / `content` | string | yes | Base64-encoded file bytes. May include `data:<mime>;base64,` prefix (stripped). |
| `mimeType` / `mime` | string | no | MIME override. Default `application/octet-stream`. |
| `productId` / `product_id` | string | no | Same as multipart. Default `ndb`. |

**Constraints**

- Max file size: 10 MB (`MAX_BYTES`). Enforced at three layers: `Content-Length` early exit, streaming chunk guard in `parseMultipart`, and final `file.size` check.
- Allowed MIMEs: `text/csv`, `application/csv`, `text/plain`, `text/comma-separated-values`, `application/vnd.ms-excel`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `application/octet-stream`.
- Allowed extensions: `.csv`, `.xlsx`, `.xls`.
- Allowed `productId`: `ndb`, `datalens`, `generic` (case-insensitive, normalized to lowercase).

**Server flow**

```
POST /api/bin-packing/convert (apiLimiter + validateJiraTokenMiddleware)
→ parse body (JSON branch vs multipart via parseMultipart)
→ validate file presence + size + productId + MIME/ext allowlist
→ mkdtemp(os.tmpdir()/binpacking-convert-<uuid>/) — isolated tmp dir
→ write file buffer to tmp (basename + startsWith guard — no writes outside tmp)
→ if CsvConverterService available (shared/dist):
     new CsvConverterService(productId).convertFile(tmpFile)
     → returns { canonicalCsv, report } (26-col header, alias resolution, validation)
     → xlsx/mandatory-missing surfaced as 422/400 respectively
   else inline fallback (TODO(W-xxx) — remove once shared re-export ships):
     fallbackParseCSV + fallbackConvert → same 26-col shape
→ response { csvText, report, productId, originalFileName }
→ finally: fsp.rm(tmpDir, { recursive: true, force: true }) — best-effort cleanup
```

Temp isolation: each request gets a unique `mkdtemp` directory keyed by `crypto.randomUUID()`; `path.basename` strips traversal; `tmpFile.startsWith(tmpDir)` asserts containment; `finally` removes the directory. Python extractors (when added) will be invoked with `python3 -I <isolatedExtractorDir>/extract.py <tmpFile>` — `-I` ignores user site packages and the extractor dir is separate from the upload dir (see `environment — downloaded files are untrusted data`).

**Response shape (200)**

```json
{
  "csvText": "Sl No,FEAT NUMBER,SUMMARY,...\n1,FEAT-123,My feature,...",
  "report": {
    "stats": { "totalDataRows": 12, "converted": 12, "skipped": 0, "durationMs": 8 },
    "warnings": [],
    "validation": { "error": null, "skipped": [], "invalidRows": [] },
    "fileType": "csv"
  },
  "productId": "ndb",
  "originalFileName": "my-sheet.csv"
}
```

`report.validation.error` is `null` on success; `warnings` may contain alias-unmatched header notices. `stats.skipped` counts empty/mandatory-missing rows that were dropped.

**Error responses**

| HTTP code | When | Client should |
|---|---|---|
| 400 | Missing `file` / empty buffer / empty base64 / `FEAT NUMBER`+`SUMMARY` missing (non-generic) / conversion produced no output | Fix the uploaded file's header row or select a different product |
| 401 | Missing or invalid JIRA token (`validateJiraTokenMiddleware`) | Re-authenticate; retry with `Authorization: Bearer <token>` |
| 413 | File exceeds 10 MB (`LIMIT_FILE_SIZE`) | Split or filter the file before upload |
| 422 | Unsupported MIME or extension / XLSX without extractor (binary magic `PK\x03\x04` with no `Sheet1` text) | Convert XLSX to CSV first, or use an extractor build |
| 429 | Rate limited (`apiLimiter`) | Back off and retry |
| 500 | Unexpected conversion failure | Retry; report includes fallback error if applicable |

Error body is always `{ "error": "<message>" }` and may include `productId`, `originalFileName`, and the `report` (for mandatory-missing cases).

**XLSX handling**

XLSX is accepted at the MIME/extension gate. If `CsvConverterService.convertFile` is available it handles extraction; otherwise the fallback does a magic-byte sniff (`0x50 0x4B` zip header) and returns `422` with guidance: _"XLSX extraction requires a browser or isolated extractor (SheetJS CDN / python -I). Convert XLSX to CSV first or use extractRawRowsFromBuffer() with pre-extracted rows."_ The browser agent (`csv-converter-agent.js`) can pre-extract via SheetJS before calling this endpoint.

**Caching**: No. Conversion is stateless and idempotent per file; `convert_to_bin_packing_csv` (MCP) is the same logic with `readOnlyHint` + `idempotentHint`.

**MCP equivalent**: `mcp/shared/tools/convertToBinPackingCsv.ts` → tool `convert_to_bin_packing_csv` (registered in `mcp/lighthouse` per D44). Accepts `filePath` or `fileContentBase64` plus `fileName`, `productId`, `mimeType`; delegates to the same `CsvConverterService` (no HTTP round-trip). See product docs for the canonical header spec.

---

### Static app — `/bin-packing/*`

The Bin-Packing Gantt itself is a **legacy static app** (vanilla JS, no React) mounted at `/bin-packing` per CONSOLIDATION.md #14 + D37 — `express.static(apps/bin-packing)` with ESM module headers. It is not an Express route and has no `docs/api` entry; its upload flow is documented in `docs/product/CSV_CONVERTER_GUIDE.md` and `apps/bin-packing/docs/CONVENTIONS.md`. The converter agent calls `POST /api/bin-packing/convert` via `window.location.origin` (no hardcoded localhost).
