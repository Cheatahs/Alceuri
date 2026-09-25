// Alceuri: gedeelde cafédatabase als Google Sheet + Apps Script-webapp.
// Gratis, geen server, en pauzeert nooit bij inactiviteit.
// Installatie: zie README.md ("Gedeelde cafédatabase").
//
// Elke gedeelde scan is één rij in het tabblad "scans". Moderatie = een rij
// verwijderen in de spreadsheet.

const SHEET_NAME = "scans";
const HEADERS = ["id", "created_at", "cafe_name", "city", "lat", "lon", "best_score", "items"];
const MAX_ITEMS = 150;          // dranken per scan
const MAX_POSTS_PER_MIN = 20;   // eenvoudige rem tegen spam, over alle gebruikers heen
const CACHE_KEY = "scans_v1";
const CACHE_SECONDS = 120;

// ── lezen ─────────────────────────────────────────────────────────
// ?mode=top                    → beste score per café, top 25
// ?mode=city&q=gent            → cafés in een stad (recentste scan per café)
// ?mode=nearby&lat=..&lon=..   → dichtstbijzijnde cafés met locatie
function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    const scans = readScans();
    let result;
    if (p.mode === "city") {
      const q = norm(p.q || "");
      if (!q) return json({ error: "stad ontbreekt" });
      result = dedupe(newestFirst(scans.filter(s => norm(s.city).includes(q))))
        .sort((a, b) => b.best_score - a.best_score)
        .slice(0, 50);
    } else if (p.mode === "nearby") {
      const pos = { lat: Number(p.lat), lon: Number(p.lon) };
      if (!validLat(pos.lat) || !validLon(pos.lon)) return json({ error: "ongeldige locatie" });
      result = dedupe(newestFirst(scans.filter(s => s.lat != null)))
        .sort((a, b) => haversineKm(pos, a) - haversineKm(pos, b))
        .slice(0, 25);
    } else {
      result = dedupe(scans.slice().sort((a, b) => b.best_score - a.best_score)).slice(0, 25);
    }
    return json({ scans: result });
  } catch (err) {
    return json({ error: String(err.message || err) });
  }
}

// ── schrijven ─────────────────────────────────────────────────────
// De app post JSON als text/plain, zodat de browser geen CORS-preflight doet.
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    if (!rateLimitOk()) return json({ error: "even te druk — probeer zo opnieuw" });

    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const scan = validateScan(body);
    sheet().appendRow([
      scan.id, scan.created_at, safeCell(scan.cafe_name), safeCell(scan.city),
      scan.lat == null ? "" : scan.lat, scan.lon == null ? "" : scan.lon,
      scan.best_score, JSON.stringify(scan.items),
    ]);
    CacheService.getScriptCache().remove(CACHE_KEY);
    return json({ ok: true, id: scan.id });
  } catch (err) {
    return json({ error: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ── validatie: nooit ruwe invoer bewaren ──────────────────────────
function validateScan(b) {
  const cafe = cleanText(b.cafe_name, 80);
  const city = cleanText(b.city, 60);
  if (!cafe) throw new Error("naam van het café ontbreekt");
  if (!city) throw new Error("stad ontbreekt");
  if (!Array.isArray(b.items) || !b.items.length) throw new Error("geen dranken");

  const items = b.items.slice(0, MAX_ITEMS).map(cleanItem).filter(Boolean);
  if (!items.length) throw new Error("geen geldige dranken");
  items.sort((a, c) => c.score - a.score);

  let lat = b.lat == null ? null : Number(b.lat);
  let lon = b.lon == null ? null : Number(b.lon);
  if (!validLat(lat) || !validLon(lon)) { lat = null; lon = null; }

  return {
    id: Utilities.getUuid(),
    created_at: new Date().toISOString(),
    cafe_name: cafe,
    city: city,
    lat: lat == null ? null : round(lat, 5),
    lon: lon == null ? null : round(lon, 5),
    best_score: items[0].score,
    items: items,
  };
}

function cleanItem(it) {
  if (!it || typeof it !== "object") return null;
  const abv = Number(it.abv), volMl = Number(it.volMl), price = Number(it.price);
  if (!(abv > 0 && abv <= 96) || !(volMl >= 10 && volMl <= 5000) || !(price > 0 && price <= 500)) return null;
  const displayName = cleanText(it.displayName, 80);
  if (!displayName) return null;
  const cats = ["bier", "wijn", "schuimwijn", "aperitief", "sterk", "likeur", "cocktail", "?"];
  const sources = ["database", "schatting", "handmatig"];
  return {
    displayName: displayName,
    matchedName: cleanText(it.matchedName, 80) || null,
    cat: cats.indexOf(it.cat) >= 0 ? it.cat : "?",
    abv: abv,
    volMl: volMl,
    volAssumed: it.volAssumed === true,
    price: price,
    // score altijd zelf herberekenen: ml pure alcohol per euro
    score: round((volMl * abv / 100) / price, 3),
    source: sources.indexOf(it.source) >= 0 ? it.source : "handmatig",
  };
}

// ── hulpfuncties ──────────────────────────────────────────────────
function sheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function readScans() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_KEY);
  if (cached) return JSON.parse(cached);

  const sh = sheet();
  const n = sh.getLastRow() - 1;
  const rows = n > 0 ? sh.getRange(2, 1, n, HEADERS.length).getValues() : [];
  const scans = [];
  rows.forEach(r => {
    let items;
    try { items = JSON.parse(r[7]); } catch (err) { return; } // kapotte rij overslaan
    if (!Array.isArray(items) || !items.length || !r[2]) return;
    scans.push({
      id: String(r[0]),
      created_at: r[1] instanceof Date ? r[1].toISOString() : String(r[1]),
      cafe_name: String(r[2]),
      city: String(r[3]),
      lat: r[4] === "" ? null : Number(r[4]),
      lon: r[5] === "" ? null : Number(r[5]),
      best_score: Number(r[6]) || 0,
      items: items,
    });
  });

  // cache is beperkt tot 100 KB per sleutel; te groot = gewoon niet cachen
  const str = JSON.stringify(scans);
  if (str.length < 95000) cache.put(CACHE_KEY, str, CACHE_SECONDS);
  return scans;
}

function newestFirst(scans) {
  return scans.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}

// meerdere scans van hetzelfde café: de eerste in de (gesorteerde) lijst wint
function dedupe(scans) {
  const seen = {};
  return scans.filter(s => {
    const key = norm(s.cafe_name) + "|" + norm(s.city);
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function rateLimitOk() {
  const cache = CacheService.getScriptCache();
  const key = "posts_" + Math.floor(Date.now() / 60000);
  const count = Number(cache.get(key) || 0);
  if (count >= MAX_POSTS_PER_MIN) return false;
  cache.put(key, String(count + 1), 120);
  return true;
}

function haversineKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.pow(Math.sin(dLat / 2), 2) +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.pow(Math.sin(dLon / 2), 2);
  return 2 * R * Math.asin(Math.sqrt(h));
}

function cleanText(s, max) {
  if (typeof s !== "string") return "";
  return s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// tekst die met = + - @ begint zou Sheets als formule lezen; ' forceert tekst
function safeCell(s) {
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
}

function validLat(v) { return typeof v === "number" && isFinite(v) && v >= -90 && v <= 90; }
function validLon(v) { return typeof v === "number" && isFinite(v) && v >= -180 && v <= 180; }
function round(v, d) { const f = Math.pow(10, d); return Math.round(v * f) / f; }

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// Eén keer handmatig uitvoeren in de editor: maakt het tabblad aan en vraagt de rechten.
function setup() {
  sheet();
}
