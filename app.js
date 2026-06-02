/* ============================================================================
   LIVE DATA — reads from a shared Google Sheet at runtime (no hard-coded rows).
   ----------------------------------------------------------------------------
   [NEEDS OWNER] Paste your Google Sheet ID between the quotes below.
   The Sheet ID is the long string in the Sheet URL between /d/ and /edit :
     https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit
   The Sheet must be shared:  Share > General access > Anyone with the link > Viewer.
   The Sheet needs two tabs named:  Listings   and   Sites
   (seed them by importing oiart_listings.csv and oiart_sites.csv).
   ========================================================================== */
const SHEET_ID = "1ddciH2oqLcQxEePD-AEoO4GCqI8XztRcC1YTMJxZm9s";
const SHEET_TAB_CANDIDATES = {
  listings: ["Listings", "listings"],
  sites: ["Sites", "sites"]
};

/* Optional true write-back (see the big comment block at the bottom of this file).
   Leave "" for the default read-only mirror. Paste an Apps Script /exec URL to
   let workflow edits write straight into the Sheet. */
const WRITE_URL = "https://script.google.com/macros/s/AKfycbxOqmjH0VJ_K-sgKEWkoSP_PVeWVhkhW2O8ITX6UdLg3sbHvXzBj-pKumpLsdzFjuK7/exec";
const UPDATED_BY = "OIART site";
/* Optional shared secret to stop drive-by writes to the open Apps Script endpoint.
   Leave "" to keep the current behaviour. To turn it on: pick any random string,
   paste the SAME value here and into WRITE_TOKEN in apps-script/OIART_WRITEBACK.gs,
   then redeploy the web app. When both match, writes without the token are rejected. */
const WRITE_TOKEN = "";
const CSV_FALLBACKS = {
  listings: "oiart_listings.csv",
  sites: "oiart_sites.csv"
};

const WORKFLOW_COLUMNS = [
  "Status","Contacted","LastContacted","Response","ViewingBooked","ViewingDate",
  "Decision","RemoveReason","FriendNotes","ParkingConfirmed","InternetConfirmed",
  "AddressConfirmed","JulyConfirmed","ScamRisk","UpdatedAt","UpdatedBy",
  "CanonicalKey","DuplicateOf"
];
const IMAGE_COLUMNS = [
  "ImageURL","ImageAlt","ImageSource","ImageChecked"
];
const WRITABLE_FIELDS = [
  "Archived","Status","Contacted","LastContacted","Response","ViewingBooked",
  "ViewingDate","Decision","RemoveReason","FriendNotes","ParkingConfirmed",
  "InternetConfirmed","AddressConfirmed","JulyConfirmed","ScamRisk",
  "UpdatedAt","UpdatedBy","ListingKind","DuplicateOf","CanonicalKey",
  "ImageURL","ImageAlt","ImageSource","ImageChecked"
];

/* Option B fallback (only if you ever hit a CORS edge case with gviz above):
   publish each tab as CSV (File > Share > Publish to web > tab > CSV), add
   the PapaParse CDN script tag to <head> (unpkg.com/papaparse@5/papaparse.min.js),
   paste the two pub?...output=csv URLs here, and call loadSheetCSV() instead.
   const LISTINGS_CSV_URL = "";
   const SITES_CSV_URL    = "";
*/

let rows = [];
let sites = [];
let neighbourhoods = [];
let sources = [];

function uniqSorted(arr){
  return [...new Set(arr.map(v => String(v ?? "").trim()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
}

function asText(v){ return String(v ?? "").trim(); }
function truthy(v){ return /^(true|yes|y|1|confirmed|booked|done)$/i.test(asText(v)); }
function compact(parts){ return parts.map(asText).filter(Boolean).join(" "); }
function textOr(v, fallback="Not entered"){ return asText(v) || fallback; }
function parseNum(v){ const s = asText(v).replace(/[$,]/g, ""); return s ? Number(s) : NaN; }
function safeUrl(v){
  const s = asText(v);
  if(!s) return "";
  try{
    const u = new URL(s);
    return /^https?:$/.test(u.protocol) ? u.href : "";
  }catch(e){ return ""; }
}
function linkButton(url, label, cls="", missing="No link entered"){
  const href = safeUrl(url);
  return href
    ? `<a class="linkbtn ${cls}" href="${safe(href)}" target="_blank" rel="noopener">${safe(label)}</a>`
    : `<span class="linkbtn disabled" title="${safe(missing)}">${safe(missing)}</span>`;
}
function listingImageUrl(r){ return safeUrl(r.ImageURL || r["Image URL"] || r.Image); }
function imageAlt(r){ return textOr(r.ImageAlt, textOr(r["Listing / lead"], "Rental listing image")); }
function imageThumb(r){
  const url = listingImageUrl(r);
  if(!url) return "";
  return `<div class="thumbwrap"><img src="${safe(url)}" alt="${safe(imageAlt(r))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentElement.remove()"></div>`;
}
function popupImage(r){
  const url = listingImageUrl(r);
  if(!url) return "";
  return `<img class="popupthumb" src="${safe(url)}" alt="${safe(imageAlt(r))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
}
function tableThumb(r){
  const url = listingImageUrl(r);
  if(!url) return "";
  return `<img class="tablethumb" src="${safe(url)}" alt="${safe(imageAlt(r))}" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">`;
}
function detailCell(label, value){
  const v = asText(value);
  if(!v) return "";
  return `<div class="ditem"><span class="dlabel">${safe(label)}</span><span class="dval">${safe(v)}</span></div>`;
}
// Clean 1..N display rank from the decimal Priority order (decimals are an
// insert-between convention kept for sorting; the UI shows tidy integers).
// Ranked separately for active vs archived so each view reads 1,2,3,…
function computeRanks(){
  const groups = { active: [], archived: [] };
  rows.forEach(r => (isArchived(r) ? groups.archived : groups.active).push(r));
  Object.values(groups).forEach(list => {
    list.sort((a, b) => num(a.PriorityNum, 1e9) - num(b.PriorityNum, 1e9));
    list.forEach((r, i) => { r.RankDisplay = i + 1; });
  });
}
function rankLabel(r){ return Number.isFinite(r.RankDisplay) ? r.RankDisplay : textOr(r.Priority, r.DisplayID); }
function rankTitle(r){ const p = asText(r.Priority); return p ? `Priority ${p}` : "No priority set"; }
// One compact main row + a hidden detail row (toggled by the ▸ button) so the
// table stays scannable and the heavy fields only appear on demand.
function tableRow(r){
  const id = safe(r.ID);
  const sel = String(selectedListingId) === String(r.ID) ? "selectedrow" : "";
  const lvl = scoreLevelClass(r);
  const driveTxt = asText(r["Est drive min"]) ? `${safe(r["Est drive min"])} min` : "—";
  const kmTxt = asText(r["Km straight-line"]) ? `${safe(r["Km straight-line"])} km` : "";
  const dup = asText(r.DuplicateOf) ? `<span class="pill warnpill" title="Duplicate of ${safe(r.DuplicateOf)}">dup ${safe(r.DuplicateOf)}</span>` : "";
  const scoreFlag = lvl ? `<span class="scoreflag ${lvl}" title="A must-have criterion is unconfirmed — expand for details">⚠</span>` : "";

  const detail = [
    detailCell("Parking", textOr(r.Parking, "not stated")),
    detailCell("Internet / utilities", textOr(r["Internet / utilities"], "not stated")),
    detailCell("Availability", textOr(r.Availability, "not stated")),
    detailCell("Contact", r.ContactedBool ? compact(["Contacted", r.LastContacted]) : compact(["Not contacted", r.Response])),
    detailCell("Decision", compact([r.Decision, r.ViewingDate ? ("viewing " + r.ViewingDate) : ""])),
    r.ScamRisk ? detailCell("Scam risk", r.ScamRisk) : "",
    r.FriendNotes ? detailCell("Notes", r.FriendNotes) : "",
    detailCell("Dates", compact([r["Date seen"] ? ("seen " + r["Date seen"]) : "", r["Last checked"] ? ("checked " + r["Last checked"]) : ""])),
    detailCell("Score breakdown", scoreBreakdown(r)),
    r["Why add / note"] ? detailCell("Why", r["Why add / note"]) : "",
    r["What to verify"] ? detailCell("Verify", r["What to verify"]) : ""
  ].join("");
  const flags = scoreFlags(r);
  const confirmRow = flags ? `<div class="ditem ditem-full"><span class="dlabel">Still to confirm</span><span>${flags}</span></div>` : "";

  return `<tr data-row-id="${id}" class="mainrow ${r.IsNew?'rownew ':''}${sel}">
    <td class="colexpand"><button class="expandbtn" data-expand="${id}" aria-label="Show full details" title="Show full details">▸</button></td>
    <td><b class="rank" title="${safe(rankTitle(r))}">${safe(rankLabel(r))}</b>${r.NeedsId?'<br><span class="meta">Needs ID</span>':''}</td>
    <td><div class="listingcell">${tableThumb(r)}<div class="listinginfo"><b class="listingtitle">${safe(textOr(r["Listing / lead"], "Untitled listing"))}</b><div class="meta">${safe(textOr(r.Neighbourhood))}${asText(r.Type)?` · ${safe(r.Type)}`:""}</div><div class="kindline"><span class="pill kindpill ${kindClass(r)}">${safe(r.ListingKind)}</span>${r.IsNew?'<span class="pill newpill">★ new</span>':''}${dup}</div></div></div></td>
    <td><span class="pill ${pillClass(r)}">${volLabel(r)}</span></td>
    <td><b>${safe(textOr(r["Rent text"], "—"))}</b>${asText(r["Approx monthly share"])?`<br><span class="meta">share ${safe(r["Approx monthly share"])}</span>`:""}</td>
    <td>${driveTxt}${kmTxt?`<br><span class="meta">${kmTxt}</span>`:""}</td>
    <td><b class="scoreval ${lvl}">${safe(r.ScoreNum)}</b>${scoreFlag}</td>
    <td><span class="statustext">${safe(textOr(r.Status || r.Action, "—"))}</span></td>
    <td><div class="links tablelinks">${linkButton(r.URL, "Listing")} ${linkButton(routeLink(r), "Route", "route", "No route")}<button class="linkbtn copy" data-copy="${id}" type="button">Copy</button></div></td>
  </tr>
  <tr class="detailrow" data-detail-id="${id}" hidden><td class="colexpand"></td><td colspan="8"><div class="detailgrid">${detail}${confirmRow}</div></td></tr>`;
}
function routeLink(r){
  const explicit = safeUrl(r["Maps link"]);
  if(explicit) return explicit;
  if(!asText(r["Address / locator"]) && !asText(r.Neighbourhood)) return "";
  const dest = compact([r["Address / locator"], r.Neighbourhood, "London ON"]);
  return `https://www.google.com/maps/dir/?api=1&origin=502+Newbold+St+London+ON&destination=${encodeURIComponent(dest)}`;
}
function csvEscape(v){
  const s = String(v ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function sheetUrl(tabName){
  return `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&headers=1&sheet=${encodeURIComponent(tabName)}`;
}

function parseCsv(text){
  const rows = [];
  let row = [], field = "", inQuotes = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i], next = text[i + 1];
    if(inQuotes){
      if(ch === '"' && next === '"'){ field += '"'; i++; }
      else if(ch === '"') inQuotes = false;
      else field += ch;
    }else if(ch === '"') inQuotes = true;
    else if(ch === ","){ row.push(field); field = ""; }
    else if(ch === "\n"){
      row.push(field); rows.push(row); row = []; field = "";
    }else if(ch !== "\r") field += ch;
  }
  if(field || row.length){ row.push(field); rows.push(row); }
  const header = (rows.shift() || []).map(asText);
  return rows
    .filter(r => r.some(cell => asText(cell)))
    .map((r, index) => ({...Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])), _RowNumber: index + 2}));
}

