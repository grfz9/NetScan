// Relais NetScan (Cloudflare Worker) : garde la clé API secrète et la prête
// - aux personnes qui ont le code d'accès (CODE_ACCES),
// - aux personnes qui ont acheté un pack d'analyses (code NetScan NS-…, payé avec Stripe),
// - pour quelques essais gratuits par appareil.
// Les secrets (ANTHROPIC_API_KEY, CODE_ACCES, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET) sont
// définis avec `wrangler secret put` et ne sont jamais dans le code ni sur GitHub.
import Anthropic from "@anthropic-ai/sdk";
import { analyserAvec, messageErreur, MAX_PHOTOS, MODELE_PAR_DEFAUT, EFFORT_PAR_DEFAUT } from "../public/coeur.js";
import { stripe, signatureValide, ErreurPaiement } from "./stripe.js";
import {
  nouveauCode,
  codeBienForme,
  normaliserCode,
  solde,
  crediter,
  debiter,
  empreinteAppareil,
  essaisUtilises,
  utiliserEssai,
} from "./comptes.js";

const URL_APP = "https://grfz9.github.io/NetScan/";
const ORIGINES = ["https://grfz9.github.io", "http://localhost:3000"];
const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const ROUTES = ["/verifier", "/analyse", "/compte", "/achat", "/confirmer", "/stripe-webhook"];

class ErreurHttp extends Error {
  constructor(statut, message) {
    super(message);
    this.statut = statut;
  }
}

export default {
  async fetch(request, env, ctx) {
    const origine = request.headers.get("Origin") ?? "";
    const cors = {
      "Access-Control-Allow-Origin": ORIGINES.includes(origine) ? origine : ORIGINES[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const repondre = (objet, status = 200) =>
      new Response(JSON.stringify(objet), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const { pathname } = new URL(request.url);
    if (request.method !== "POST" || !ROUTES.includes(pathname)) {
      return repondre({ erreur: "Adresse inconnue." }, 404);
    }

    try {
      // Stripe signe ses messages : pas de limite par appareil ni de code ici.
      if (pathname === "/stripe-webhook") return repondre(await webhookStripe(request, env));

      // Limite par appareil sur ce qui coûte ou se devine (analyse, achat, code d'accès). Consulter son
      // solde n'y compte pas : un code NetScan (16 caractères aléatoires) ne se devine pas.
      const ip = request.headers.get("CF-Connecting-IP") ?? "inconnu";
      if (!["/compte", "/confirmer"].includes(pathname)) {
        const { success } = await env.LIMITE.limit({ key: ip });
        if (!success) throw new ErreurHttp(429, "Trop de demandes d'affilée. Attends une minute et réessaie.");
      }

      const corps = await request.json().catch(() => null);
      if (!corps) throw new ErreurHttp(400, "Requête illisible.");
      const appareil = await empreinteAppareil(ip, env.ANTHROPIC_API_KEY ?? "netscan");

      switch (pathname) {
        case "/verifier":
          if (!(await codeAccesValide(corps.code, env))) throw new ErreurHttp(401, "Code d'accès incorrect.");
          return repondre({ ok: true });
        case "/compte":
          return repondre(await etatCompte(env, corps.credit, appareil));
        case "/achat":
          return repondre(await creerAchat(env, corps, origine));
        case "/confirmer":
          return repondre(await confirmerAchat(env, corps.session_id));
        case "/analyse":
          return await analyser(request, env, ctx, corps, appareil, cors);
      }
    } catch (err) {
      if (err instanceof ErreurHttp) return repondre({ erreur: err.message }, err.statut);
      if (err instanceof ErreurPaiement) return repondre({ erreur: err.message }, 503);
      console.error(err);
      return repondre({ erreur: "Erreur inattendue du relais NetScan." }, 500);
    }
  },
};

const tarif = (env) => ({
  prix: Number(env.PRIX_CENTIMES) || 299,
  analyses: Number(env.ANALYSES_PAR_PACK) || 20,
  essais: Number(env.ESSAIS_GRATUITS) || 0,
});

/* ---------- Compte : solde d'un code NetScan et essais gratuits ---------- */

async function etatCompte(env, credit, appareil) {
  const { prix, analyses, essais } = tarif(env);
  const reponse = {
    pack: { prix, analyses },
    essais_restants: Math.max(0, essais - (await essaisUtilises(env, appareil))),
    paiement_actif: Boolean(env.STRIPE_SECRET_KEY),
  };
  if (credit !== undefined) {
    if (!codeBienForme(credit)) throw new ErreurHttp(400, "Ce code NetScan n'a pas le bon format (NS-XXXX-XXXX-XXXX-XXXX).");
    const ligne = await solde(env, normaliserCode(credit));
    if (!ligne) throw new ErreurHttp(404, "Code NetScan inconnu. Vérifie-le, ou attends quelques secondes après un paiement.");
    reponse.credit = { code: normaliserCode(credit), restant: ligne.restant, achete: ligne.achete };
  }
  return reponse;
}

/* ---------- Achat d'un pack avec Stripe Checkout ---------- */

async function creerAchat(env, corps, origine) {
  if (corps.accepte !== true) {
    throw new ErreurHttp(400, "Accepte les conditions de vente pour continuer.");
  }
  // Recharger un code existant, ou en créer un nouveau.
  let code = nouveauCode();
  if (corps.credit) {
    if (!codeBienForme(corps.credit) || !(await solde(env, normaliserCode(corps.credit)))) {
      throw new ErreurHttp(404, "Code NetScan inconnu : impossible de le recharger.");
    }
    code = normaliserCode(corps.credit);
  }
  const { prix, analyses } = tarif(env);
  const retour = origine === "http://localhost:3000" ? "http://localhost:3000/" : URL_APP;
  const session = await stripe(env, "POST", "/checkout/sessions", {
    mode: "payment",
    locale: "fr",
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: prix,
          product_data: { name: `NetScan : ${analyses} analyses`, description: "Analyses de photos d'équipements réseau, sans date limite." },
        },
      },
    ],
    // Le code apparaît sur le reçu Stripe : c'est ainsi qu'on le retrouve en cas de perte.
    payment_intent_data: { description: `NetScan : ${analyses} analyses, code ${code}` },
    metadata: { app: "netscan", credit: code, analyses, renonciation_retractation: "acceptee" },
    success_url: `${retour}?achat={CHECKOUT_SESSION_ID}`,
    cancel_url: `${retour}?achat=annule`,
  });
  return { url: session.url, credit: code };
}

