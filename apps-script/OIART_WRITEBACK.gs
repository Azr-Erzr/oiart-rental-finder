/*
  OIART Rental Finder write-back endpoint  (v2 — future-proof, header-driven)

  WHY THIS VERSION EXISTS
  -----------------------
  A Google Apps Script web app runs a FROZEN snapshot of the code that was live
  when you last picked "Deploy". Editing the script afterward changes nothing the
  /exec URL runs until you publish a NEW VERSION. The old script also used a
  hard-coded ALLOWED_FIELDS list, so every time we added a writable column we had
  to edit code AND redeploy. This version removes that treadmill:

    * Any column that EXISTS in the Listings header is writable, EXCEPT the
      protected core/computed columns listed below. So new workflow/metadata
      columns work with NO code change and NO redeploy.
    * doGet() now reports a VERSION stamp + the live writable/protected columns,
      so you can verify exactly what is deployed instead of guessing.

  DEPLOY (do this once after pasting):
  1. Sheet > Extensions > Apps Script. Replace Code.gs with this file. Save.
  2. Deploy > Manage deployments > (pencil/Edit on the active deployment) >
     Version: "New version" > Deploy.   [Editing the existing deployment keeps
     the SAME /exec URL, so app.js needs no change.]
  3. Verify: open the /exec URL in a browser. You should see
     "version":"2026-06-01-v2" and ListingKind inside "writableColumns".

  SECURITY MODEL
  --------------
  The public site can only ever change workflow fields: the PROTECTED_FIELDS
  below (identity, listing facts, scoring, coordinates) are never writable
  through this endpoint, so a stray POST can't rewrite rent/score/URL/lat-long.
  For a hard gate, set WRITE_TOKEN here AND in app.js to the same secret.
  IMPORTANT: if you ever add a NEW sensitive/core column, add its exact header
  name to PROTECTED_FIELDS so it stays read-only to the endpoint.
*/

const SHEET_VERSION = "2026-06-01-v2";   // bump whenever you redeploy; doGet echoes it
const LISTINGS_SHEET_NAME = "Listings";
const FALLBACK_LISTINGS_SHEET_NAME = "listings";

// Optional shared secret. "" = accept any request (current behaviour). To require
// it, set the same string here and in app.js (WRITE_TOKEN), then redeploy.
const WRITE_TOKEN = "";

// Human-owned / computed columns the endpoint must NEVER overwrite.
// EVERYTHING ELSE in the header is writable — that's what makes this future-proof.
const PROTECTED_FIELDS = [
  "ID", "Volume", "Action", "Priority", "Listing / lead", "Source", "Neighbourhood",
  "Address / locator", "Type", "Rent text", "Approx monthly share", "Est drive min",
  "Km straight-line", "Parking", "Internet / utilities", "Availability", "Furnishing",
  "Criteria fit", "Why add / note", "What to verify", "Date seen", "Last checked",
  "URL", "Maps link", "Score", "ScoreOverride", "Latitude", "Longitude", "IsNew"
];

// Workflow/metadata columns we make sure exist (created if missing). Adding to
// this list only affects column creation — writability is governed by the
// protected list above, so new names here are writable immediately on redeploy,
// and brand-new columns added straight in the sheet are writable with no redeploy.
const ENSURE_COLUMNS = [
  "Archived", "Status", "Contacted", "LastContacted", "Response", "ViewingBooked",
  "ViewingDate", "Decision", "RemoveReason", "FriendNotes", "ParkingConfirmed",
  "InternetConfirmed", "AddressConfirmed", "JulyConfirmed", "ScamRisk",
  "UpdatedAt", "UpdatedBy", "CanonicalKey", "DuplicateOf", "ListingKind",
  "ImageURL", "ImageAlt", "ImageSource", "ImageChecked"
];

// Stored as real booleans. Matched by name so future *Confirmed / *Checked
// columns are handled automatically without editing this function.
function isBooleanField_(name) {
  return /^(Archived|Contacted|ViewingBooked|IsNew)$/.test(name) || /(Confirmed|Checked)$/.test(name);
}

