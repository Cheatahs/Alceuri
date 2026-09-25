// Alceuri app: foto → OCR (Tesseract.js, in-browser) → parser → ranking
// + gedeelde cafédatabase (Google Sheet via Apps Script) voor alle gebruikers
(function () {
  const fileInput = document.getElementById("file-input");
  const demoBtn = document.getElementById("demo-btn");
  const previewWrap = document.getElementById("preview-wrap");
  const previewImg = document.getElementById("preview-img");
  const ocrStatus = document.getElementById("ocr-status");
  const statusText = document.getElementById("status-text");
  const progressFill = document.getElementById("progress-fill");
  const panelResults = document.getElementById("panel-results");
  const resultsList = document.getElementById("results-list");
  const winnerBurst = document.getElementById("winner-burst");
  const unmatchedWrap = document.getElementById("unmatched-wrap");
  const unmatchedList = document.getElementById("unmatched-list");
  const ocrRaw = document.getElementById("ocr-raw");
  const manualForm = document.getElementById("manual-form");

  // huidige lijst (scan + handmatige toevoegingen)
  let currentItems = [];
  let currentUnmatched = [];

  // ── beeldvoorbewerking: grijswaarden + contrast, helpt Tesseract ──
  // invert=true voor kaarten met lichte tekst op donkere achtergrond
  // Kleine foto's worden vergroot, grote gsm-foto's (4000+ px) verkleind:
  // dat maakt de OCR veel sneller zonder leesbaarheid te verliezen.
  function preprocessImage(img, invert) {
    const targetW = 2000;
    const scale = Math.min(1.6, targetW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      let g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (invert) g = 255 - g;
      g = ((g - 128) * 1.35) + 128; // contrast omhoog
      g = Math.max(0, Math.min(255, g));
      px[i] = px[i + 1] = px[i + 2] = g;
    }
    ctx.putImageData(data, 0, 0);
    return canvas;
  }

  function setProgress(label, frac) {
    statusText.textContent = label;
    progressFill.style.width = Math.round(frac * 100) + "%";
  }

  // Tesseract.js (±5 MB met taaldata) pas laden bij de eerste scan,
  // zodat de pagina zelf meteen opent.
  let tesseractLoading = null;
  function loadTesseract() {
    if (globalThis.Tesseract) return Promise.resolve();
    if (!tesseractLoading) {
      tesseractLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        s.onload = resolve;
        s.onerror = () => { tesseractLoading = null; reject(new Error("OCR-bibliotheek niet geladen (offline?)")); };
        document.head.appendChild(s);
      });
    }
    return tesseractLoading;
  }

  // ── OCR-flow ───────────────────────────────────────────────────
  async function scanImage(src) {
    previewImg.src = src;
    previewWrap.classList.remove("hidden");
    ocrStatus.classList.remove("hidden");
    setProgress("OCR-engine laden... (eerste keer duurt even)", 0.05);

    let worker = null;
    try {
      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error("afbeelding niet leesbaar"));
        img.src = src;
      });
      await loadTesseract();
      worker = await Tesseract.createWorker(["nld", "eng"], 1, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setProgress("Kaart aan het lezen... 🤓", 0.15 + 0.7 * m.progress);
          }
        },
      });
      let { data } = await worker.recognize(preprocessImage(img, false));

      // zwakke herkenning? dan was het misschien lichte tekst op een donkere
      // kaart — tweede poging met geïnverteerd beeld, beste resultaat wint
      if (data.confidence < 65) {
        setProgress("Donkere kaart? Tweede poging... 🔦", 0.88);
        const inv = await worker.recognize(preprocessImage(img, true));
        if (inv.data.confidence > data.confidence) data = inv.data;
      }

      setProgress("Dranken herkennen...", 1);
      handleOcrText(data.text);
    } catch (err) {
      console.error(err);
      statusText.textContent = "⚠️ Scannen mislukt: " + err.message + " — probeer een scherpere foto of voeg handmatig toe.";
      progressFill.style.width = "0%";
      return;
    } finally {
      if (worker) worker.terminate();
    }
    ocrStatus.classList.add("hidden");
  }

  function handleOcrText(text) {
    ocrRaw.textContent = text;
    const { items, unmatched } = AlceuriParser.parseMenu(text);
    currentItems = items;
    currentUnmatched = unmatched;
    render();
    panelResults.scrollIntoView({ behavior: "smooth" });
  }

  // ── rendering van de ranking ───────────────────────────────────
  const MEDALS = ["🥇", "🥈", "🥉"];
  const CAT_ICONS = { bier: "🍺", wijn: "🍷", schuimwijn: "🥂", aperitief: "🍸", sterk: "🥃", likeur: "🍶", cocktail: "🍹", "?": "❓" };

  function render() {
    panelResults.classList.remove("hidden");
    resultsList.innerHTML = "";
    winnerBurst.classList.toggle("hidden", currentItems.length === 0);

    if (currentItems.length === 0) {
      resultsList.innerHTML = "<p class='hint'>Geen alcoholische dranken met prijs gevonden. 😢 Probeer een scherpere foto of voeg handmatig toe.</p>";
    }

    currentItems.forEach((item, i) => {
      const li = document.createElement("li");
      li.className = "result-item rank-" + (i + 1);
      const medal = MEDALS[i] || "#" + (i + 1);
      const icon = CAT_ICONS[item.cat] || CAT_ICONS["?"];
      const volTxt = (item.volMl / 10).toFixed(item.volMl % 10 ? 1 : 0) + " cl" + (item.volAssumed ? "*" : "");
      const matched = item.matchedName && item.matchedName.toLowerCase() !== item.displayName.toLowerCase()
        ? ` <span class="result-source">(herkend als ${esc(item.matchedName)})</span>` : "";
      const srcTxt = item.source === "schatting" ? ` <span class="assumed">~geschat op categorie</span>` : "";
      li.innerHTML = `
        <div class="rank-medal">${medal}</div>
        <div>
          <div class="result-name">${icon} ${esc(item.displayName)}${matched}</div>
          <div class="result-detail">${volTxt} · ${item.abv.toFixed(1)}% vol · €${item.price.toFixed(2)}${srcTxt}</div>
        </div>
        <div class="result-score">${item.score.toFixed(1)}<small>ml alcohol / €</small></div>`;
      resultsList.appendChild(li);
    });

    // voetnoot bij aangenomen volumes
    if (currentItems.some(i => i.volAssumed)) {
      const note = document.createElement("p");
      note.className = "hint";
      note.innerHTML = "* volume stond niet op de kaart — standaard serveerglas aangenomen";
      resultsList.appendChild(note);
    }

    // niet-herkende regels met snelle invulknop
    unmatchedList.innerHTML = "";
    unmatchedWrap.classList.toggle("hidden", currentUnmatched.length === 0);
    currentUnmatched.forEach((u, idx) => {
      const li = document.createElement("li");
      li.textContent = `${u.displayName} — €${u.price.toFixed(2)}`;
      const btn = document.createElement("button");
      btn.textContent = "vul % in";
      btn.addEventListener("click", () => {
        const abv = parseFloat((prompt(`Alcoholpercentage van "${u.displayName}"?`) || "").replace(",", "."));
        if (isNaN(abv) || abv <= 0 || abv > 96) return;
        let volMl = u.volMl;
        if (!volMl) {
          const volCl = parseFloat((prompt("Volume in cl? (bv. 33)") || "").replace(",", "."));
          if (isNaN(volCl) || volCl <= 0) return;
          volMl = volCl * 10;
        }
        currentItems.push({
          displayName: u.displayName, matchedName: null, cat: "?",
          abv, volMl, volAssumed: false, price: u.price,
          score: AlceuriParser.alceuriScore(volMl, abv, u.price), source: "handmatig",
        });
        currentUnmatched.splice(idx, 1);
        currentItems.sort((a, b) => b.score - a.score);
        render();
      });
      li.appendChild(btn);
      unmatchedList.appendChild(li);
    });
  }

  function esc(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  // ── gedeelde database (Google Sheet + Apps Script, zie backend/Code.gs) ──
  const cafeNameInput = document.getElementById("cafe-name");
  const cafeCityInput = document.getElementById("cafe-city");
  const shareBtn = document.getElementById("share-btn");
  const shareStatus = document.getElementById("share-status");
  const communityList = document.getElementById("community-list");
  const communityStatus = document.getElementById("community-status");
  const citySearchInput = document.getElementById("city-search");

  function apiUrl() {
    return (globalThis.ALCEURI_CONFIG || {}).API_URL || "";
  }

  // GET met queryparameters, of POST met een JSON-body. De body gaat als
  // text/plain mee: zo is het een "simple request" zonder CORS-preflight,
  // wat Apps Script niet ondersteunt.
  async function api(params, body) {
    const url = apiUrl() + "?" + new URLSearchParams(params);
    const res = await fetch(url, body === undefined ? {} : {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error("database-fout " + res.status);
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data;
  }

  // GPS is altijd optioneel: eerst expliciet vragen, weigeren is prima
  function askPosition(reason) {
    if (!navigator.geolocation) return Promise.resolve(null);
    if (!confirm(reason)) return Promise.resolve(null);
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude }),
        () => resolve(null),
        { timeout: 8000, maximumAge: 300000 }
      );
    });
  }

  function haversineKm(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function notConfigured() {
    if (apiUrl()) return false;
    communityStatus.textContent = "⚙️ De gedeelde database is nog niet verbonden (vul js/config.js in).";
    return true;
  }

  // ── scan delen ─────────────────────────────────────────────────
  shareBtn.addEventListener("click", async () => {
    const name = cafeNameInput.value.trim();
    const city = cafeCityInput.value.trim();
    shareStatus.classList.remove("hidden");
    if (!apiUrl()) { shareStatus.textContent = "⚙️ Database nog niet verbonden (js/config.js)."; return; }
    if (!currentItems.length) { shareStatus.textContent = "Scan eerst een kaart — er valt nog niets te delen!"; return; }
    if (!name) { shareStatus.textContent = "Vul de naam van het café in."; cafeNameInput.focus(); return; }
    if (!city) { shareStatus.textContent = "Vul de stad in — zo kan iedereen dit café terugvinden."; cafeCityInput.focus(); return; }

    const pos = await askPosition(
      "Wil je je GPS-locatie aan deze scan koppelen?\n\n" +
      "Zo kunnen anderen dit café vinden met \"in de buurt\".\n" +
      "Kies \"Annuleer\" om zonder locatie te delen (stad volstaat)."
    );

    shareBtn.disabled = true;
    shareStatus.textContent = "🌍 Versturen...";
    try {
      await api({}, {
        cafe_name: name,
        city,
        lat: pos ? pos.lat : null,
        lon: pos ? pos.lon : null,
        items: currentItems,
      });
      shareStatus.textContent = `✅ "${name}" (${city}) gedeeld met de wereld${pos ? " mét locatie" : ""}! 🎉`;
      cafeNameInput.value = "";
      loadTop(); // community-lijst meteen verversen
    } catch (err) {
      shareStatus.textContent = "⚠️ Delen mislukt (" + err.message + ") — probeer straks opnieuw.";
    }
    shareBtn.disabled = false;
  });

  // ── community doorzoeken ───────────────────────────────────────
  // filteren, ontdubbelen per café en sorteren gebeurt in backend/Code.gs
  function renderCommunity(scans, userPos, emptyMsg) {
    communityList.innerHTML = "";
    communityStatus.textContent = scans.length ? "" : emptyMsg;
    scans.forEach((scan, i) => {
      const li = document.createElement("li");
      li.className = "cafe-item" + (i === 0 ? " best-nearby" : "");
      const best = scan.items[0];
      const dist = (userPos && scan.lat != null)
        ? haversineKm(userPos, scan) : null;
      const distTxt = dist != null
        ? `<span class="cafe-dist">📍 ${dist < 1 ? Math.round(dist * 1000) + " m" : dist.toFixed(1) + " km"}</span> · ` : "";
      li.innerHTML = `
        <div>
          <div class="cafe-name">${i === 0 ? "👑 " : ""}${esc(scan.cafe_name)} <span class="cafe-city">(${esc(scan.city)})</span></div>
          <div class="cafe-detail">${distTxt}🏆 <b>${scan.best_score.toFixed(1)} ml/€</b>
            (${esc(best.matchedName || best.displayName)}) · ${scan.items.length} ${scan.items.length === 1 ? "drank" : "dranken"} · ${scan.created_at.slice(0, 10)}</div>
        </div>
        <div class="cafe-actions"></div>`;
      const openBtn = document.createElement("button");
      openBtn.textContent = "📂 open";
      openBtn.addEventListener("click", () => {
        currentItems = scan.items.slice();
        currentUnmatched = [];
        render();
        panelResults.scrollIntoView({ behavior: "smooth" });
      });
      li.querySelector(".cafe-actions").appendChild(openBtn);
      communityList.appendChild(li);
    });
  }

  async function searchCity() {
    if (notConfigured()) return;
    const q = citySearchInput.value.trim();
    if (!q) { citySearchInput.focus(); return; }
    communityStatus.textContent = "🔎 Zoeken in " + q + "...";
    try {
      const { scans } = await api({ mode: "city", q });
      renderCommunity(scans, null, `Nog geen scans in "${q}" — wees de eerste! 🚀`);
    } catch (err) {
      communityStatus.textContent = "⚠️ Zoeken mislukt (" + err.message + ").";
    }
  }

  document.getElementById("city-search-btn").addEventListener("click", searchCity);
  citySearchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") searchCity(); });

  document.getElementById("nearby-btn").addEventListener("click", async () => {
    if (notConfigured()) return;
    const pos = await askPosition("Mag Alceuri je locatie gebruiken om cafés in je buurt te vinden?");
    if (!pos) {
      communityStatus.textContent = "Geen locatie — zoek dan op stad hierboven. 🏙";
      return;
    }
    communityStatus.textContent = "📍 Cafés in de buurt zoeken...";
    try {
      const { scans } = await api({ mode: "nearby", lat: pos.lat, lon: pos.lon });
      renderCommunity(scans, pos, "Nog geen scans met locatie in de database.");
    } catch (err) {
      communityStatus.textContent = "⚠️ Zoeken mislukt (" + err.message + ").";
    }
  });

  async function loadTop() {
    if (notConfigured()) return;
    communityStatus.textContent = "🏆 Wereldtop laden...";
    try {
      const { scans } = await api({ mode: "top" });
      renderCommunity(scans, null, "Nog geen scans in de database — wees de allereerste! 🚀");
    } catch (err) {
      communityStatus.textContent = "⚠️ Laden mislukt (" + err.message + ").";
    }
  }
  document.getElementById("top-btn").addEventListener("click", loadTop);

  // bij het openen meteen de wereldtop tonen (als er verbinding is)
  loadTop();

  // ── events ─────────────────────────────────────────────────────
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (previewImg.src.startsWith("blob:")) URL.revokeObjectURL(previewImg.src);
    scanImage(URL.createObjectURL(file));
    fileInput.value = ""; // zelfde foto opnieuw kiezen moet ook werken
  });

  // demo: een typische Vlaamse cafékaart als tekst, zodat je zonder foto kan testen
  demoBtn.addEventListener("click", () => {
    const demo = [
      "BIEREN VAN 'T VAT",
      "Jupiler 25cl ............ € 2,80",
      "Stella Artois 25cl ...... € 2,90",
      "Hoegaarden 25cl ......... € 3,20",
      "FLESBIEREN",
      "Duvel 33cl .............. € 4,50",
      "Westmalle Tripel 33cl ... € 4,80",
      "Tripel Karmeliet 33cl ... € 4,70",
      "Orval ................... € 5,00",
      "Rochefort 10 ............ € 5,50",
      "Kriek Lindemans 25cl .... € 3,50",
      "WIJNEN",
      "Glas witte wijn 15cl .... € 4,00",
      "Glas rode wijn 15cl ..... € 4,00",
      "Cava .................... € 5,50",
      "STERKE DRANK & COCKTAILS",
      "Gin-tonic ............... € 9,00",
      "Aperol Spritz ........... € 8,50",
      "Mojito .................. € 9,50",
      "Jenever ................. € 3,00",
      "Whisky 4cl .............. € 6,50",
      "FRISDRANK",
      "Cola .................... € 2,60",
      "Spa bruis ............... € 2,40",
      "Koffie .................. € 2,80",
    ].join("\n");
    previewWrap.classList.add("hidden");
    handleOcrText(demo);
  });

  // handmatig toevoegen
  manualForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const name = document.getElementById("m-name").value.trim();
    const volCl = parseFloat(document.getElementById("m-vol").value);
    const abvIn = parseFloat(document.getElementById("m-abv").value);
    const price = parseFloat(document.getElementById("m-price").value);
    if (!name || !price) return;

    // alcoholpercentage: ingevuld > database > categorie-schatting
    let abv = abvIn, volMl = volCl ? volCl * 10 : null, cat = "?", matchedName = null, source = "handmatig";
    const match = AlceuriParser.matchDrink(name);
    if (match) {
      matchedName = match.drink.name;
      cat = match.drink.cat;
      if (isNaN(abv)) { abv = match.drink.abv; source = "database"; }
      if (!volMl) volMl = match.drink.vol;
    }
    if (isNaN(abv)) {
      alert(`"${name}" niet gevonden in de database — vul het alcoholpercentage zelf in!`);
      return;
    }
    if (!volMl) volMl = 250;

    currentItems.push({
      displayName: name, matchedName, cat, abv,
      volMl, volAssumed: !volCl && !match, price,
      score: AlceuriParser.alceuriScore(volMl, abv, price), source,
    });
    currentItems.sort((a, b) => b.score - a.score);
    manualForm.reset();
    render();
  });
})();
