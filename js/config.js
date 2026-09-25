// Verbinding met de gedeelde Alceuri-database (Google Sheet + Apps Script, gratis).
// Invullen na het publiceren van backend/Code.gs als webapp (zie README.md):
// de URL eindigt op /exec. Leeg laten = app werkt, maar zonder gedeelde cafés.
const ALCEURI_CONFIG = {
  API_URL: "https://script.google.com/macros/s/AKfycby2faghNMxdiuzV8ulN2k6KPQ6FC6j_lTxxUZJ2XYtSCKEUl4kcrEKTdqNu4yPiFcxM/exec",
};
globalThis.ALCEURI_CONFIG = ALCEURI_CONFIG;
