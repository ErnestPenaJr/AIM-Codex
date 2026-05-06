# Entity Rankings Datatable — Rebuild Spec

This doc tells Claude Code everything needed to rebuild the **Entity Rankings** table on the dashboard from scratch. The source of truth for data is `bsa_mock_data_500.csv`; `prisma/dev.db` is a derived cache produced by `scripts/import.js`.

---

## 1. Data sources

### 1a. `bsa_mock_data_500.csv` (authoritative, 500 rows + header)

Raw BSAR (Bank Secrecy Act Report) mock data. A copy is mirrored at `public/bsa_mock_data_500.csv` for the static Netlify deploy — **keep both files in sync**.

CSV columns (in order):

| # | Column | Notes / quirks |
|---|--------|----------------|
| 1  | `Record #` | 1-based row index |
| 2  | `Form Type` | Always `BSAR` in this sample |
| 3  | `BSA ID` | 14-digit string |
| 4  | `Filing Date` | `MM/DD/YYYY` |
| 5  | `Entry Date` | `MM/DD/YYYY` |
| 6  | `Transaction Date` | `MM/DD/YYYY` |
| 7  | `Subject Name` | `LAST/FIRST[/M]` (duplicates are expected — they power rankings) |
| 8  | `Subject State` | 2-letter US state of residence |
| 9  | `Subject Date of Birth` | `YYYY-MM-DD` |
| 10 | `Subject EIN/SSN` | **Quoted, contains commas** — parse as CSV-quoted; first 3 digits used to derive `zip3` |
| 11 | `Amount Total` | **Quoted, `$` and commas** — strip non-numeric before parsing |
| 12 | `Suspicious Activity Type` | Semicolon-delimited multi-value |
| 13 | `Total Cash In` | Integer (0 when N/A) |
| 14 | `Total Cash Out` | Integer (0 when N/A) |
| 15 | `Transaction Type` | Often blank |
| 16 | `Attachment (Y/N)` | Y/N |
| 17 | `Filing Institution Primary Regulator` | `FinCEN`, `FDIC`, `OCC`, `IRS`, `NCUA`, `Federal Reserve`, `State Banking Authority` |
| 18 | `Filing Institution Type` | `Money Service Business`, `Depository Institution`, `Insurance Company`, `Loan or Finance Company`, `Casino/Card Club` |
| 19 | `Latest Filing` | Y/N |
| 20 | `Foreign Cash In` | Integer |
| 21 | `Foreign Cash Out` | Integer |
| 22 | `Filing Institution State` | 2-letter state where activity was reported |
| 23 | `Is Amendment` | Y/N |
| 24 | `Receipt Date` | `MM/DD/YYYY` |

**Important data shape:** Many subjects recur. Actual distribution of `Subject Name` in the current CSV: `HUDSON/WILLIAM/A` appears 18×, several subjects appear 12×, others 9× or fewer. Rankings depend on this.

### 1b. `prisma/dev.db` (SQLite, derived)

Schema: see `prisma/schema.prisma` → `BsaReport` model. Columns map 1:1 to the CSV plus two **derived** fields:

- `riskLevel` — classified from `amountTotal` by `scripts/import.js:classifyRisk`:
  - `TOP`    if amount ≥ 50,000
  - `HIGH`   if amount ≥ 20,000
  - `MODERATE` if amount ≥ 5,000
  - `LOW`    otherwise (including null/NaN)
- `zip3` — first 3 digits extracted from `Subject EIN/SSN` (`scripts/import.js:deriveZip3`), fallback `"000"`.

**⚠️ The committed `prisma/dev.db` is stale** — it has 500 rows with 500 distinct `subjectName` values, while the current CSV has many duplicates. Before rebuilding, run:

```bash
npx prisma generate
npm run db:push
npm run db:seed
```

---

## 2. What the datatable is

**Name:** Entity Rankings (`public/index.html` § `.table-panel`, heading at line 166).

**Purpose:** Aggregate all BSA records by `Subject Name` and rank entities by suspicious-transaction volume. Each row is one entity, not one transaction.

### 2a. Columns (in display order)

| Header | Sort key (`data-sort`) | Source | Aggregation rule |
|---|---|---|---|
| Risk | `riskLevel` | derived | Highest risk across the entity's records. Priority `TOP > HIGH > MODERATE > LOW`. Cell gets class `risk-cell risk-cell--{lowercase}`. |
| Link ID | `linkId` | derived | 6-char uppercase hex = `abs(hash(zip3 \|\| subjectState \|\| "000") + "-" + (hash(subjectName) % 4))`, zero-padded. **Rank overrides:** rows 1–4 force `DEMO01`, rows 5–8 force `DEMO02`. Rendered as a `<button class="link-id-action">` only when the entity is flagged `related` (see §3). Non-related entities show an empty cell. |
| Entity | `subjectName` | CSV col 7 | Primary key for the group. |
| Transactions | `transactionCount` | CSV | `COUNT(*)` in group. |
| Total Amount | `totalAmount` | CSV | `SUM(amountTotal)` in group (coerce nulls to 0). |
| Activity Location | `activityLocation` | CSV | Sorted, comma-joined **union of `subjectState` + `institutionState`** across the group. Empty string becomes `—` at render time. |
| First Transaction | `firstTransactionDate` | CSV | `MIN(transactionDate)`. |
| Last Transaction | `lastTransactionDate` | CSV | `MAX(transactionDate)`. |

### 2b. Ranking / slicing rules

