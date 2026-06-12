// Verbinding met de gedeelde Alceuri-database (Supabase, gratis tier).
// Invullen na het aanmaken van je project: Supabase dashboard → Settings → API.
// De anon-sleutel is bedoeld om publiek in de frontend te staan; de
// Row Level Security-regels op de tabel bepalen wat ermee kan (alleen lezen + toevoegen).
const ALCEURI_CONFIG = {
  SUPABASE_URL: "https://viekhrxhyyzytywfsywk.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZpZWtocnhoeXl6eXR5d2ZzeXdrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMzc2OTIsImV4cCI6MjA5NjgxMzY5Mn0.JD3XcmEinOcx_Y13aM8xIZRScNoKAs5DdJdDYTlWhp8",
};
globalThis.ALCEURI_CONFIG = ALCEURI_CONFIG;