// Au retour sur le site : on vérifie le paiement auprès de Stripe (sans attendre le webhook).
async function confirmerAchat(env, sessionId) {
  if (typeof sessionId !== "string" || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new ErreurHttp(400, "Paiement inconnu.");
  const session = await stripe(env, "GET", `/checkout/sessions/${sessionId}`);
  if (session.metadata?.app !== "netscan") throw new ErreurHttp(400, "Ce paiement ne concerne pas NetScan.");
  if (session.payment_status !== "paid") throw new ErreurHttp(402, "Le paiement n'est pas encore validé.");
  const ligne = await crediterSession(env, session);
  return { credit: { code: session.metadata.credit, restant: ligne.restant, achete: ligne.achete } };
}

async function webhookStripe(request, env) {
  const corps = await request.text();
  if (!(await signatureValide(corps, request.headers.get("Stripe-Signature"), env.STRIPE_WEBHOOK_SECRET?.trim()))) {
    throw new ErreurHttp(400, "Signature invalide.");
  }
  const evenement = JSON.parse(corps);
  const session = evenement.data?.object;
  // Le compte Stripe sert aussi à Podsal+ : on ignore tout ce qui ne vient pas de NetScan.
  if (evenement.type === "checkout.session.completed" && session?.metadata?.app === "netscan" && session.payment_status === "paid") {
    await crediterSession(env, session);
  }
  return { recu: true };
}

function crediterSession(env, session) {
  return crediter(env, {
    sessionId: session.id,
    code: session.metadata.credit,
    analyses: Number(session.metadata.analyses) || tarif(env).analyses,
    montant: session.amount_total ?? 0,
  });
}

/* ---------- Analyse ---------- */

async function codeAccesValide(saisi, env) {
  if (!env.CODE_ACCES || !saisi) return false;
  const encodeur = new TextEncoder();
  const [a, b] = await Promise.all(
    [String(saisi).trim(), env.CODE_ACCES.trim()].map((t) => crypto.subtle.digest("SHA-256", encodeur.encode(t)))
  );
  return crypto.subtle.timingSafeEqual(a, b);
}

// Qui paie cette analyse ? Code d'accès, sinon pack acheté, sinon essai gratuit.
async function payeur(env, corps, appareil) {
  if (corps.code) {
    if (await codeAccesValide(corps.code, env)) return { type: "acces", modele: env.NETSCAN_MODEL || MODELE_PAR_DEFAUT };
    throw new ErreurHttp(401, "Code d'accès incorrect.");
  }
  const modele = env.NETSCAN_MODEL_PAYANT || "claude-sonnet-5-5";
  if (corps.credit) {
    if (!codeBienForme(corps.credit)) throw new ErreurHttp(400, "Code NetScan mal formé.");
    const code = normaliserCode(corps.credit);
    const ligne = await solde(env, code);
    if (!ligne) throw new ErreurHttp(404, "Code NetScan inconnu.");
    if (ligne.restant < 1) throw new ErreurHttp(402, "Tu n'as plus d'analyses : recharge ton code NetScan dans Réglages.");
    return { type: "credit", code, modele };
  }
  if ((await essaisUtilises(env, appareil)) < tarif(env).essais) return { type: "essai", modele };
  throw new ErreurHttp(402, "Tes analyses gratuites sont utilisées : achète un pack dans Réglages pour continuer.");
}

async function analyser(request, env, ctx, corps, appareil, cors) {
  const { images, contexte = "", materiel = [] } = corps;
  if (!Array.isArray(images) || images.length > MAX_PHOTOS) throw new ErreurHttp(400, `Envoie au maximum ${MAX_PHOTOS} photos.`);
  if (images.some((img) => !TYPES_IMAGE.includes(img?.media_type) || typeof img?.data !== "string" || !img.data)) {
    throw new ErreurHttp(400, "Format d'image non pris en charge (JPEG, PNG, WebP ou GIF).");
  }
  if (!images.length && !String(contexte).trim()) throw new ErreurHttp(400, "Ajoute une photo ou une description.");
  const qui = await payeur(env, corps, appareil);

  // Même format que le serveur Node : une ligne JSON par événement ({etape}, puis {resultat} ou {erreur}).
  const { readable, writable } = new TransformStream();
  const ecrivain = writable.getWriter();
  const encodeur = new TextEncoder();
  const envoyer = (objet) => ecrivain.write(encodeur.encode(JSON.stringify(objet) + "\n"));

  ctx.waitUntil(
    (async () => {
      try {
        // ANTHROPIC_BASE_URL ne sert qu'aux tests locaux (faux serveur Claude) ; vide en production.
        const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
        const { resultat, modele } = await analyserAvec(client, {
          images,
          contexte: String(contexte).slice(0, 2000),
          materiel,
          modele: qui.modele,
          effort: env.NETSCAN_EFFORT || EFFORT_PAR_DEFAUT,
          onEtape: (etape) => envoyer({ etape }),
        });
        // L'analyse n'est décomptée qu'une fois réussie.
        let compte = { type: qui.type };
        if (qui.type === "credit") {
          await debiter(env, qui.code);
          compte = { ...compte, restant: (await solde(env, qui.code)).restant };
        } else if (qui.type === "essai") {
          await utiliserEssai(env, appareil);
          compte = { ...compte, essais_restants: Math.max(0, tarif(env).essais - (await essaisUtilises(env, appareil))) };
        }
        await envoyer({ resultat, modele, compte });
      } catch (err) {
        console.error(err);
        // Les problèmes de clé ou de crédit concernent le propriétaire du relais, pas l'utilisateur.
        const message =
          err instanceof Anthropic.AuthenticationError ||
          (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message))
            ? "Le service NetScan est momentanément indisponible. Ton analyse n'a pas été décomptée, réessaie plus tard."
            : messageErreur(err, Anthropic);
        await envoyer({ erreur: message });
      } finally {
        await ecrivain.close();
      }
    })()
  );

  return new Response(readable, {
    headers: { ...cors, "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