// gviz wraps the JSON in google.visualization.Query.setResponse(...). Strip it,
// then key every cell by its column header label. Use the formatted value for
// date columns (so they read like the sheet) and the raw value for everything
// else (so numeric precision such as lat/long is preserved).
function parseGviz(text){
  const json = text.slice(text.indexOf("(") + 1, text.lastIndexOf(")"));
  const data = JSON.parse(json);
  const cols = data.table.cols.map(c => ({ label: String(c.label || c.id || "").trim(), type: c.type }));
  return data.table.rows.map((tr, index) => {
    const o = {};
    (tr.c || []).forEach((cell, i) => {
      const col = cols[i];
      if(!col || !col.label) return;
      let val = "";
      if(cell){
        const isDate = col.type === "date" || col.type === "datetime" || col.type === "timeofday";
        if(isDate && cell.f != null)      val = cell.f;
        else if(cell.v != null)           val = cell.v;
        else if(cell.f != null)           val = cell.f;
      }
      o[col.label] = val;
    });
    o._RowNumber = index + 2;
    return o;
  });
}

async function loadCsv(path, kind){
  const res = await fetch(path, { cache: "no-store" });
  if(!res.ok) throw new Error("CSV HTTP " + res.status);
  const list = parseCsv(await res.text());
  return kind === "sites" ? list.map(deriveSite) : list.map(deriveListing);
}

/* ---- computed scoring (mirrors the memory-file rubric, §6) ----------------
   Total 100 = location/commute 30 + cost 20 + parking&internet 15 +
   privacy 15 + lease timing 10 + trust 10. Scores are derived in-app from the
   sheet fields so they stay live: edit rent/drive/parking and the score moves.
   A manual "ScoreOverride" column (if present and numeric) wins, so anything you
   hand-tune is preserved. The sheet's original "Score" is kept for comparison. */
const CORE_AREAS = /pond mills|glen cairn|deveron|frontenac|commissioners|white oaks|jalna|ernest|exeter|bradley|ashley|millbank|westminster|southdale|adelaide|wellington|highland|wilkins|base ?line|gordon|southcrest/i;
const STRETCH_AREAS = /old south|wortley|grand ave|ridout|brighton|winston|westmount|wonderland|garden vista|byron|lambeth|longwoods|springbank/i;
const AVOID_AREAS = /fanshawe|carling|masonville|huron heights|north london|downtown/i;

function areaTier(r){
  const hay = compact([r.Neighbourhood, r["Address / locator"]]).toLowerCase();
  if(AVOID_AREAS.test(hay)) return "avoid";
  if(CORE_AREAS.test(hay))  return "core";
  if(STRETCH_AREAS.test(hay)) return "stretch";
  return "unknown";
}

/* Graduated, honest scoring. Each component returns either points it earned
   (rewarding what the listing actually states) OR na:true when the listing is
   silent on it. N/A components are EXCLUDED from the maths (so a missing field
   doesn't fake-penalise) and instead surfaced as an orange "confirm" flag.
   Stated negatives (no parking, September start, shared bedroom) score low and
   show a red flag. Total = earned / (sum of known maxes) * 100, so it's always
   "of what we actually know, here's the fit." */
const SCORE_SHORT = {
  location:"commute", cost:"rent", parking:"parking", internet:"internet",
  privacy:"room type", lease:"lease timing", trust:"listing"
};
/* "Must-have" criteria: if any of these are N/A (never stated), the score is
   capped one §7 band per missing item and the score pill turns amber/red — a
   lead can't look like a 90 when a must-have is invisible. Edit this set to add
   a 4th (e.g. "privacy" or "lease") or relax it. Caps map to the score bands:
   0 missing = no cap, 1 = 79 (strong→add-if-gap), 2 = 69 (backup), 3+ = 59 (cut). */
const CRITICAL_KEYS = ["location", "cost", "parking"];
const CRITICAL_CAP = {0:100, 1:79, 2:69};

