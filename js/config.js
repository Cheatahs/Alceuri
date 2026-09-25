// Verbinding met de gedeelde Alceuri-database (Google Sheet + Apps Script, gratis).
// Invullen na het publiceren van backend/Code.gs als webapp (zie README.md):
// de URL eindigt op /exec. Leeg laten = app werkt, maar zonder gedeelde cafés.
const ALCEURI_CONFIG = {
  API_URL: "",
};
globalThis.ALCEURI_CONFIG = ALCEURI_CONFIG;
