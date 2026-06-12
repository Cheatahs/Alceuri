// Alceuri parser: zet ruwe OCR-tekst van een drankenkaart om naar gescoorde dranken.
// Werkt zowel in de browser (globals uit drinks-db.js) als in Node (voor tests).
(function (root, factory) {
  if (typeof module !== "undefined") {
    const db = require("./drinks-db.js");
    module.exports = factory(db.DRINKS_DB, db.CATEGORY_FALLBACKS, db.NON_ALCOHOL_KEYWORDS);
  } else {
    root.AlceuriParser = factory(root.DRINKS_DB, root.CATEGORY_FALLBACKS, root.NON_ALCOHOL_KEYWORDS);
  }
})(typeof self !== "undefined" ? self : this, function (DRINKS_DB, CATEGORY_FALLBACKS, NON_ALCOHOL_KEYWORDS) {

  function normalize(s) {
    return s
      .toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/['']/g, "")
      .replace(/-/g, " ")
      .replace(/[^a-z0-9&\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1);
    let cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  // gelijkenis 0..1 tussen twee genormaliseerde strings
  function similarity(a, b) {
    const maxLen = Math.max(a.length, b.length);
    if (!maxLen) return 0;
    return 1 - levenshtein(a, b) / maxLen;
  }

  // ── Prijs uit een regel halen ───────────────────────────────────
  // Voorbeelden: "€ 4,50" | "4.50" | "€5" | "5,5" | "12.00 €"
  function extractPrice(line) {
    const re = /(?:€|eur\b)?\s*(\d{1,3})(?:[.,](\d{1,2}))?\s*(?:€|eur\b)?/gi;
    let best = null;
    let m;
    while ((m = re.exec(line)) !== null) {
      const whole = m[0];
      const hasEuro = /€|eur/i.test(whole);
      const hasDecimals = m[2] !== undefined;
      // los getal zonder €-teken en zonder decimalen is te ambigu (kan volume/jaargang zijn)
      if (!hasEuro && !hasDecimals) continue;
      const intPart = parseInt(m[1], 10);
      const decRaw = m[2] || "0";
      const dec = parseInt(decRaw, 10) / (decRaw.length === 1 ? 10 : 100);
      const value = intPart + dec;
      if (value <= 0 || value > 250) continue;
      const cand = { value, index: m.index, length: whole.length, hasEuro };
      // voorkeur: meest rechtse prijs; €-teken wint bij gelijke stand
      if (!best || cand.index > best.index || (cand.hasEuro && !best.hasEuro)) best = cand;
    }
    return best;
  }

  // ── Volume uit een regel halen ──────────────────────────────────
  // Voorbeelden: "25cl" | "33 cl" | "0,5l" | "500ml" | "1/2 liter"
  function extractVolume(line) {
    const re = /(\d+(?:[.,]\d+)?)\s*(cl|ml|l|liter|litre)\b/i;
    const m = re.exec(line);
    if (!m) return null;
    const num = parseFloat(m[1].replace(",", "."));
    const unit = m[2].toLowerCase();
    let ml;
    if (unit === "ml") ml = num;
    else if (unit === "cl") ml = num * 10;
    else ml = num * 1000;
    if (ml < 10 || ml > 5000) return null;
    return { ml, index: m.index, length: m[0].length };
  }

  // ── Naam matchen tegen de database ──────────────────────────────
  function matchDrink(rawName) {
    const name = normalize(rawName);
    if (!name || name.length < 3) return null;
    let best = null;
    for (const drink of DRINKS_DB) {
      const candidates = [drink.name, ...drink.aliases].map(normalize);
      for (const cand of candidates) {
        let score = similarity(name, cand);
        // ook proberen: kandidaat komt voor als deel van de regel
        // (bv. "duvel 33cl van het vat" bevat "duvel")
        if (score < 0.85 && name.includes(cand) && cand.length >= 4) {
          score = 0.84 + 0.1 * (cand.length / name.length);
        }
        // OCR-tolerante woordmatch: elk woord van de kandidaat komt ~fuzzy voor in de regel
        if (score < 0.8) {
          const candWords = cand.split(" ");
          const lineWords = name.split(" ");
          const hits = candWords.filter(cw =>
            lineWords.some(lw => similarity(lw, cw) >= 0.8)
          ).length;
          if (hits === candWords.length && candWords.length >= 1) {
            const coverage = cand.length / Math.max(name.length, cand.length);
            score = Math.max(score, 0.75 + 0.2 * coverage);
          }
        }
        if (!best || score > best.score) {
          best = { drink, score };
        }
      }
    }
    if (best && best.score >= 0.78) return best;
    return null;
  }

  function isNonAlcoholic(rawName) {
    const name = " " + normalize(rawName) + " ";
    return NON_ALCOHOL_KEYWORDS.some(kw => name.includes(" " + kw.trim() + " ") || name.includes(kw));
  }

  function categoryFallback(rawName) {
    const name = " " + normalize(rawName) + " ";
    for (const fb of CATEGORY_FALLBACKS) {
      if (fb.kw.some(kw => name.includes(normalize(kw)))) return fb;
    }
    return null;
  }

  // ── Alceuri-score: ml pure alcohol per euro ─────────────────────
  function alceuriScore(volMl, abv, price) {
    if (!price || price <= 0) return 0;
    return (volMl * abv / 100) / price;
  }

  // ── Hoofdfunctie: OCR-tekst → gescoorde dranken ────────────────
  function parseMenu(text) {
    const items = [];
    const unmatched = [];
    const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length >= 3);

    for (const line of lines) {
      const price = extractPrice(line);
      if (!price) continue; // zonder prijs geen score

      const volume = extractVolume(line);

      // naam = regel zonder prijs- en volumedeel
      let nameRaw = line;
      const cuts = [price, volume].filter(Boolean).sort((a, b) => b.index - a.index);
      for (const cut of cuts) {
        nameRaw = nameRaw.slice(0, cut.index) + " " + nameRaw.slice(cut.index + cut.length);
      }
      nameRaw = nameRaw.replace(/[.…_\-–—]{2,}/g, " ").replace(/\s+/g, " ").trim();
      if (normalize(nameRaw).length < 3) continue;

      // niet-alcoholisch wint van een zwakke fuzzy match (bv. "spa bruis" ≠ "brugs"),
      // maar een (bijna) exacte databasematch wint van een los trefwoord (bv. "gin-tonic" bevat "tonic")
      const match = matchDrink(nameRaw);
      if (match && match.score < 0.92 && isNonAlcoholic(nameRaw)) {
        continue;
      }
      if (match) {
        const volMl = volume ? volume.ml : match.drink.vol;
        items.push({
          displayName: nameRaw,
          matchedName: match.drink.name,
          matchScore: match.score,
          cat: match.drink.cat,
          abv: match.drink.abv,
          volMl,
          volAssumed: !volume,
          price: price.value,
          score: alceuriScore(volMl, match.drink.abv, price.value),
          source: "database",
        });
        continue;
      }

      if (isNonAlcoholic(nameRaw)) continue;

      const fb = categoryFallback(nameRaw);
      if (fb) {
        const volMl = volume ? volume.ml : fb.vol;
        items.push({
          displayName: nameRaw,
          matchedName: null,
          matchScore: 0,
          cat: fb.cat,
          abv: fb.abv,
          volMl,
          volAssumed: !volume,
          price: price.value,
          score: alceuriScore(volMl, fb.abv, price.value),
          source: "schatting",
        });
      } else {
        unmatched.push({ displayName: nameRaw, price: price.value, volMl: volume ? volume.ml : null });
      }
    }

    items.sort((a, b) => b.score - a.score);
    return { items, unmatched };
  }

  return { parseMenu, alceuriScore, matchDrink, extractPrice, extractVolume, normalize };
});