function computeScore(r){
  const comps = [];
  const push = (key, label, max, res) => {
    if(res.na) comps.push({key, label, max, earned:0, na:true, level:"na", note:res.note || (label + " not stated")});
    else comps.push({key, label, max, earned:Math.max(0, Math.min(max, res.pts)), na:false, level:res.level || "ok", note:res.note || ""});
  };

  // Location + commute /30
  push("location", "Location / commute", 30, (function(){
    const tier = areaTier(r), d = r.DriveNum;
    if(!Number.isFinite(d) && tier === "unknown") return {na:true, note:"Commute / area not stated"};
    let pts, note = "";
    if(Number.isFinite(d)){
      if(d <= 10) pts = 30; else if(d <= 15) pts = 26; else if(d <= 20) pts = 18; else if(d <= 25) pts = 12; else pts = 8;
    } else {
      pts = tier === "core" ? 24 : tier === "stretch" ? 18 : 10; note = "drive estimated from area";
    }
    if(tier === "avoid") pts = Math.min(pts, 14);
    else if(tier === "stretch" && pts > 26) pts = 26;
    return {pts, level: pts <= 12 ? "warn" : "ok", note};
  })());

  // Cost + all-in value /20
  push("cost", "Cost / all-in value", 20, (function(){
    const rent = r.RentNum;
    if(!Number.isFinite(rent)) return {na:true, note:"Rent / monthly share not stated"};
    const allIn = r.HasInternet || /all|incl/i.test(asText(r["Internet / utilities"]));
    let pts;
    if(rent <= 900) pts = allIn ? 20 : 18;
    else if(rent <= 1000) pts = allIn ? 19 : 16;
    else if(rent <= 1150) pts = 14;
    else if(rent <= 1300) pts = 11;
    else if(rent <= 1500) pts = 8;
    else if(rent <= 1800) pts = 5;
    else pts = 3;
    return {pts, level: rent > 1500 ? "warn" : "ok"};
  })());

  // Parking /10 (rubric's parking+internet 15, split 10/5 so each can be N/A)
  push("parking", "Parking", 10, (function(){
    const t = asText(r.Parking).toLowerCase();
    if(truthy(r.ParkingConfirmed) || r.HasParking) return {pts:10, note:"parking available"};
    if(/no parking|street only|no spot|no on-?site|unavailable|not included/.test(t)) return {pts:0, level:"bad", note:"No parking"};
    if(/extra|paid|\$|fee/.test(t)) return {pts:7, level:"warn", note:"paid parking"};
    return {na:true, note:"Parking not confirmed"};
  })());

  // Internet / utilities /5
  push("internet", "Internet / utilities", 5, (function(){
    const t = asText(r["Internet / utilities"]).toLowerCase();
    if(truthy(r.InternetConfirmed) || r.HasInternet || /all|incl/.test(t)) return {pts:5, note:"included"};
    if(/partial|some|hydro/.test(t)) return {pts:3, level:"warn", note:"partial"};
    if(/no internet|not included|extra/.test(t)) return {pts:2, level:"warn", note:"internet extra"};
    return {na:true, note:"Internet / utilities not confirmed"};
  })());

  // Privacy + housing type /15
  push("privacy", "Privacy / housing type", 15, (function(){
    const t = compact([r.Type, r["Criteria fit"]]).toLowerCase();
    if(!t) return {na:true, note:"Housing type not stated"};
    if(/basement|studio|bachelor|1-?bed|one bed|apartment|ensuite|en-suite|own bath|private bath|separate entrance/.test(t)) return {pts:15, note:"private unit / own bath"};
    if(/shared bedroom|shared room/.test(t)) return {pts:5, level:"bad", note:"Shared bedroom"};
    if(/private (room|bed)/.test(t)) return {pts:12, note:"private room"};
    if(/room/.test(t)) return {pts:11, note:"room in shared house"};
    return {pts:8, note:"type unclear"};
  })());

  // Lease timing + student fit /10 — graduated on what's actually stated; N/A if silent
  push("lease", "Lease timing / fit", 10, (function(){
    if(truthy(r.JulyConfirmed)) return {pts:10, note:"July confirmed"};
    const t = compact([r.Availability, r["What to verify"]]).toLowerCase();
    if(/12[\s-]*month|year lease|12\s*mo|july[^.]{0,20}july/.test(t)) return {pts:10, note:"12-month / July-to-July"};
    if(/late july|july/.test(t)) return {pts:9, note:"July start stated"};
    if(/flexible|negotiable|any time|anytime/.test(t)) return {pts:7, note:"flexible start"};
    if(/now|immediate|available now|asap|current|move-?in/.test(t)) return {pts:7, note:"available now"};
    if(/aug/.test(t)) return {pts:6, note:"August start"};
    if(/sept/.test(t)) return {pts:4, level:"bad", note:"September start"};
    return {na:true, note:"Lease timing not stated — confirm"};
  })());

  // Trust / clarity / quality /10 — always assessable
  push("trust", "Trust / clarity", 10, (function(){
    let pts = 10; const notes = [];
    const kind = String(r.ListingKind || "").toLowerCase();
    const risk = asText(r.ScamRisk).toLowerCase();
    if(/high/.test(risk)){ pts -= 6; notes.push("high scam risk"); }
    else if(/med/.test(risk)){ pts -= 3; notes.push("medium scam risk"); }
    if(/search|needs/.test(kind)){ pts -= 3; notes.push("no direct listing URL"); }
    const addr = asText(r["Address / locator"]).toLowerCase();
    if(!addr || /area only|approx|unknown/.test(addr)){ pts -= 2; notes.push("no exact address"); }
    if(!listingImageUrl(r)) pts -= 1;
    if(pts < 0) pts = 0;
    return {pts, level: pts <= 4 ? "bad" : "ok", note:notes.join(", ")};
  })());

  const known = comps.filter(c => !c.na);
  const knownMax = known.reduce((a, c) => a + c.max, 0);
  const earned = known.reduce((a, c) => a + c.earned, 0);
  const raw = knownMax ? Math.max(0, Math.min(100, Math.round(earned / knownMax * 100))) : 0;
  // Cap one band per missing must-have so an unknown big-3 field can't inflate.
  const criticalUnknown = comps.filter(c => c.na && CRITICAL_KEYS.includes(c.key)).map(c => c.key);
  const cap = criticalUnknown.length >= 3 ? 59 : CRITICAL_CAP[criticalUnknown.length];
  const total = Math.min(raw, cap);
  return {
    total, raw, cap, criticalUnknown,
    components: comps,
    unconfirmed: comps.filter(c => c.na).map(c => c.key),
    negatives: comps.filter(c => c.level === "bad").map(c => c.key),
    knownMax,
    tier: areaTier(r)
  };
}

// '' (essentials known), 'scorewarn' (1 must-have missing), 'scorecrit' (2+).
function scoreLevelClass(r){
  const n = (r.ScoreCritUnknown || []).length;
  return n >= 2 ? "scorecrit" : n === 1 ? "scorewarn" : "";
}

function scoreBreakdown(r){
  const comps = r.ScoreComponents || [];
  const body = comps.map(c => c.na ? `${c.label} N/A` : `${c.label} ${c.earned}/${c.max}`).join(" · ");
  let s = `Auto-score ${r.ScoreNum}/100 — ${body}`;
  if(Number.isFinite(r.ScoreKnownMax) && r.ScoreKnownMax < 100) s += ` · scored on ${r.ScoreKnownMax}/100 known pts`;
  if(r.ScoreComputed && (r.ScoreCritUnknown || []).length){
    const names = r.ScoreCritUnknown.map(k => SCORE_SHORT[k] || k).join(", ");
    s += ` · ⚠ capped at ${r.ScoreCap} — must-have unconfirmed: ${names}`;
  }
  if(r.ScoreComputed && Number.isFinite(r.ScoreSheet)) s += ` · (sheet had ${r.ScoreSheet})`;
  if(!r.ScoreComputed) s += ` · manual ScoreOverride in use`;
  return s;
}

// Orange "confirm" chips for N/A components, red chips for stated negatives.
function scoreFlags(r){
  const comps = r.ScoreComponents || [];
  const chips = [];
  comps.forEach(c => {
    if(c.na) chips.push(`<span class="flagchip na" title="Not stated in the listing yet — contact to confirm">Confirm ${safe(SCORE_SHORT[c.key] || c.label)}</span>`);
    else if(c.level === "bad") chips.push(`<span class="flagchip bad" title="${safe(c.note || c.label)}">${safe(c.note || c.label)}</span>`);
  });
  return chips.length ? `<div class="confirmflags">${chips.join("")}</div>` : "";
}

/* ---- styled score-breakdown popup on hover (replaces the weak native title) ---- */
function scoreTipHTML(r){
  const comps = r.ScoreComponents || [];
  const rowsHtml = comps.map(c => {
    const pct = c.na ? 0 : Math.round(c.earned / c.max * 100);
    const val = c.na ? `<span class="stna">N/A</span>` : `${c.earned}<span class="stmax">/${c.max}</span>`;
    const barCls = c.na ? "na" : c.level === "bad" ? "bad" : c.level === "warn" ? "warn" : "ok";
    return `<div class="strow"><span class="stlabel">${safe(c.label)}</span><span class="stbar"><i class="${barCls}" style="width:${pct}%"></i></span><span class="stval">${val}</span></div>`;
  }).join("");
  const notes = [];
  if(Number.isFinite(r.ScoreKnownMax) && r.ScoreKnownMax < 100) notes.push(`scored on ${r.ScoreKnownMax}/100 known points`);
  if(r.ScoreComputed && (r.ScoreCritUnknown || []).length) notes.push(`⚠ capped at ${r.ScoreCap} — must-have unconfirmed: ${r.ScoreCritUnknown.map(k => SCORE_SHORT[k] || k).join(", ")}`);
  if(r.ScoreComputed && Number.isFinite(r.ScoreSheet)) notes.push(`sheet had ${r.ScoreSheet}`);
  if(!r.ScoreComputed) notes.push(`manual ScoreOverride in use`);
  const lvl = scoreLevelClass(r);
  return `<div class="sthead"><b class="${lvl}">${safe(r.ScoreNum)}</b><span>/100 · auto-score</span></div>
    <div class="stbody">${rowsHtml}</div>
    ${notes.length ? `<div class="stfoot">${safe(notes.join(" · "))}</div>` : ""}`;
}

let scoreTipEl = null;
function scoreTip(){ if(!scoreTipEl){ scoreTipEl = document.createElement("div"); scoreTipEl.className = "scoretip"; scoreTipEl.style.display = "none"; document.body.appendChild(scoreTipEl); } return scoreTipEl; }
function rowForScoreEl(elm){
  const host = elm.closest("[data-row-id]") || elm.closest("[data-id]") || elm.closest("[data-detail-id]");
  if(!host) return null;
  const id = host.dataset.rowId || host.dataset.id || host.dataset.detailId;
  return rows.find(x => String(x.ID) === String(id));
}
function placeScoreTip(target){
  const tip = scoreTipEl, pad = 10, gap = 8;
  const rect = target.getBoundingClientRect();
  let left = rect.left, top = rect.bottom + gap;
  if(left + tip.offsetWidth > window.innerWidth - pad) left = window.innerWidth - tip.offsetWidth - pad;
  if(top + tip.offsetHeight > window.innerHeight - pad) top = rect.top - tip.offsetHeight - gap;
  tip.style.left = Math.max(pad, left) + "px";
  tip.style.top = Math.max(pad, top) + "px";
}
document.addEventListener("mouseover", e => {
  const t = e.target.closest(".scoreval, .scorepill");
  if(!t) return;
  const r = rowForScoreEl(t);
  if(!r || !Array.isArray(r.ScoreComponents)) return;
  const tip = scoreTip();
  tip.innerHTML = scoreTipHTML(r);
  tip.style.display = "block";
  placeScoreTip(t);
});
document.addEventListener("mouseout", e => {
  if(scoreTipEl && e.target.closest(".scoreval, .scorepill")) scoreTipEl.style.display = "none";
});

