// Crédits d'analyses (base D1 « DB ») : codes NetScan, paiements et essais gratuits.

// Sans lettres ambiguës (0/O, 1/I/L) : un code se recopie facilement d'un appareil à l'autre.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const FORMAT_CODE = /^NS(-[A-Z0-9]{4}){4}$/;

export function nouveauCode() {
  const octets = crypto.getRandomValues(new Uint8Array(16));
  const lettres = [...octets].map((o) => ALPHABET[o % ALPHABET.length]).join("");
  return `NS-${lettres.match(/.{4}/g).join("-")}`;
}

export const codeBienForme = (code) => typeof code === "string" && FORMAT_CODE.test(code.trim().toUpperCase());
export const normaliserCode = (code) => code.trim().toUpperCase();

export async function solde(env, code) {
  return env.DB.prepare("SELECT restant, achete FROM credits WHERE code = ?").bind(code).first();
}

// Un paiement ne crédite qu'une fois, même si le webhook et le retour du site arrivent tous les deux.
export async function crediter(env, { sessionId, code, analyses, montant }) {
  const maintenant = new Date().toISOString();
  const paiement = await env.DB.prepare(
    "INSERT INTO paiements (session_id, code, analyses, montant, paye_le) VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING"
  )
    .bind(sessionId, code, analyses, montant, maintenant)
    .run();
  if (paiement.meta.changes === 1) {
    await env.DB.prepare(
      `INSERT INTO credits (code, restant, achete, cree_le) VALUES (?, ?, ?, ?)
       ON CONFLICT (code) DO UPDATE SET restant = restant + excluded.restant, achete = achete + excluded.achete`
    )
      .bind(code, analyses, analyses, maintenant)
      .run();
  }
  return solde(env, code);
}

// Retire une analyse après un résultat réussi ; rien n'est retiré si l'analyse échoue.
export async function debiter(env, code) {
  await env.DB.prepare("UPDATE credits SET restant = restant - 1 WHERE code = ? AND restant > 0").bind(code).run();
}

export async function empreinteAppareil(ip, sel) {
  const octets = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${sel}:${ip}`));
  return [...new Uint8Array(octets)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function essaisUtilises(env, appareil) {
  const ligne = await env.DB.prepare("SELECT utilises FROM essais WHERE appareil = ?").bind(appareil).first();
  return ligne?.utilises ?? 0;
}

export async function utiliserEssai(env, appareil) {
  await env.DB.prepare(
    "INSERT INTO essais (appareil, utilises) VALUES (?, 1) ON CONFLICT (appareil) DO UPDATE SET utilises = utilises + 1"
  )
    .bind(appareil)
    .run();
}
