/*
  OIART Rental Finder write-back endpoint

  Deploy this from the Google Sheet:
  1. Open the Sheet > Extensions > Apps Script.
  2. Paste this file into Code.gs.
  3. Deploy > New deployment > Web app.
     Execute as: Me
     Who has access: Anyone
  4. Copy the /exec URL into app.js as WRITE_URL.

  The public site never receives Google credentials. It can only request updates
  to the allowlisted workflow fields below.
*/

const LISTINGS_SHEET_NAME = "Listings";
const FALLBACK_LISTINGS_SHEET_NAME = "listings";

const ALLOWED_FIELDS = [
  "Archived",
  "Status",
  "Contacted",
  "LastContacted",
  "Response",
  "ViewingBooked",
  "ViewingDate",
  "Decision",
  "RemoveReason",
  "FriendNotes",
  "ParkingConfirmed",
  "InternetConfirmed",
  "AddressConfirmed",
  "JulyConfirmed",
  "ScamRisk",
  "UpdatedAt",
  "UpdatedBy",
  "CanonicalKey",
  "DuplicateOf",
  "ListingKind",
  "ImageURL",
  "ImageAlt",
  "ImageSource",
  "ImageChecked"
];

function doPost(e) {
  try {
    const payload = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const id = String(payload.id || "").trim();
    const updates = payload.fields || (payload.field ? {[payload.field]: payload.value} : {});

    if (!id) return json_({ok: false, error: "Missing id"});

    const sh = getListingsSheet_();
    const values = sh.getDataRange().getValues();
    if (values.length < 2) return json_({ok: false, error: "No listing rows"});

    const header = values[0].map(String);
    ensureColumns_(sh, header, ALLOWED_FIELDS);
    const freshHeader = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const idCol = freshHeader.indexOf("ID");
    if (idCol < 0) return json_({ok: false, error: "Missing ID column"});

    let rowIndex = -1;
    const idValues = sh.getRange(2, idCol + 1, Math.max(sh.getLastRow() - 1, 0), 1).getValues();
    for (let i = 0; i < idValues.length; i++) {
      if (String(idValues[i][0]).trim() === id) {
        rowIndex = i + 2;
        break;
      }
    }
    if (rowIndex < 0) return json_({ok: false, error: "ID not found: " + id});

    const written = {};
    Object.keys(updates).forEach(function(field) {
      if (ALLOWED_FIELDS.indexOf(field) < 0) return;
      const col = freshHeader.indexOf(field);
      if (col < 0) return;
      sh.getRange(rowIndex, col + 1).setValue(normalizeValue_(field, updates[field]));
      written[field] = updates[field];
    });

    if (!("UpdatedAt" in written)) {
      const col = freshHeader.indexOf("UpdatedAt");
      if (col >= 0) {
        const now = new Date();
        sh.getRange(rowIndex, col + 1).setValue(now);
        written.UpdatedAt = now.toISOString();
      }
    }

    return json_({ok: true, id: id, written: written});
  } catch (err) {
    return json_({ok: false, error: String(err && err.message || err)});
  }
}

function doGet() {
  return json_({ok: true, service: "OIART Rental Finder write-back"});
}

function setupOiartRentalSheet() {
  const sh = getListingsSheet_();
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  ensureColumns_(sh, header, ALLOWED_FIELDS);
  formatListingsSheet_(sh);

  const sites = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sites") ||
    SpreadsheetApp.getActiveSpreadsheet().getSheetByName("sites");
  if (sites) formatSitesSheet_(sites);

  return json_({ok: true, message: "OIART rental sheet columns and formatting are ready"});
}

function getListingsSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(LISTINGS_SHEET_NAME) || ss.getSheetByName(FALLBACK_LISTINGS_SHEET_NAME);
  if (!sh) throw new Error("Could not find Listings/listings tab");
  return sh;
}

function ensureColumns_(sh, header, columns) {
  columns.forEach(function(name) {
    if (header.indexOf(name) >= 0) return;
    sh.getRange(1, sh.getLastColumn() + 1).setValue(name);
    header.push(name);
  });
}

function normalizeValue_(field, value) {
  if (["Archived", "Contacted", "ViewingBooked", "ParkingConfirmed", "InternetConfirmed", "AddressConfirmed", "JulyConfirmed", "ImageChecked"].indexOf(field) >= 0) {
    return String(value).toUpperCase() === "TRUE";
  }
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