// Recompute the helper fields the UI relies on (the CSV/Sheet does NOT contain them).
function deriveListing(o){
  const originalId = asText(o.ID);
  o.NeedsId = !originalId;
  o.ID = originalId || `sheet-row-${o._RowNumber || Math.random().toString(36).slice(2)}`;
  o.DisplayID = originalId || `row ${o._RowNumber || "without ID"}`;
  const rent  = parseNum(o["Approx monthly share"]);
  const drive = parseNum(o["Est drive min"]);
  const park  = String(o["Parking"] || "");
  const net   = String(o["Internet / utilities"] || "");
  [...WORKFLOW_COLUMNS, ...IMAGE_COLUMNS].forEach(k => { if(o[k] == null) o[k] = ""; });
  o.PriorityNum = parseNum(o["Priority"]);
  o.DriveNum    = parseNum(o["Est drive min"]);
  o.RentNum     = parseNum(o["Approx monthly share"]);
  o.LatNum      = parseNum(o["Latitude"]);
  o.LonNum      = parseNum(o["Longitude"]);
  o.UnderTarget = Number.isFinite(rent)  && rent  <= 1000;
  o.EasyCommute = Number.isFinite(drive) && drive <= 15;
  o.HasParking  = /yes|incl|avail|spot|driveway|assigned|surface|garage|outdoor/i.test(park) && !/no parking/i.test(park);
  o.HasInternet = /yes|incl|all|wifi|gigabit|1gb/i.test(net);
  o.ListingKind = listingKind(o);
  o.IsNew       = String(o["IsNew"]).trim().toUpperCase() === "TRUE";
  o.Archived    = String(o["Archived"]).trim().toUpperCase() === "TRUE";
  const status   = compact([o.Status, o.Action]);
  const response = asText(o.Response);
  const decision = compact([o.Decision, status]);
  // Tightened: key each "needs verify" flag off the specific topic in the
  // "What to verify"/address/availability text, not a blanket verify/confirm
  // match — otherwise nearly every row lit up permanently.
  const toVerify = asText(o["What to verify"]).toLowerCase();
  const addrText = asText(o["Address / locator"]).toLowerCase();
  const availText = asText(o.Availability).toLowerCase();
  o.ContactedBool = truthy(o.Contacted) || /contacted|messaged|emailed|called|sent/i.test(status);
  o.WaitingReply = /waiting|pending|sent|messaged|emailed|follow/i.test(compact([status, response])) && !/booked|declined|rejected|dead|remove/i.test(compact([status, response]));
  o.ViewingBookedBool = truthy(o.ViewingBooked) || !!asText(o.ViewingDate) || /viewing|tour|showing|booked/i.test(status);
  o.GoodOption = /good|strong|shortlist|keeper|yes|priority|message first|book viewing/i.test(decision) && !/no|bad|dead|remove|scam/i.test(decision);
  o.NeedsParking  = !truthy(o.ParkingConfirmed)  && (!o.HasParking  || /park/.test(toVerify));
  o.NeedsInternet = !truthy(o.InternetConfirmed) && (!o.HasInternet || /internet|wifi|util|hydro/.test(toVerify));
  o.NeedsAddress  = !truthy(o.AddressConfirmed)  && (!addrText || /area only|approx|unknown|postal|n6[a-z]?\s*\d/.test(addrText) || /address|intersection|exact location/.test(toVerify));
  o.NeedsJuly     = !truthy(o.JulyConfirmed)     && !/july/.test(availText) && (availText === "" || /sept|unknown|verify|current|now|tbd|ask/.test(availText) || /july|lease start|move-?in|term/.test(toVerify));
  // Live computed score (manual ScoreOverride wins; sheet Score kept for compare)
  const auto = computeScore(o);
  const override = parseNum(o.ScoreOverride);
  o.ScoreSheet       = parseNum(o.Score);
  o.ScoreAuto        = auto.total;
  o.ScoreRaw         = auto.raw;
  o.ScoreCap         = auto.cap;
  o.ScoreCritUnknown = auto.criticalUnknown;
  o.ScoreComponents  = auto.components;
  o.ScoreUnconfirmed = auto.unconfirmed;
  o.ScoreNegatives   = auto.negatives;
  o.ScoreKnownMax    = auto.knownMax;
  o.ScoreComputed    = !Number.isFinite(override);
  o.ScoreNum         = Number.isFinite(override) ? override : auto.total;
  return o;
}

// The sites tab uses verbose headers; alias them onto the keys the panel expects.
function deriveSite(o){
  o.Filters = (o["Recommended filters / search terms"] ?? o.Filters ?? "");
  o.Avoid   = (o["Avoid / delete"] ?? o.Avoid ?? "");
  o.IsNew   = String(o["IsNew"]).trim().toUpperCase() === "TRUE";
  return o;
}

async function loadSheet(url, kind){
  const res = await fetch(url, { cache: "no-store" });
  if(!res.ok) throw new Error("HTTP " + res.status);
  const list = parseGviz(await res.text());
  return kind === "sites" ? list.map(deriveSite) : list.map(deriveListing);
}

async function loadSheetWithTabs(kind){
  const tabs = SHEET_TAB_CANDIDATES[kind] || [kind];
  let lastErr;
  for(const tab of tabs){
    try{
      return await loadSheet(sheetUrl(tab), kind);
    }catch(e){
      lastErr = e;
    }
  }
  throw lastErr || new Error(`No ${kind} tab found`);
}

// A row counts as archived if the Sheet says so OR it was archived this session.
function isArchived(r){ return r.Archived === true || archived.has(r.ID); }

const OIART = {lat:42.936, lon:-81.205};