- **Primary sort:** `transactionCount DESC`.
- **Tiebreaker:** `totalAmount DESC`.
- **Cap:** top **50** entities. Not configurable from the UI.
- Index positions after the cap determine the `DEMO01`/`DEMO02` overrides above.

### 2c. Relation flag (`related` / link-id visibility)

The Link ID cell is only clickable when the entity is part of a "relation cluster". Cluster construction (`buildSubjectRelations` + `selectLinkedSubjects` in `public/app.js`):

1. For each of these fields, group subjects that share the same value: `subjectState`, `zip3`, `institutionState`, `riskLevel`, `suspiciousActivityType`, `transactionType`, `bsaId`, `formType`.
2. Any group with ≥2 subjects contributes edges into an undirected graph.
3. Run BFS over the top-50 ranked subjects to find connected components.
4. Mark subjects as `related` component-by-component until ≥ **25%** of the top-50 are flagged (`targetRate = 0.25`).
5. Non-`related` entities get `linkId = ""` in the final row payload.

---

## 3. Runtime behavior (must match both modes)

The dashboard ships in two modes that share the frontend:

- **Static / Netlify:** `public/app.js` loads `public/bsa_mock_data_500.csv` client-side and computes everything in-browser.
- **Server / Express:** `server.js` exposes `/api/subject-rankings` via Prisma. Used when running `npm run dev`.

Both paths must produce identical row shape:

```ts
{
  subjectName: string,
  linkId: string,               // "" if not related
  related: boolean,             // only set client-side
  riskLevel: "TOP" | "HIGH" | "MODERATE" | "LOW",
  transactionCount: number,
  totalAmount: number,
  activityLocation: string | null,
  firstTransactionDate: ISOString | null,
  lastTransactionDate: ISOString | null,
}
```

Server endpoint (`server.js:/api/subject-rankings`) currently returns a `residenceLocation` string instead of a unioned `activityLocation`, **and does not compute `riskLevel` per entity or the `related` flag**. When rebuilding, bring the server output into parity with the CSV path — both should run the aggregation described in §2a/§2b and the relation logic in §2c.

### 3a. Table state (client-only)

Managed by `tableState` in `public/app.js`:

```js
{ sortKey: "riskLevel", sortDir: "desc",
  search: "", startDate: "", endDate: "",
  pageSize: 15, page: 1, linkId: "" }
```

Control IDs in `index.html`: `#table-page-size`, `#table-link-filter`, `#table-search`, `#table-start-date`, `#table-end-date`, `#table-prev-page`, `#table-next-page`, `#table-page-buttons`, `#table-page-indicator`, `#table-caption`, `#records-body`. Header `<th>`s use `class="sortable" data-sort="…"` and toggle `sorted-asc` / `sorted-desc` classes via `updateSortIndicators()`.

### 3b. Filtering pipeline

1. **Global filters** (sidebar) → `applyAppFilters(records, filters)`: filters raw records by `subjectName`, `riskLevel`, `transactionType`, `residenceState`→`subjectState`, `activityState`→`institutionState`, `criminalHistory`.
2. **Aggregation** → `buildSubjectRankingsFromRecords` (top 50, ranked).
3. **Relation flagging** → `buildSubjectRelations` + `selectLinkedSubjects(0.25)`.
4. **Table-local filters** → `applyTableFilters`:
   - `linkId`: substring, case-insensitive.
   - `search`: substring over concatenated `subjectName / linkId / activityLocation / transactionCount / totalAmount / firstTransactionDate / lastTransactionDate`.
   - Date range: row kept if `[firstTransactionDate, lastTransactionDate]` **overlaps** `[startDate, endDate]` (rows missing either date are dropped when a date filter is active).
5. **Sort** → `applyTableSort` via `compareValues`:
   - Numeric: `totalAmount`, `transactionCount`.
   - Risk: mapped by `{TOP:3, HIGH:2, MODERATE:1, LOW:0}`.
   - Date: ms since epoch (nulls → 0).
   - Otherwise: `localeCompare`.
6. **Paginate** → `tableState.pageSize`, render via `renderSubjectRankings()`.

### 3c. Row interactions

- Clicking anywhere on the `<tr data-subject="…">` opens the subject drilldown modal via `showSubjectDetails(subjectName)`.
- Clicking a `.link-id-action` button filters the table down to that Link ID (sets `tableState.linkId` and re-renders) — do **not** let it propagate to the row click.

---

## 4. Rebuild checklist

1. Reseed the database so it matches the current CSV (see §1b). Verify: `sqlite3 prisma/dev.db "SELECT subjectName, COUNT(*) c FROM BsaReport GROUP BY subjectName ORDER BY c DESC LIMIT 3"` should show `HUDSON/WILLIAM/A | 18`.
2. Implement the aggregation (§2a/§2b) in **both** `public/app.js:buildSubjectRankingsFromRecords` and `server.js:/api/subject-rankings` with the same output shape (§3).
3. Implement relation flagging (§2c) so `linkId` hides for ~75% of top-50 entities.
4. Hard-code `DEMO01` for ranks 1–4 and `DEMO02` for ranks 5–8 **after** the hash-derived linkId is computed. Do not remove this — the drilldown demo depends on these fixed IDs.
5. Render via `<tbody id="records-body">` with the exact column order from §2a; preserve `risk-cell--{level}` class names and `data-subject` on the `<tr>` for the modal wiring.
6. Wire controls listed in §3a and the pipeline in §3b.
7. Smoke test: with no filters applied, the table should show 50 rows, top row `HUDSON/WILLIAM/A` (18 transactions), and the Link ID column should render `DEMO01` for the first 4 rows and `DEMO02` for the next 4.
