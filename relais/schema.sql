-- Base D1 du relais NetScan : crédits d'analyses achetés et essais gratuits.
-- Appliquer : npx wrangler d1 execute netscan --remote --file relais/schema.sql --config relais/wrangler.toml

-- Un code NetScan (NS-XXXX-XXXX-XXXX-XXXX) = un porte-monnaie d'analyses.
CREATE TABLE IF NOT EXISTS credits (
  code TEXT PRIMARY KEY,
  restant INTEGER NOT NULL DEFAULT 0,
  achete INTEGER NOT NULL DEFAULT 0,
  cree_le TEXT NOT NULL
);

-- Un paiement Stripe ne crédite qu'une fois (webhook et retour du site peuvent arriver tous les deux).
CREATE TABLE IF NOT EXISTS paiements (
  session_id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  analyses INTEGER NOT NULL,
  montant INTEGER NOT NULL,
  paye_le TEXT NOT NULL
);

-- Essais gratuits par appareil (empreinte SHA-256 de l'adresse IP, jamais l'adresse elle-même).
CREATE TABLE IF NOT EXISTS essais (
  appareil TEXT PRIMARY KEY,
  utilises INTEGER NOT NULL DEFAULT 0
);