const el = id => document.getElementById(id);
function safe(s){return String(s ?? "").replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function num(v,f=0){const n=Number(v);return Number.isFinite(n)?n:f;}
function volClass(r){return String(r.Volume).includes("Vol 1")?"vol1":String(r.Volume).includes("Vol 2")?"vol2":"unknownvol";}
function pillClass(r){return String(r.Volume).includes("Vol 1")?"core":String(r.Volume).includes("Vol 2")?"stretch":"unknownpill";}
function volLabel(r){return String(r.Volume).includes("Vol 1")?"Vol 1 core":String(r.Volume).includes("Vol 2")?"Vol 2 stretch":"Volume not set";}
function listingKind(r){
  const manual = asText(r.ListingKind || r["Listing kind"] || r["Listing type"]);
  if(manual) return manual;
  const url = safeUrl(r.URL);
  const hay = compact([r.Status, r.Action, r.Decision, r.RemoveReason, r["What to verify"], r.Source, r.URL]).toLowerCase();
  if(/needs direct|verify url|direct listing url|needs url/.test(hay) || !url) return "Needs direct URL";
  let u;
  try{ u = new URL(url); }catch(e){ return "Needs direct URL"; }
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if(host.includes("kijiji.ca")) return path.includes("/v-") ? "Direct listing" : "Search/source lead";
  if(host.includes("roomies.ca")) return /\/rooms\/\d+/.test(path) ? "Direct listing" : "Search/source lead";
  if(host.includes("zumper.com")){
    if(path.includes("/apartment-buildings/")) return "Building page";
    if(path.includes("/address/")) return "Direct listing";
    return "Search/source lead"; // /apartments-for-rent/<city>/<area>/... are filtered searches, not units
  }
  if(host.includes("apartments.com")) return path.split("/").filter(Boolean).length >= 2 ? "Building page" : "Search/source lead";
  if(host.includes("padmapper.com")) return path.split("/").filter(Boolean).length >= 3 ? "Building page" : "Search/source lead";
  if(host.includes("realtor.ca") || host.includes("rentals.ca")) return path.includes("map") || u.search ? "Search/source lead" : "Direct listing";
  if(host.includes("oiart.org")) return "Official housing page";
  return /search|results|for-rent|room-rental|apartments/i.test(url) ? "Search/source lead" : "Direct listing";
}
function kindClass(r){
  const k = String(r.ListingKind || listingKind(r)).toLowerCase();
  if(k.includes("direct")) return "kind-direct";
  if(k.includes("building") || k.includes("official")) return "kind-building";
  if(k.includes("needs")) return "kind-needs";
  return "kind-source";
}
function searchText(r){return [r["Listing / lead"],r.Neighbourhood,r["Address / locator"],r.Type,r["Why add / note"],r["What to verify"],r.Source,r["Criteria fit"],r.Status,r.Response,r.Decision,r.FriendNotes,r.RemoveReason,r.ListingKind].join(" ").toLowerCase();}

const state={
  under1000:false,parking:false,internet:false,newonly:false,
  notContacted:false,waitingReply:false,viewingBooked:false,goodOption:false,
  needsParking:false,needsInternet:false,needsAddress:false,needsJuly:false,
  sortKey:"PriorityNum",sortDir:1,view:"active",showUnmapped:false
};
let archived = new Set();
try{ const saved=localStorage.getItem("oiart_archived"); if(saved) archived=new Set(JSON.parse(saved)); }catch(e){}
function persist(){ try{ localStorage.setItem("oiart_archived", JSON.stringify([...archived])); }catch(e){} }

// KPIs
function renderKPIs(){
  const v1=rows.filter(r=>String(r.Volume).includes("Vol 1")).length;
  const v2=rows.filter(r=>String(r.Volume).includes("Vol 2")).length;
  const nw=rows.filter(r=>r.IsNew).length;
  const under=rows.filter(r=>r.UnderTarget).length;
  const easy=rows.filter(r=>r.EasyCommute).length;
  const kpis=[["green",rows.length,"Total leads"],["green",v1,"Vol 1 core fits"],["blue",v2,"Vol 2 stretch"],
    ["gold",nw,"New this round"],["green",under,"≤ $1,000 all-in"],["green",easy,"≤ 15-min drive"]];
  el("kpis").innerHTML=kpis.map(k=>`<div class="kpi ${k[0]}"><div class="num">${k[1]}</div><div class="label">${k[2]}</div></div>`).join("");
}

// Keep the appbar tag + footer counts in sync with the live data (no hard-coded 61).
function updateCounts(){
  const total=rows.length;
  const active=rows.filter(r=>!isArchived(r)).length;
  const tag=el("leadCountTag");
  if(tag) tag.textContent=`London, ON · ${active} active lead${active===1?"":"s"} · scored & mapped`;
  const fc=el("footerCount");
  if(fc) fc.textContent=String(total);
}

// Reset to just the "All" option, then repopulate from the live data.
function populateSelect(id,vals){const s=el(id);s.length=1;vals.forEach(v=>{const o=document.createElement("option");o.value=v;o.textContent=v;s.appendChild(o);});}
function populateFilters(){
  neighbourhoods=uniqSorted(rows.map(r=>r.Neighbourhood));
  sources=uniqSorted(rows.map(r=>r.Source));
  populateSelect("neighbourhood",neighbourhoods);
  populateSelect("source",sources);
}

const hasMap = (typeof L !== "undefined");
let map=null;
if(hasMap){
  map=L.map("map",{scrollWheelZoom:true}).setView([42.945,-81.23],12);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",{subdomains:"abcd",maxZoom:20,attribution:'&copy; OpenStreetMap &copy; CARTO'}).addTo(map);
} else {
  const md=document.getElementById("map");
  if(md) md.innerHTML='<div style="padding:24px;font-family:Inter;color:#766b5e">Map library couldn\'t load (offline or blocked). The ranked list, table and filters below all still work. Open in a normal browser with internet to see the map.</div>';
}

function iconFor(r){
  const cls = r==="oiart" ? "oiart" : volClass(r)+(r.IsNew?" isnew":"");
  const label = r==="oiart" ? "★" : safe(rankLabel(r));
  return L.divIcon({className:"",html:`<div class="marker-label ${cls}">${label}</div>`,iconSize:[30,30],iconAnchor:[15,15],popupAnchor:[0,-14]});
}
if(hasMap){
  L.marker([OIART.lat,OIART.lon],{icon:iconFor("oiart"),zIndexOffset:1000}).bindPopup("<h3>OIART</h3><b>502 Newbold St, London ON</b><br>5 km and 10 km rings shown.").addTo(map);
  L.circle([OIART.lat,OIART.lon],{radius:5000,color:"#2f6f57",weight:2,fillOpacity:.03}).addTo(map);
  L.circle([OIART.lat,OIART.lon],{radius:10000,color:"#315f87",weight:2,fillOpacity:.02}).addTo(map);
  map.on("moveend zoomend",()=>{ if(currentFilteredList.length) renderLeadPanel(); });
}

let markers=[], markerById={}, currentFilteredList=[];
let selectedListingId = "";
let hasRenderedData = false;
function popup(r){
  return `<h3>${safe(rankLabel(r))}. ${safe(textOr(r["Listing / lead"], "Untitled listing"))}</h3>
  ${popupImage(r)}
  <span class="pill ${pillClass(r)}">${volLabel(r)}</span><span class="pill scorepill ${scoreLevelClass(r)}" title="${safe(scoreBreakdown(r))}">Score ${safe(r.ScoreNum)}</span><span class="pill kindpill ${kindClass(r)}">${safe(r.ListingKind)}</span>${r.IsNew?'<span class="pill newpill">★ new</span>':''}<br>
  <b>Area:</b> ${safe(textOr(r.Neighbourhood))}<br><b>Locator:</b> ${safe(textOr(r["Address / locator"]))}<br>
  <b>Type:</b> ${safe(textOr(r.Type))}<br><b>Rent:</b> ${safe(textOr(r["Rent text"]))}<br>
  <b>Drive:</b> ${safe(textOr(r["Est drive min"]))}${asText(r["Est drive min"])?" min":""} · <b>Parking:</b> ${safe(textOr(r.Parking))}<br>
  <b>Internet/util:</b> ${safe(textOr(r["Internet / utilities"]))}<br>
  <p style="margin:6px 0"><b>Why:</b> ${safe(textOr(r["Why add / note"]))}</p>
  <p style="margin:6px 0"><b>Verify:</b> ${safe(textOr(r["What to verify"]))}</p>
  <div class="links">${linkButton(r.URL, "Listing / search")} ${linkButton(routeLink(r), "Route to OIART", "route", "No route info")}</div>`;
}
function card(r){
  const arch=isArchived(r);
  const selected = String(selectedListingId) === String(r.ID) ? " selectedcard" : "";
  const action = arch
    ? `<button class="restorebtn" data-restore="${safe(r.ID)}">↩ Restore</button>`
    : r.NeedsId
      ? `<button class="trash disabled" disabled title="Add an ID in the Sheet before archiving">🗑</button>`
      : `<button class="trash" data-trash="${safe(r.ID)}" title="Archive to the Sheet (hide from Active)">🗑</button>`;
  const seen = r["Date seen"] ? `seen ${safe(r["Date seen"])}` : "";
  const chk = r["Last checked"] ? ` · checked ${safe(r["Last checked"])}` : "";
  const workflow = [
    ["Status", r.Status || r.Action],
    ["Contact", r.LastContacted || (r.ContactedBool ? "contacted" : "not contacted")],
    ["Response", r.Response],
    ["Viewing", r.ViewingDate || (r.ViewingBookedBool ? "booked" : "")]
  ].filter(x => asText(x[1]));
  const rent = textOr(r["Rent text"]);
  const drive = asText(r["Est drive min"]) ? `~${safe(r["Est drive min"])} min` : "drive not entered";
  return `<div class="card${selected}" data-id="${safe(r.ID)}">
  <div class="cardhead"><div class="pills"><span class="pill ${pillClass(r)}">${volLabel(r)}</span><span class="pill scorepill ${scoreLevelClass(r)}" title="${safe(rankTitle(r))}">#${safe(rankLabel(r))} · ${safe(r.ScoreNum)}${r.ScoreComputed && Number.isFinite(r.ScoreSheet) && r.ScoreSheet!==r.ScoreNum?` <span class="sheetcmp">(was ${safe(r.ScoreSheet)})</span>`:""}</span><span class="pill kindpill ${kindClass(r)}">${safe(r.ListingKind)}</span>${r.IsNew?'<span class="pill newpill">★ new</span>':''}${asText(r.DuplicateOf)?`<span class="pill warnpill" title="Marked as duplicate of ${safe(r.DuplicateOf)}">dup of ${safe(r.DuplicateOf)}</span>`:''}${r.NeedsId?'<span class="pill warnpill">Needs ID</span>':''}</div>${action}</div>
  <h3>${safe(textOr(r["Listing / lead"], "Untitled listing"))}</h3>
  ${imageThumb(r)}
  <div class="meta">${safe(textOr(r.Neighbourhood))} · ${safe(textOr(r["Address / locator"]))}</div>
  <div class="rent">${safe(rent)} <span class="meta" style="font-weight:500">· ${drive}</span></div>
  <div class="meta">${safe(textOr(r["Why add / note"]))}</div>
  ${scoreFlags(r)}
  ${workflow.length ? `<div class="workmeta">${workflow.map(([k,v]) => `<span><b>${safe(k)}:</b> ${safe(v)}</span>`).join("")}</div>` : ""}
  ${workflowEditor(r)}
  <div class="meta" style="margin-top:4px;font-size:11.5px">${seen}${chk}</div>
  <div class="links">${linkButton(r.URL, "Listing")} ${linkButton(routeLink(r), "Route", "route", "No route info")}<button class="linkbtn copy" data-copy="${safe(r.ID)}" type="button">Copy landlord message</button></div>
  </div>`;
}

function selected(value, option){ return asText(value) === option ? " selected" : ""; }
function checked(value){ return truthy(value) ? " checked" : ""; }
function workflowEditor(r){
  const disabled = r.NeedsId ? " disabled" : "";
  const idWarning = r.NeedsId ? `<div class="inlinewarn">Add an ID in the Sheet before saving changes for this row.</div>` : "";
  return `<details class="workflowedit" data-workflow-id="${safe(r.ID)}">
    <summary>Update status</summary>
    ${idWarning}
    <div class="workflowgrid workflowgrid-simple">
      <label>Status
        <select data-field="Status">
          <option value=""></option>
          ${["Message first","Contacted","Waiting reply","Viewing booked","Applied","Good option","Watch","Gone","Not a fit","Scam risk","Archived"].map(v=>`<option value="${safe(v)}"${selected(r.Status || r.Action, v)}>${safe(v)}</option>`).join("")}
        </select>
      </label>
      <label>Friend notes <textarea data-field="FriendNotes" placeholder="Quick shared note">${safe(r.FriendNotes)}</textarea></label>
    </div>
    <div class="links workflowactions">
      <button class="linkbtn copy" data-save-workflow="${safe(r.ID)}" type="button"${disabled}>Save to Sheet</button>
      <button class="linkbtn copy" data-status-quick="${safe(r.ID)}" data-status-value="Waiting reply" type="button"${disabled}>Waiting reply</button>
      <button class="linkbtn copy" data-status-quick="${safe(r.ID)}" data-status-value="Archived" type="button"${disabled}>Archive</button>
    </div>
    <details class="advancededit">
      <summary>Advanced fields</summary>
      <div class="workflowgrid">
      <label>Response
        <select data-field="Response">
          <option value=""></option>
          ${["Waiting","Interested","Viewing offered","No reply","Rejected","Gone","Duplicate","Scam"].map(v=>`<option value="${safe(v)}"${selected(r.Response, v)}>${safe(v)}</option>`).join("")}
        </select>
      </label>
      <label>Decision
        <select data-field="Decision">
          <option value=""></option>
          ${["Good option","Apply","Book viewing","Watch","Cut","Archived","Duplicate","Scam"].map(v=>`<option value="${safe(v)}"${selected(r.Decision, v)}>${safe(v)}</option>`).join("")}
        </select>
      </label>
      <label>Last contacted <input data-field="LastContacted" type="text" placeholder="YYYY-MM-DD" value="${safe(r.LastContacted)}"></label>
      <label>Viewing date <input data-field="ViewingDate" type="text" placeholder="YYYY-MM-DD / time" value="${safe(r.ViewingDate)}"></label>
      <label>Scam risk <input data-field="ScamRisk" type="text" placeholder="low / medium / high" value="${safe(r.ScamRisk)}"></label>
      <label>Duplicate of (ID) <input data-field="DuplicateOf" type="text" placeholder="e.g. A4" value="${safe(r.DuplicateOf)}"></label>
      </div>
      <div class="workflowchecks">
      ${["Contacted","ViewingBooked","ParkingConfirmed","InternetConfirmed","AddressConfirmed","JulyConfirmed"].map(f=>`<label><input data-field="${f}" type="checkbox"${checked(r[f])}> ${safe(f.replace(/([A-Z])/g," $1").trim())}</label>`).join("")}
      </div>
    </details>
  </details>`;
}

// Builds a warm, specific outreach message tailored to each listing: it
// references the real address/area, adapts to a room vs. a whole unit, and
// only asks about the things that are actually still unconfirmed for that row.
function landlordMessage(r){
  const addr = asText(r["Address / locator"]);
  const nb = asText(r.Neighbourhood);
  const goodAddr = addr && !/\barea\b|approx|unknown|\bmall\b|^n6[a-z]?\s*\d?$/i.test(addr);
  const hay = compact([r.Type, r["Listing / lead"], r["Criteria fit"]]).toLowerCase();
  const isUnit = /apartment|studio|bachelor|1-?bed|one bed|condo|townhouse|duplex|\bunit\b/.test(hay) && !/room in|private room/.test(hay);
  const noun = isUnit ? "place" : "room";
  const ref = goodAddr ? `your listing at ${addr}` : nb ? `your ${nb} ${noun}` : "your rental listing";

  const julyKnown = truthy(r.JulyConfirmed) || /july/.test(asText(r.Availability).toLowerCase());
  const timing = julyKnown ? "in July" : "around late July (I can be a little flexible on the exact date)";

  const intro = `Hi! I'm interested in ${ref}. I'm a domestic student starting at OIART (the audio-recording school at 502 Newbold St) and I'm looking for ${isUnit ? "a place" : "a private room"} on roughly a 12-month lease, ideally moving in ${timing}. I'm quiet, tidy, non-smoking, and happy to provide references.`;

  const qs = [];
  qs.push(julyKnown ? "is it still available?" : "is it still available, and would a July-to-July (or late-July) start work?");
  qs.push("the total monthly cost, including any utilities or fees?");
  if(r.NeedsInternet || !r.HasInternet) qs.push("whether internet is included (and roughly the speed)?");
  if(r.NeedsParking || !r.HasParking) qs.push("whether one outdoor parking spot is available?");
  if(r.NeedsAddress || !goodAddr) qs.push("the exact address or nearest major intersection?");
  if(!asText(r.Furnishing)) qs.push(`whether the ${noun} is furnished or unfurnished?`);
  if(!isUnit) qs.push("who else lives there, and how many people share the kitchen and bathroom?");

  const body = "If it's still open, could you let me know:\n" + qs.map(q => "• " + q).join("\n");
  const close = "I'd also love to set up a viewing — in person or a quick video walkthrough works for me. Thanks so much!";
  return `${intro}\n\n${body}\n\n${close}`;
}

async function copyLandlordMessage(id){
  const r = rows.find(x => String(x.ID) === String(id));
  if(!r) return;
  const msg = landlordMessage(r);
  try{
    if(!navigator.clipboard) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(msg);
    toast(`Copied landlord message for ${id}.`);
  }catch(e){
    const ta = document.createElement("textarea");
    ta.value = msg;
    ta.style.cssText = "position:fixed;left:-9999px;top:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    let copied = false;
    try{ copied = document.execCommand("copy"); }catch(err){}
    ta.remove();
    if(copied) toast(`Copied landlord message for ${id}.`);
    else showCopyFallback(id, msg);
  }
}

function showCopyFallback(id, msg){
  let box = el("copyFallback");
  if(!box){
    box = document.createElement("div");
    box.id = "copyFallback";
    box.className = "copyfallback";
    document.body.appendChild(box);
  }
  box.innerHTML = `<label for="copyFallbackText">Copy message for ${safe(id)}</label>
    <textarea id="copyFallbackText">${safe(msg)}</textarea>
    <div class="links"><button class="linkbtn copy" id="copyFallbackClose" type="button">Close</button></div>`;
  const text = el("copyFallbackText");
  text.focus();
  text.select();
  el("copyFallbackClose").onclick = () => box.remove();
}

function collectWorkflow(id){
  const box = document.querySelector(`[data-workflow-id="${CSS.escape(id)}"]`);
  if(!box) return {};
  const fields = {};
  box.querySelectorAll("[data-field]").forEach(input => {
    const field = input.dataset.field;
    fields[field] = input.type === "checkbox" ? (input.checked ? "TRUE" : "FALSE") : input.value.trim();
  });
  fields.UpdatedAt = new Date().toISOString();
  fields.UpdatedBy = UPDATED_BY;
  return fields;
}

function applyLocalFields(id, fields){
  const r = rows.find(x => String(x.ID) === String(id));
  if(!r) return;
  Object.assign(r, fields);
  deriveListing(r);
}

function updateSelection(id, focusMap=true){
  selectedListingId = String(id || "");
  document.querySelectorAll(".selectedcard").forEach(x=>x.classList.remove("selectedcard"));
  document.querySelectorAll(".selectedrow").forEach(x=>x.classList.remove("selectedrow"));
  if(!selectedListingId) return;
  document.querySelectorAll(`[data-id="${CSS.escape(selectedListingId)}"]`).forEach(x=>x.classList.add("selectedcard"));
  document.querySelectorAll(`tr[data-row-id="${CSS.escape(selectedListingId)}"]`).forEach(x=>x.classList.add("selectedrow"));
  if(focusMap && hasMap){
    const m=markerById[selectedListingId];
    if(m){map.setView(m.getLatLng(),14,{animate:true});m.openPopup();}
  }
}

async function saveWorkflow(id, fields){
  const existing = rows.find(x => String(x.ID) === String(id));
  if(existing && existing.NeedsId){
    toast("Add an ID in the Sheet before saving changes for this row.");
    return;
  }
  const clean = {};
  Object.keys(fields).forEach(k => {
    if(WRITABLE_FIELDS.includes(k)) clean[k] = fields[k];
  });
  applyLocalFields(id, clean);
  if(clean.Status === "Archived" || clean.Decision === "Archived") {
    archived.add(id);
    clean.Archived = "TRUE";
    applyLocalFields(id, {Archived:"TRUE"});
    persist();
  }
  render();
  if(!WRITE_URL){
    toast(`Updated ${id} in this browser only. Paste the Apps Script /exec URL into WRITE_URL to save to the Sheet.`);
    return;
  }
  await writeFields(id, clean);
}
function filtered(){
  const q=el("search").value.trim().toLowerCase();
  const vol=el("volume").value, neigh=el("neighbourhood").value, src=el("source").value;
  const drive=el("drive").value?Number(el("drive").value):null;
  let list=rows.filter(r=>{
    const isArch=isArchived(r);
    if(state.view==="active" && isArch) return false;
    if(state.view==="archived" && !isArch) return false;
    if(q && !searchText(r).includes(q)) return false;
    if(vol && !String(r.Volume).includes(vol)) return false;
    if(neigh && r.Neighbourhood!==neigh) return false;
    if(src && r.Source!==src) return false;
    if(drive!==null && num(r.DriveNum,999)>drive) return false;
    if(state.under1000 && !r.UnderTarget) return false;
    if(state.parking && !r.HasParking) return false;
    if(state.internet && !r.HasInternet) return false;
    if(state.newonly && !r.IsNew) return false;
    if(state.notContacted && r.ContactedBool) return false;
    if(state.waitingReply && !r.WaitingReply) return false;
    if(state.viewingBooked && !r.ViewingBookedBool) return false;
    if(state.goodOption && !r.GoodOption) return false;
    if(state.needsParking && !r.NeedsParking) return false;
    if(state.needsInternet && !r.NeedsInternet) return false;
    if(state.needsAddress && !r.NeedsAddress) return false;
    if(state.needsJuly && !r.NeedsJuly) return false;
    return true;
  });
  const k=state.sortKey, dir=state.sortDir;
  list.sort((a,b)=>{
    let av=a[k], bv=b[k];
    if(typeof av==="number"||k.endsWith("Num")){av=num(av,1e9);bv=num(bv,1e9);return (av-bv)*dir;}
    return String(av).localeCompare(String(bv))*dir;
  });
  return list;
}

function hasCoords(r){
  return Number.isFinite(num(r.LatNum,NaN)) && Number.isFinite(num(r.LonNum,NaN));
}

function mapVisibleList(){
  if(!hasMap || !map) return currentFilteredList;
  const bounds = map.getBounds();
  return currentFilteredList.filter(r => {
    const lat=num(r.LatNum,NaN), lon=num(r.LonNum,NaN);
    if(!Number.isFinite(lat) || !Number.isFinite(lon)) return state.showUnmapped;
    return bounds.contains([lat,lon]);
  });
}

function bindLeadPanelActions(){
  document.querySelectorAll(".card").forEach(c=>c.addEventListener("click",(ev)=>{
    if(ev.target.closest(".trash")||ev.target.closest(".restorebtn")||ev.target.closest("a")||ev.target.closest("[data-copy]")||ev.target.closest(".workflowedit")) return;
    updateSelection(c.dataset.id, true);
  }));
  document.querySelectorAll("[data-save-workflow]").forEach(b=>b.addEventListener("click",()=>saveWorkflow(b.dataset.saveWorkflow, collectWorkflow(b.dataset.saveWorkflow))));
  document.querySelectorAll("[data-status-quick]").forEach(b=>b.addEventListener("click",()=>saveWorkflow(b.dataset.statusQuick, {
    Status: b.dataset.statusValue,
    Decision: b.dataset.statusValue === "Archived" ? "Archived" : "",
    UpdatedAt: new Date().toISOString(),
    UpdatedBy: UPDATED_BY
  })));
  document.querySelectorAll("[data-trash]").forEach(b=>b.addEventListener("click",()=>{
    const id=b.dataset.trash;
    archived.add(id); persist(); render();
    if(WRITE_URL){ writeFields(id,{Archived:"TRUE",Status:"Archived",UpdatedAt:new Date().toISOString(),UpdatedBy:UPDATED_BY}); }
    else { toast(`Archived ${id} for this session. To make it stick for everyone, set Archived = TRUE for ${id} in the Sheet, then hit ↻ Refresh.`); }
  }));
  document.querySelectorAll("[data-restore]").forEach(b=>b.addEventListener("click",()=>{
    const rid=b.dataset.restore;
    archived.delete(rid); persist(); render();
    if(WRITE_URL){ writeFields(rid,{Archived:"FALSE",Status:"",UpdatedAt:new Date().toISOString(),UpdatedBy:UPDATED_BY}); }
  }));
  document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>copyLandlordMessage(b.dataset.copy)));
}