function isWritable_(field) {
  return PROTECTED_FIELDS.indexOf(field) < 0;
}

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (WRITE_TOKEN && String(payload.token || "") !== WRITE_TOKEN) {
      return json_({ok: false, error: "Unauthorized"});
    }
    const id = String(payload.id || "").trim();
    const updates = payload.fields || (payload.field ? {[payload.field]: payload.value} : {});
    if (!id) return json_({ok: false, error: "Missing id"});

    const sh = getListingsSheet_();
    ensureColumns_(sh, ENSURE_COLUMNS);
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const idCol = header.indexOf("ID");
    if (idCol < 0) return json_({ok: false, error: "Missing ID column"});

    let rowIndex = -1;
    const lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      const idValues = sh.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
      for (let i = 0; i < idValues.length; i++) {
        if (String(idValues[i][0]).trim() === id) { rowIndex = i + 2; break; }
      }
    }
    if (rowIndex < 0) return json_({ok: false, error: "ID not found: " + id});

    const written = {}, skipped = {};
    Object.keys(updates).forEach(function(field) {
      const col = header.indexOf(field);
      if (col < 0)            { skipped[field] = "no such column"; return; }
      if (!isWritable_(field)){ skipped[field] = "protected";      return; }
      sh.getRange(rowIndex, col + 1).setValue(normalizeValue_(field, updates[field]));
      written[field] = updates[field];
    });

    if (!("UpdatedAt" in written)) {
      const c = header.indexOf("UpdatedAt");
      if (c >= 0) {
        const now = new Date();
        sh.getRange(rowIndex, c + 1).setValue(now);
        written.UpdatedAt = now.toISOString();
      }
    }

    return json_({ok: true, id: id, written: written, skipped: skipped});
  } catch (err) {
    return json_({ok: false, error: String(err && err.message || err)});
  }
}

// Diagnostics so we can confirm what is actually deployed (no more guessing).
function doGet() {
  const info = {
    ok: true,
    service: "OIART Rental Finder write-back",
    version: SHEET_VERSION,
    tokenRequired: !!WRITE_TOKEN
  };
  try {
    const sh = getListingsSheet_();
    const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String).filter(String);
    info.writableColumns = header.filter(isWritable_);
    info.protectedColumns = header.filter(function(h) { return !isWritable_(h); });
  } catch (e) {
    info.headerError = String(e && e.message || e);
  }
  return json_(info);
}

function setupOiartRentalSheet() {
  const sh = getListingsSheet_();
  ensureColumns_(sh, ENSURE_COLUMNS);
  formatListingsSheet_(sh);

  const sites = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sites") ||
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName("sites");
  if (sites) formatSitesSheet_(sites);

  return json_({ok: true, message: "OIART rental sheet columns and formatting are ready", version: SHEET_VERSION});
}

function getListingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(LISTINGS_SHEET_NAME) || ss.getSheetByName(FALLBACK_LISTINGS_SHEET_NAME);
  if (!sh) throw new Error("Could not find Listings/listings tab");
  return sh;
}

function ensureColumns_(sh, columns) {
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  columns.forEach(function(name) {
    if (header.indexOf(name) >= 0) return;
    sh.getRange(1, sh.getLastColumn() + 1).setValue(name);
    header.push(name);
  });
}

function normalizeValue_(field, value) {
  if (isBooleanField_(field)) return String(value).toUpperCase() === "TRUE";
  return value == null ? "" : value;
}

function formatListingsSheet_(sh) {
  const lastCol = sh.getLastColumn();
  const lastRow = Math.max(sh.getLastRow(), 2);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, lastCol)
    .setFontWeight("bold")
    .setBackground("#e2efe8")
    .setWrap(true);
  if (!sh.getFilter()) sh.getRange(1, 1, lastRow, lastCol).createFilter();

  const widths = {
    "ID": 70,
    "Volume": 140,
    "Action": 130,
    "Priority": 70,
    "Listing / lead": 260,
    "Source": 120,
    "Neighbourhood": 170,
    "ListingKind": 150,
    "Address / locator": 180,
    "Type": 190,
    "Rent text": 130,
    "Parking": 180,
    "Internet / utilities": 180,
    "Why add / note": 260,
    "What to verify": 280,
    "URL": 220,
    "Maps link": 220,
    "Status": 140,
    "Response": 140,
    "Decision": 130,
    "RemoveReason": 180,
    "FriendNotes": 260,
    "UpdatedAt": 170,
    "UpdatedBy": 130,
    "DuplicateOf": 110,
    "CanonicalKey": 220,
    "ImageURL": 220,
    "ImageAlt": 180,
    "ImageSource": 140,
    "ImageChecked": 130
  };
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  header.forEach(function(name, i) {
    if (widths[name]) sh.setColumnWidth(i + 1, widths[name]);
  });
  sh.getRange(1, 1, lastRow, lastCol).setVerticalAlignment("top");
  sh.getRange(2, 1, Math.max(lastRow - 1, 1), lastCol).setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  ["FriendNotes", "What to verify", "Why add / note"].forEach(function(name) {
    const idx = header.indexOf(name);
    if (idx >= 0) sh.getRange(2, idx + 1, Math.max(lastRow - 1, 1), 1).setWrap(true);
  });
}

function formatSitesSheet_(sh) {
  const lastCol = sh.getLastColumn();
  const lastRow = Math.max(sh.getLastRow(), 2);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, 1, lastCol)
    .setFontWeight("bold")
    .setBackground("#e0eaf4")
    .setWrap(true);
  if (!sh.getFilter()) sh.getRange(1, 1, lastRow, lastCol).createFilter();
  sh.autoResizeColumns(1, lastCol);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
