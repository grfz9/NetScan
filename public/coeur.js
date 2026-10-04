// Cœur de l'analyse, partagé par le serveur Node (server.js) et par le navigateur
// (version GitHub Pages, sans serveur). Il reçoit un client du SDK Anthropic déjà créé.
import { SCHEMA_ANALYSE } from "./schema.js";

export const MAX_PHOTOS = 10;
export const MODELE_PAR_DEFAUT = "claude-opus-5-5";
export const EFFORT_PAR_DEFAUT = "medium";

export const SYSTEME = `Tu es NetScan, un assistant expert en réseaux informatiques (niveau BTS SIO SISR, Bac pro CIEL, CCNA) qui aide un étudiant.
L'étudiant t'envoie une ou plusieurs photos : un équipement réseau physique (switch, routeur, pare-feu, box, borne Wi-Fi, baie de brassage...), un écran (terminal CLI, Packet Tracer, GNS3, interface web d'administration) ou un schéma de topologie (dessiné ou imprimé). Il peut ajouter une consigne ou un contexte.
Plusieurs photos peuvent montrer le même équipement sous différents angles, ou la même installation en plusieurs morceaux : rassemble-les en une seule analyse et ne compte jamais deux fois le même équipement.

Ce que tu dois produire :
1. Équipements : identifie chaque équipement visible (marque, modèle, type). Si le modèle n'est pas lisible, dis-le et donne ta meilleure hypothèse avec une confiance faible.
2. Ports : liste uniquement les ports visibles sur l'image ou connus de façon fiable pour ce modèle, avec la source de l'info. Utilise les noms courts de l'OS (Gi0/1, Fa0/24, Se0/0/0...). Indique si un câble est branché quand on le voit. Pour un PC ou un serveur, un seul port réseau suffit (NIC, Eth0...).
3. Liens : les câbles et liaisons entre équipements, avec le port à chaque extrémité quand il est connu. Si un câble part hors de l'image, relie-le à un équipement de type "inconnu". Ajoute en certitude "propose" les liens qui manquent pour que le réseau fonctionne.
4. Configuration : si une configuration est lisible (écran, capture), retranscris-la fidèlement, sans rien inventer de ce qui est illisible. Sinon, propose une configuration de base cohérente avec le schéma et la consigne, en utilisant des adresses d'exemple privées et en le disant dans l'explication. Découpe en blocs courts et pédagogiques.
5. Diagnostic : la situation observée fonctionne-t-elle telle quelle ? Cherche ce qui manque ou est faux : câble absent ou du mauvais type, interface en shutdown, adresse IP ou masque absent ou incohérent, sous-réseaux qui se chevauchent, passerelle manquante, VLAN non créé ou port mal assigné, trunk manquant, routage absent, DHCP, NAT, ACL, sécurité de base (mots de passe, SSH). Pour chaque problème donne la correction exacte.
   - "fonctionnel" seulement si tu as assez d'éléments pour l'affirmer.
   - "indeterminable" si la photo ne montre que du matériel sans configuration ni consigne : explique alors ce qu'il faudrait pour conclure.
6. Vérifications : les commandes à taper pour prouver que ça marche (show ip interface brief, show vlan brief, ping, ipconfig...).
7. Étapes : explique ton raisonnement étape par étape, comme Photomath : ce que tu observes, puis ce que tu en déduis.

Règles :
- Honnêteté avant tout : distingue toujours ce qui est observé, déduit ou proposé. N'invente jamais un port, une étiquette ou une ligne de configuration illisible.
- Les "id" utilisés dans liens, blocs, problèmes et vérifications doivent correspondre exactement aux "id" des équipements.
- Réponds en français, avec des phrases simples d'enseignant bienveillant.
- Si l'image ne montre rien de lié au réseau, mets type_image à "hors_sujet", laisse les listes vides et explique dans le résumé.`;

// Repère dans quel champ du JSON Claude est en train d'écrire, pour afficher la progression.
const ETAPES_JSON = [
  ['"equipements"', "equipements"],
  ['"liens"', "schema"],
  ['"configuration"', "configuration"],
  ['"diagnostic"', "diagnostic"],
  ['"etapes"', "etapes"],
];

export class ErreurAnalyse extends Error {}

export async function analyserAvec(
  client,
  { images, contexte, modele = MODELE_PAR_DEFAUT, effort = EFFORT_PAR_DEFAUT, onEtape = () => {} }
) {
  const contenu = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.media_type, data: img.data },
  }));
  contenu.push({
    type: "text",
    text: contexte
      ? `Consigne / contexte donné par l'étudiant :\n${contexte}`
      : "Pas de consigne particulière : analyse ce que tu vois.",
  });

  const stream = client.beta.messages.stream({
    model: modele,
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort,
      format: { type: "json_schema", schema: SCHEMA_ANALYSE },
    },
    system: SYSTEME,
    messages: [{ role: "user", content: contenu }],
  });

  let texte = "";
  let prochaine = 0;
  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "thinking") {
      onEtape("reflexion");
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      texte += event.delta.text;
      while (prochaine < ETAPES_JSON.length && texte.includes(ETAPES_JSON[prochaine][0])) {
        onEtape(ETAPES_JSON[prochaine][1]);
        prochaine++;
      }
    }
  }

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new ErreurAnalyse("Claude a refusé d'analyser cette image. Essaie avec une autre photo.");
  }
  if (message.stop_reason === "max_tokens") {
    throw new ErreurAnalyse("La réponse a été coupée car elle était trop longue. Essaie avec moins de photos.");
  }

  const json = message.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");
  try {
    return { resultat: JSON.parse(json), modele: message.model, usage: message.usage };
  } catch {
    throw new ErreurAnalyse("La réponse de Claude n'était pas un JSON valide. Réessaie.");
  }
}

// Traduit une erreur du SDK en message compréhensible. `Anthropic` = la classe du SDK utilisée.
export function messageErreur(err, Anthropic) {
  if (err instanceof ErreurAnalyse) return err.message;
  if (err instanceof Anthropic.AuthenticationError) {
    return "Clé API invalide. Vérifie la clé dans les Réglages (ou ANTHROPIC_API_KEY dans .env).";
  }
  if (err instanceof Anthropic.PermissionDeniedError) {
    return "Cette clé API n'a pas accès au modèle demandé.";
  }
  if (err instanceof Anthropic.RateLimitError) {
    return "Trop de demandes d'un coup. Attends quelques secondes et réessaie.";
  }
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) {
      return "Plus de crédit sur ton compte Anthropic : recharge-le sur console.anthropic.com.";
    }
    return `Requête refusée par l'API : ${err.message}`;
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return "Impossible de joindre l'API Claude. Vérifie ta connexion Internet.";
  }
  if (err instanceof Anthropic.APIError) {
    return `Erreur de l'API Claude (${err.status ?? "?"}). Réessaie dans un instant.`;
  }
  if (/api.?key|credential|auth/i.test(String(err?.message))) {
    return "Aucune clé API trouvée. Ajoute ta clé dans les Réglages de l'appli.";
  }
  return "Erreur inattendue pendant l'analyse.";
}