function renderLeadPanel(){
  const list = mapVisibleList();
  const total = currentFilteredList.length;
  const unmapped = currentFilteredList.filter(r => !hasCoords(r)).length;
  el("count").textContent = hasMap
    ? `(${list.length} on map · ${total} filtered${unmapped ? ` · ${unmapped} unmapped` : ""})`
    : `(${total} shown)`;
  if(hasMap){
    el("sideSub").textContent = "Showing the leads currently visible in the map view. Pan or zoom the map to change this pane; the full filtered table stays below.";
  }
  el("cards").innerHTML = list.length
    ? list.map(card).join("")
    : `<div class="emptycard">No mapped leads in this view. Pan or zoom the map, or use the full filtered table below.</div>`;
  bindLeadPanelActions();
}

function render(options={}){
  computeRanks();
  const list=filtered();
  currentFilteredList=list;
  if(selectedListingId && !list.some(r => String(r.ID) === String(selectedListingId))) selectedListingId = "";
  if(hasMap){
    markers.forEach(m=>map.removeLayer(m)); markers=[]; markerById={};
    const bounds=[];
    list.forEach(r=>{
      const lat=num(r.LatNum,NaN), lon=num(r.LonNum,NaN);
      if(!Number.isFinite(lat)||!Number.isFinite(lon)) return;
      const m=L.marker([lat,lon],{icon:iconFor(r)}).bindPopup(popup(r)).addTo(map);
      markers.push(m); markerById[r.ID]=m; bounds.push([lat,lon]);
    });
    if(options.fitMap && bounds.length){bounds.push([OIART.lat,OIART.lon]);map.fitBounds(bounds,{padding:[40,40],maxZoom:13});}
  }
  renderLeadPanel();
  const ab=el("archivebar");
  if(state.view==="archived"){ const nArch=rows.filter(isArchived).length; ab.classList.add("show"); ab.textContent = nArch ? `${nArch} archived listing(s). Restore only changes this browser unless write-back is configured. For shared cleanup, set Archived=TRUE/FALSE in the Sheet and refresh.` : "No archived listings yet. The archive button is session-only here; set Archived=TRUE in the Sheet for shared cleanup."; }
  else ab.classList.remove("show");
  el("tbody").innerHTML=list.map(tableRow).join("");
  document.querySelectorAll("[data-copy]").forEach(b=>b.addEventListener("click",()=>copyLandlordMessage(b.dataset.copy)));
  document.querySelectorAll("[data-expand]").forEach(b=>b.addEventListener("click",(ev)=>{
    ev.stopPropagation();
    const dr=document.querySelector(`tr[data-detail-id="${CSS.escape(b.dataset.expand)}"]`);
    if(!dr) return;
    if(dr.hasAttribute("hidden")){ dr.removeAttribute("hidden"); b.textContent="▾"; b.classList.add("open"); }
    else { dr.setAttribute("hidden",""); b.textContent="▸"; b.classList.remove("open"); }
  }));
  document.querySelectorAll("tr.mainrow[data-row-id]").forEach(tr=>tr.addEventListener("click",(ev)=>{
    if(ev.target.closest("a")||ev.target.closest("button")) return;
    updateSelection(tr.dataset.rowId, true);
  }));
  updateCounts();
}
// sites grouped by category
function renderSites(){
  const order=["Aggregator","MLS","Roommate","Student","Student/Local","Local landlord","Social","Niche"];
  const groups={};
  sites.forEach(s=>{(groups[s.Category]=groups[s.Category]||[]).push(s);});
  const cats=Object.keys(groups).sort((a,b)=>{const ia=order.indexOf(a),ib=order.indexOf(b);return (ia<0?99:ia)-(ib<0?99:ib);});
  let html="";
  cats.forEach(cat=>{
    html+=`<div class="sitegroup"><h3>${safe(cat)} · ${groups[cat].length}</h3><div class="sitegrid">`;
    html+=groups[cat].map(s=>`<div class="sitecard ${s.IsNew?'new':''}">
      <h3>${safe(textOr(s.Source, "Unnamed source"))}${s.IsNew?' <span class="pill newpill">new</span>':''}</h3>
      <div class="role">${safe(textOr(s["Use for"]))}</div>
      <div class="f"><b>Filters:</b> ${safe(textOr(s.Filters))}</div>
      <div class="f"><b>Keep:</b> ${safe(textOr(s.Keep))}</div>
      <div class="f"><b>Avoid:</b> ${safe(textOr(s.Avoid))}</div>
    </div>`).join("");
    html+=`</div></div>`;
  });
  el("sites").innerHTML=html;
}

