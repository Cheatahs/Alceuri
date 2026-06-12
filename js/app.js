// Alceuri app: foto → OCR (Tesseract.js, in-browser) → parser → ranking
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

  // ── nep-bezoekersteller, uiteraard ─────────────────────────────
  const counter = document.getElementById("visitor-counter");
  const visits = (parseInt(localStorage.getItem("alceuri-visits") || "1336", 10) + 1);
  localStorage.setItem("alceuri-visits", String(visits));
  counter.textContent = String(visits).padStart(6, "0");

  // ── beeldvoorbewerking: grijswaarden + contrast, helpt Tesseract ──
  // invert=true voor kaarten met lichte tekst op donkere achtergrond
  function preprocessImage(img, invert) {
    const maxW = 1600;
    const scale = Math.min(1.6, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * Math.max(scale, 1));
    const h = Math.round(img.naturalHeight * Math.max(scale, 1));
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

  // ── OCR-flow ───────────────────────────────────────────────────
  async function scanImage(src) {
    previewImg.src = src;
    previewWrap.classList.remove("hidden");
    ocrStatus.classList.remove("hidden");
    setProgress("OCR-engine laden... (eerste keer duurt even)", 0.05);

    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
      img.src = src;
    });

    try {
      const worker = await Tesseract.createWorker(["nld", "eng"], 1, {
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
      await worker.terminate();

      setProgress("Dranken herkennen...", 1);
      handleOcrText(data.text);
    } catch (err) {
      console.error(err);
      statusText.textContent = "⚠️ Scannen mislukt: " + err.message + " — probeer een scherpere foto of voeg handmatig toe.";
      progressFill.style.width = "0%";
      return;
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

  // ── rendering ──────────────────────────────────────────────────
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

  // ── events ─────────────────────────────────────────────────────
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => scanImage(e.target.result);
    reader.readAsDataURL(file);
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
