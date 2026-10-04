// Relais NetScan (Cloudflare Worker) : garde la clé API secrète et la prête aux personnes
// qui ont le code d'accès. Les secrets ANTHROPIC_API_KEY et CODE_ACCES sont définis avec
// `wrangler secret put` et ne sont jamais dans le code ni sur GitHub.
import Anthropic from "@anthropic-ai/sdk";
import { analyserAvec, messageErreur, MAX_PHOTOS, MODELE_PAR_DEFAUT, EFFORT_PAR_DEFAUT } from "../public/coeur.js";

const ORIGINES = ["https://grfz9.github.io", "http://localhost:3000"];
const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

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
    if (request.method !== "POST" || !["/verifier", "/analyse"].includes(pathname)) {
      return repondre({ erreur: "Adresse inconnue." }, 404);
    }

    // Limite par appareil : freine aussi ceux qui essaieraient de deviner le code.
    const ip = request.headers.get("CF-Connecting-IP") ?? "inconnu";
    const { success } = await env.LIMITE.limit({ key: ip });
    if (!success) return repondre({ erreur: "Trop de demandes d'affilée. Attends une minute et réessaie." }, 429);

    const corps = await request.json().catch(() => null);
    if (!corps) return repondre({ erreur: "Requête illisible." }, 400);
    if (!env.CODE_ACCES || !(await codeValide(corps.code, env.CODE_ACCES))) {
      return repondre({ erreur: "Code d'accès incorrect." }, 401);
    }
    if (pathname === "/verifier") return repondre({ ok: true });

    const { images, contexte = "", materiel = [] } = corps;
    if (!Array.isArray(images) || images.length > MAX_PHOTOS) {
      return repondre({ erreur: `Envoie au maximum ${MAX_PHOTOS} photos.` }, 400);
    }
    if (images.some((img) => !TYPES_IMAGE.includes(img?.media_type) || typeof img?.data !== "string" || !img.data)) {
      return repondre({ erreur: "Format d'image non pris en charge (JPEG, PNG, WebP ou GIF)." }, 400);
    }
    if (!images.length && !String(contexte).trim()) {
      return repondre({ erreur: "Ajoute une photo ou une description." }, 400);
    }

    // Même format que le serveur Node : une ligne JSON par événement ({etape}, puis {resultat} ou {erreur}).
    const { readable, writable } = new TransformStream();
    const ecrivain = writable.getWriter();
    const encodeur = new TextEncoder();
    const envoyer = (objet) => ecrivain.write(encodeur.encode(JSON.stringify(objet) + "\n"));

    ctx.waitUntil(
      (async () => {
        try {
          const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
          const { resultat, modele } = await analyserAvec(client, {
            images,
            contexte: String(contexte).slice(0, 2000),
            materiel,
            modele: env.NETSCAN_MODEL || MODELE_PAR_DEFAUT,
            effort: env.NETSCAN_EFFORT || EFFORT_PAR_DEFAUT,
            onEtape: (etape) => envoyer({ etape }),
          });
          await envoyer({ resultat, modele });
        } catch (err) {
          console.error(err);
          // Les problèmes de clé ou de crédit concernent le propriétaire du relais, pas l'utilisateur.
          const message =
            err instanceof Anthropic.AuthenticationError ||
            (err instanceof Anthropic.BadRequestError && /credit balance/i.test(err.message))
              ? "La clé partagée de NetScan ne fonctionne plus (clé invalide ou crédit épuisé). Préviens la personne qui t'a donné le code."
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
  },
};

// Comparaison à temps constant, pour ne rien révéler du code par la durée de la réponse.
async function codeValide(saisi, attendu) {
  const encodeur = new TextEncoder();
  const [a, b] = await Promise.all(
    [String(saisi ?? "").trim(), attendu.trim()].map((t) => crypto.subtle.digest("SHA-256", encodeur.encode(t)))
  );
  return crypto.subtle.timingSafeEqual(a, b);
}