["search","volume","neighbourhood","source","drive"].forEach(id=>el(id).addEventListener("input",render));
function toggle(id,key){el(id).onclick=()=>{state[key]=!state[key];el(id).classList.toggle("active",state[key]);render();};}
toggle("under1000","under1000");toggle("parking","parking");toggle("internet","internet");toggle("newonly","newonly");
document.querySelectorAll("[data-filter]").forEach(btn => {
  const key = btn.dataset.filter;
  btn.addEventListener("click", () => {
    state[key] = !state[key];
    btn.classList.toggle("active", state[key]);
    render();
  });
});
el("tabActive").onclick=()=>{state.view="active";el("tabActive").classList.add("active");el("tabArchived").classList.remove("active");render();};
el("tabArchived").onclick=()=>{state.view="archived";el("tabArchived").classList.add("active");el("tabActive").classList.remove("active");render();};
const showUnmappedBtn=el("showUnmapped");
if(showUnmappedBtn) showUnmappedBtn.onclick=()=>{state.showUnmapped=!state.showUnmapped;showUnmappedBtn.classList.toggle("active",state.showUnmapped);renderLeadPanel();};
el("reset").onclick=()=>{state.under1000=state.parking=state.internet=state.newonly=false;
  ["notContacted","waitingReply","viewingBooked","goodOption","needsParking","needsInternet","needsAddress","needsJuly"].forEach(k=>state[k]=false);
  ["under1000","parking","internet","newonly"].forEach(id=>el(id).classList.remove("active"));
  document.querySelectorAll("[data-filter]").forEach(btn=>btn.classList.remove("active"));
  ["search","volume","neighbourhood","source","drive"].forEach(id=>el(id).value="");
  state.sortKey="PriorityNum";state.sortDir=1;render({fitMap:true});};
