# 🍺 Alceuri

De meeste alcohol voor de minste euro's. Scan een drankenkaart, en Alceuri rangschikt alle alcoholische dranken op **ml pure alcohol per euro**.

## 100% gratis

- Geen server, geen API-kosten, geen account: een pure statische webapp.
- OCR via [Tesseract.js](https://tesseract.projectnaptha.com/) — draait volledig in de browser (taalbestanden worden bij de eerste scan eenmalig van een gratis CDN gehaald).
- Ingebouwde drankendatabase (Belgisch/Vlaams cafégericht) met alcoholpercentages en standaard serveervolumes in `js/drinks-db.js`.

## Lokaal draaien

Open `index.html` rechtstreeks, of serveer de map:

```sh
python3 -m http.server 8723 --directory alceuri
# → http://localhost:8723
```

Gratis hosten kan op GitHub Pages of Netlify (statische site).

## Hoe het werkt

1. **Foto** van de drankenkaart (camera of galerij) → grijswaarden + contrastverhoging voor betere OCR.
2. **Tesseract.js** (Nederlands + Engels) leest de tekst.
3. **Parser** (`js/parser.js`) haalt per regel naam, volume (cl/ml/l) en prijs (€) eruit.
4. **Matching**: fuzzy match (Levenshtein + woordmatch) tegen de database; onbekende dranken krijgen een schatting op categorietrefwoord (tripel ≈ 8,5%, wijn ≈ 12,5%, …); frisdrank/koffie wordt uitgefilterd.
5. **Alceuri-score** = volume (ml) × alc.% / prijs = ml pure alcohol per euro. Hoogste eerst. 🥇

Staat een volume niet op de kaart, dan wordt het standaard serveerglas aangenomen (pils 25 cl, speciaalbier 33 cl, wijn 15 cl, sterke drank 4 cl, …) — aangeduid met `*`.

Niet-herkende regels verschijnen onderaan en kun je met één tik zelf een percentage geven; handmatig toevoegen kan ook.

## Gedeelde cafédatabase

Elke gescande kaart kun je delen met alle gebruikers: cafénaam + stad zijn verplicht, GPS is optioneel en wordt altijd eerst gevraagd. Zoeken kan op drie manieren: op stad (geen GPS nodig), op afstand ("in de buurt", vraagt eerst toestemming), of de wereldtop. Meerdere scans van hetzelfde café worden samengevoegd.

De data staat in een gewone **Google Sheet**, met een klein Apps Script (`backend/Code.gs`) als API ervoor. Dat is gratis, heeft geen kredietkaart nodig en — anders dan de gratis Supabase-tier — pauzeert het nooit bij inactiviteit, dus er is geen keep-alive nodig. Moderatie is gewoon een rij verwijderen in de spreadsheet.

### Eenmalig instellen (±5 minuten)

1. Maak een nieuwe Google Sheet aan (bv. "Alceuri database").
2. **Extensies → Apps Script**. Vervang de inhoud van `Code.gs` door die van `backend/Code.gs` en sla op.
3. Kies bovenaan de functie `setup` en klik **Uitvoeren**. Geef de gevraagde rechten (je eigen account). Het tabblad `scans` verschijnt.
4. **Implementeren → Nieuwe implementatie → Type: Web-app**
   - Uitvoeren als: **Ik**
   - Wie heeft toegang: **Iedereen**
5. Kopieer de web-app-URL (eindigt op `/exec`) naar `API_URL` in `js/config.js`.

Pas je `Code.gs` later aan, kies dan **Implementeren → Implementaties beheren → bewerken → Nieuwe versie**, zodat de URL dezelfde blijft.

De backend controleert alles wat binnenkomt (lengtes, getallen, scores worden zelf herberekend), ontdubbelt per café en remt af bij meer dan 20 scans per minuut. Zonder `API_URL` werkt de app gewoon, alleen zonder gedeelde cafés.

**Oude Supabase-data overzetten** (optioneel): exporteer de tabel `scans` als CSV in het Supabase-dashboard en plak de rijen in het tabblad `scans`, in de kolomvolgorde `id, created_at, cafe_name, city, lat, lon, best_score, items`.

## Tests

```sh
node --test tests/*.test.js
```

Drink met mate(n). 🍻
