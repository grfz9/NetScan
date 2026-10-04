// Appels à l'API Stripe sans bibliothèque (fetch + formulaire encodé) et vérification de la
// signature des webhooks : même méthode que Podsnew (supabase/functions/_shared/stripe*.ts).

const API = "https://api.stripe.com/v1";

/** { a: { b: 1 }, items: [{ price: "x" }] } → a[b]=1&items[0][price]=x */
export function encoderFormulaire(params, prefixe = "") {
  const parties = [];
  for (const [cle, valeur] of Object.entries(params)) {
    if (valeur === undefined || valeur === null) continue;
    const nom = prefixe ? `${prefixe}[${cle}]` : cle;
    if (Array.isArray(valeur)) {
      valeur.forEach((element, i) => parties.push(encoderFormulaire(element, `${nom}[${i}]`)));
    } else if (typeof valeur === "object") {
      parties.push(encoderFormulaire(valeur, nom));
    } else {
      parties.push(`${encodeURIComponent(nom)}=${encodeURIComponent(String(valeur))}`);
    }
  }
  return parties.filter(Boolean).join("&");
}

export class ErreurPaiement extends Error {}

export async function stripe(env, methode, chemin, params) {
  const cle = env.STRIPE_SECRET_KEY?.trim();
  if (!cle) throw new ErreurPaiement("Le paiement n'est pas encore activé.");
  const corps = params ? encoderFormulaire(params) : undefined;
  const reponse = await fetch(methode === "GET" && corps ? `${API}${chemin}?${corps}` : `${API}${chemin}`, {
    method: methode,
    headers: { Authorization: `Bearer ${cle}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: methode === "POST" ? corps : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const donnees = await reponse.json();
  if (!reponse.ok) {
    console.error("Erreur Stripe", reponse.status, donnees?.error?.message);
    throw new ErreurPaiement("Le service de paiement est indisponible. Réessaie dans un instant.");
  }
  return donnees;
}

const hex = (tampon) => [...new Uint8Array(tampon)].map((b) => b.toString(16).padStart(2, "0")).join("");

function egaliteSure(a, b) {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}

/** Vérifie l'en-tête « t=…,v1=… » : HMAC SHA-256 de « t.corps », tolérance de 5 minutes. */
export async function signatureValide(corps, entete, secret, maintenant = Date.now()) {
  if (!entete || !secret) return false;
  const champs = entete.split(",").map((p) => p.split("="));
  const horodatage = champs.find(([k]) => k === "t")?.[1];
  const signatures = champs.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!horodatage || !signatures.length) return false;
  if (Math.abs(maintenant / 1000 - Number(horodatage)) > 300) return false;
  const encodeur = new TextEncoder();
  const cle = await crypto.subtle.importKey("raw", encodeur.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const attendue = hex(await crypto.subtle.sign("HMAC", cle, encodeur.encode(`${horodatage}.${corps}`)));
  return signatures.some((s) => egaliteSure(s, attendue));
}