document.querySelectorAll("th[data-k]").forEach(th=>th.addEventListener("click",()=>{
  const k=th.dataset.k;
  if(state.sortKey===k) state.sortDir*=-1; else {state.sortKey=k;state.sortDir=1;}
  document.querySelectorAll("th .arr").forEach(a=>a.remove());
  const arr=document.createElement("span");arr.className="arr";arr.textContent=state.sortDir>0?" ▼":" ▲";th.appendChild(arr);
  render();
}));

function csvForRows(list){
  const baseCols = [
    "ID","Volume","Action","Priority","Listing / lead","Source","ListingKind","Neighbourhood","Address / locator",
    "Type","Rent text","Approx monthly share","Est drive min","Parking","Internet / utilities",
    "Availability","What to verify","URL","Maps link","Score","ScoreAuto","ScoreOverride","Archived","IsNew"
  ];
  const cols = [...baseCols, ...WORKFLOW_COLUMNS, ...IMAGE_COLUMNS];
  return [cols.join(","), ...list.map(r => cols.map(c => csvEscape(c === "ScoreAuto" ? r.ScoreAuto : r[c])).join(","))].join("\n");
}

function downloadCsv(csv, name){
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportFilteredCsv(){
  downloadCsv(csvForRows(filtered()), `oiart_filtered_${new Date().toISOString().slice(0,10)}.csv`);
  toast("Exported the currently filtered rows.");
}

function exportMasterCsv(){
  downloadCsv(csvForRows(rows), `oiart_master_${new Date().toISOString().slice(0,10)}.csv`);
  toast(`Exported all ${rows.length} listings (master CSV). Sheet 'Score' is preserved; 'ScoreAuto' holds the computed value.`);
}

const exportBtn=el("exportCsv");
if(exportBtn) exportBtn.onclick=exportFilteredCsv;
const masterBtn=el("downloadMaster");
if(masterBtn) masterBtn.onclick=exportMasterCsv;
const printBtn=el("printView");
if(printBtn) printBtn.onclick=()=>window.print();

/* ============================ live data orchestration ====================== */
function setStatus(msg, kind){
  const s=el("dataStatus"); if(!s) return;
  if(!msg){ s.style.display="none"; return; }
  const palette={ok:["#e2efe8","#2f6f57"],warn:["#fbf0dc","#8c551b"],err:["#fbe4de","#9d3e2f"],"":["#e0eaf4","#315f87"]};
  const c=palette[kind||""]||palette[""];
  s.style.cssText=`display:block;margin:0 0 16px;padding:11px 15px;border-radius:12px;font:500 13px Inter,sans-serif;background:${c[0]};color:${c[1]};border:1px solid rgba(0,0,0,.06);`;
  s.textContent=msg;
}

function setSourceBadge(label, kind, ts){
  const b=el("sourceBadge"); if(!b) return;
  b.classList.remove("warn","err");
  if(kind==="warn") b.classList.add("warn");
  if(kind==="err") b.classList.add("err");
  const stamp = ts ? new Date(ts).toLocaleString() : new Date().toLocaleString();
  b.textContent = `${label} · refreshed ${stamp}`;
}

let toastTimer=null;
function toast(msg){
  let t=el("toast");
  if(!t){ t=document.createElement("div"); t.id="toast";
    t.style.cssText="position:fixed;left:50%;bottom:24px;transform:translateX(-50%);max-width:90vw;background:#2b2620;color:#fff;padding:12px 18px;border-radius:12px;font:500 13.5px Inter,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);z-index:3000;opacity:0;transition:opacity .2s;";
    document.body.appendChild(t);
  }
  t.textContent=msg; t.style.opacity="1";
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>{t.style.opacity="0";},6500);
}

async function writeCell(id, field, value){
  return writeFields(id, {[field]: value});
}

async function writeFields(id, fields){
  if(!WRITE_URL) return;
  try{
    const payload = WRITE_TOKEN ? {id,fields,token:WRITE_TOKEN} : {id,fields};
    const res = await fetch(WRITE_URL,{method:"POST",body:JSON.stringify(payload)}); // text/plain body avoids CORS preflight
    const text = await res.text();
    let data = {};
    try{ data = JSON.parse(text); }catch(e){}
    if(!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
    toast(`Saved ${id} to the Sheet.`);
    setTimeout(()=>init(), 900);
  }catch(e){
    toast(`Couldn't write ${id} to the Sheet (${e.message}). The local view updated, but shared sync needs the Apps Script endpoint.`);
  }
}

function applyData(d){
  rows = (d && d.rows) || [];
  sites = (d && d.sites) || [];
  const shouldFitMap = !hasRenderedData;
  renderKPIs(); populateFilters(); renderSites(); render({fitMap: shouldFitMap});
  hasRenderedData = true;
}
function cacheSave(){ try{ localStorage.setItem("oiart_cache", JSON.stringify({rows,sites,ts:Date.now()})); }catch(e){} }
function cacheLoad(){ try{ const c=JSON.parse(localStorage.getItem("oiart_cache")); if(c && Array.isArray(c.rows)) return c; }catch(e){} return null; }
async function loadRepoCsvFallback(){
  const [r,s]=await Promise.all([
    loadCsv(CSV_FALLBACKS.listings,"listings"),
    loadCsv(CSV_FALLBACKS.sites,"sites")
  ]);
  return {rows:r,sites:s};
}

async function init(){
  if(SHEET_ID==="PASTE_SHEET_ID_HERE"){
    const cached=cacheLoad();
    if(cached){ applyData(cached); setSourceBadge("Cached data","warn",cached.ts); setStatus(`No Sheet ID set yet — showing a cached copy from ${new Date(cached.ts).toLocaleString()}. Paste your SHEET_ID in index.html to go live.`,"warn"); }
    else {
      try{
        const csv=await loadRepoCsvFallback();
        applyData(csv); setSourceBadge("Seed CSV fallback","warn");
        setStatus("No Sheet ID configured yet — showing the repo CSV seed data.","warn");
      }catch(e){
        applyData({rows:[],sites:[]}); setSourceBadge("No data","err"); setStatus("No Sheet ID configured yet and CSV fallback could not load. Open index.html through a local/static server, not directly as a file.","err");
      }
    }
    return;
  }
  setStatus("Loading the latest data from the Google Sheet…","");
  setSourceBadge("Loading Sheet","warn");
  try{
    const [r,s]=await Promise.all([loadSheetWithTabs("listings"), loadSheetWithTabs("sites")]);
    applyData({rows:r,sites:s}); cacheSave();
    setSourceBadge("Live Sheet","ok");
    setStatus(`Live — ${r.length} listings loaded from the Sheet at ${new Date().toLocaleTimeString()}.`,"ok");
    setTimeout(()=>setStatus("",""),4000);
  }catch(e){
    try{
      const csv=await loadRepoCsvFallback();
      applyData(csv); setSourceBadge("Seed CSV fallback","warn");
      setStatus(`Couldn't reach the Sheet (${e.message}). Showing the repo CSV fallback included with the site.`,"warn");
    }catch(csvError){
      const cached=cacheLoad();
      if(cached){ applyData(cached); setSourceBadge("Cached data","warn",cached.ts); setStatus(`Couldn't reach the Sheet (${e.message}) or repo CSV (${csvError.message}). Showing the last cached copy from ${new Date(cached.ts).toLocaleString()}.`,"warn"); }
      else { applyData({rows:[],sites:[]}); setSourceBadge("No data","err"); setStatus(`Couldn't load the Sheet (${e.message}), repo CSV (${csvError.message}), or a cached copy. Check Sheet sharing and that the CSV files are in the repo root.`,"err"); }
    }
  }
}

const refreshBtn=el("refresh");
if(refreshBtn) refreshBtn.onclick=()=>init();
init();
// Auto-refresh, but never mid-edit: an open status editor, an active form field,
// or the copy-fallback box would otherwise get wiped by a re-render every 60s.
function isEditing(){
  if(document.querySelector(".workflowedit[open]")) return true;
  if(el("copyFallback")) return true;
  const a=document.activeElement;
  return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
}
setInterval(()=>{ if(!isEditing()) init(); }, 60000);

/* ============================================================================
   OPTIONAL TRUE WRITE-BACK MODULE
   ----------------------------------------------------------------------------
   This static GitHub Pages app reads from the Sheet directly. To let card edits
   write back to the Sheet too, deploy apps-script/OIART_WRITEBACK.gs as a bound
   Apps Script web app, then paste its /exec URL into WRITE_URL above.

   The script only accepts allowlisted workflow fields, adds UpdatedAt/UpdatedBy,
   and includes setupOiartRentalSheet() to add missing columns + friendly sheet
   formatting (frozen header, filters, readable widths).
   ========================================================================== */
