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

De data staat in een gratis [Supabase](https://supabase.com)-project (Postgres + REST API, geen kredietkaart nodig). Verbinden: vul `js/config.js` in met je Project URL en anon-sleutel. De anon-sleutel mag publiek zijn; Row Level Security op de tabel staat alleen lezen en toevoegen toe — wijzigen of verwijderen kan enkel via je eigen dashboard. De GitHub Action in `.github/workflows/keepalive.yml` pingt de database om de drie dagen zodat het gratis project niet pauzeert (vul daar dezelfde twee waarden in).

Drink met mate(n). 🍻
