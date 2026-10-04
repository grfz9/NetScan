// Cœur de l'analyse, partagé par les trois façons de lancer NetScan :
// - le serveur Node (server.js) et la version GitHub Pages : API Claude avec une clé (analyserAvec) ;
// - la version publiée sur claude.ai : le compte Claude de la personne, sans clé (analyserAvecCompteClaude).
import { SCHEMA_ANALYSE } from "./schema.js";

export const MAX_PHOTOS = 10;
export const MODELE_PAR_DEFAUT = "claude-opus-5-5";
export const EFFORT_PAR_DEFAUT = "medium";

export const SYSTEME = `Tu es NetScan, un assistant expert en réseaux informatiques (niveau BTS SIO SISR, Bac pro CIEL, CCNA) qui aide un étudiant.
L'étudiant t'envoie une ou plusieurs photos : un équipement réseau physique (switch, routeur, pare-feu, box, borne Wi-Fi, baie de brassage...), un écran (terminal CLI, Packet Tracer, GNS3, interface web d'administration) ou un schéma de topologie (dessiné ou imprimé). Il peut ajouter une consigne ou un contexte.
Plusieurs photos peuvent montrer le même équipement sous différents angles, ou la même installation en plusieurs morceaux : rassemble-les en une seule analyse et ne compte jamais deux fois le même équipement.

Ce que tu dois produire :
0. Qualité de l'image : commence par juger si les photos sont exploitables (netteté, lumière, reflets, distance, équipement coupé, câbles emmêlés qu'on ne peut pas suivre). Si un modèle, un numéro de port, une LED ou un câble est illisible à cause de la qualité, dis-le clairement dans qualite_image, baisse la confiance et ne devine pas. Si la qualité empêche de conclure, mets le niveau "insuffisante" et explique comment reprendre la photo.
1. Équipements : fais l'inventaire de TOUS les équipements réseau visibles ; pour une baie, parcours-la de haut en bas : panneaux de brassage, switchs, routeurs, pare-feu, serveurs... Un équipement non câblé ou visible en partie fait quand même partie de la liste (sans lien). Identifie la marque, le modèle et le type ; si le modèle n'est pas lisible, dis-le et donne ta meilleure hypothèse avec une confiance faible. Les multiprises, passe-câbles et panneaux à brosse ne sont pas des équipements : cite-les seulement dans le résumé si c'est utile.
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

const texteContexte = (contexte) =>
  contexte
    ? `Consigne / contexte donné par l'étudiant :\n${contexte}`
    : "Pas de consigne particulière : analyse ce que tu vois.";

function suivreProgression(onEtape) {
  let prochaine = 0;
  return (texte) => {
    while (prochaine < ETAPES_JSON.length && texte.includes(ETAPES_JSON[prochaine][0])) {
      onEtape(ETAPES_JSON[prochaine][1]);
      prochaine++;
    }
  };
}

export async function analyserAvec(
  client,
  { images, contexte, modele = MODELE_PAR_DEFAUT, effort = EFFORT_PAR_DEFAUT, onEtape = () => {} }
) {
  const contenu = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.media_type, data: img.data },
  }));
  contenu.push({ type: "text", text: texteContexte(contexte) });

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
  const progression = suivreProgression(onEtape);
  for await (const event of stream) {
    if (event.type === "content_block_start" && event.content_block.type === "thinking") {
      onEtape("reflexion");
    } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      texte += event.delta.text;
      progression(texte);
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
    return { resultat: normaliser(JSON.parse(json)), modele: message.model, usage: message.usage };
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

/* ---------- Version claude.ai : le compte Claude de la personne, sans clé API ---------- */

// `sample` = claude.use("sample") dans une page publiée sur claude.ai. Ici le format JSON
// n'est pas imposé par l'API : on donne le schéma dans la consigne et on vérifie la réponse.
export async function analyserAvecCompteClaude(sample, { images, contexte, onEtape = () => {} }) {
  const consigne = `${SYSTEME}

${texteContexte(contexte)}

${images.length} photo${images.length > 1 ? "s sont jointes" : " est jointe"}.
Réponds uniquement avec un objet JSON, sans aucun texte autour, qui respecte exactement ce schéma JSON (toutes les propriétés sont obligatoires) :
${JSON.stringify(SCHEMA_ANALYSE)}`;

  onEtape("reflexion");
  const progression = suivreProgression(onEtape);
  const reponse = await sample.json(consigne, {
    images,
    modelTier: "complex",
    onText: ({ text }) => progression(text),
  });
  return normaliser(reponse);
}

export function messageErreurCompteClaude(err) {
  const messages = {
    not_granted: "Tu as refusé que cette page utilise ton compte Claude. Recharge la page pour qu'elle te le redemande.",
    sampling_disabled: "Claude n'est pas disponible pour ce compte.",
    images_unavailable: "Cette version de l'appli Claude ne peut pas envoyer de photos. Essaie sur claude.ai dans un navigateur.",
    image_rejected: "Une des photos a été refusée (format ou taille). Essaie avec une autre photo.",
    rate_limited: "Limite d'utilisation de ton compte Claude atteinte. Réessaie un peu plus tard.",
    session_expired: "Ta session claude.ai a expiré : reconnecte-toi puis réessaie.",
    refused: "Claude a refusé d'analyser ces photos. Essaie avec d'autres photos.",
    invalid_json: "La réponse de Claude n'a pas pu être lue. Réessaie.",
    empty_completion: "Claude n'a rien répondu. Réessaie avec moins de photos.",
    prompt_too_large: "Trop de contenu d'un coup : enlève des photos ou raccourcis la consigne.",
  };
  return messages[err?.code] ?? "Erreur pendant l'analyse. Réessaie dans un instant.";
}

// Complète une réponse incomplète pour que l'affichage ne casse jamais.
export function normaliser(r) {
  const liste = (x) => (Array.isArray(x) ? x : []);
  const texte = (x) => (typeof x === "string" ? x : "");
  const objet = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
  r = objet(r);
  const diagnostic = objet(r.diagnostic);
  const configuration = objet(r.configuration);
  const qualite = objet(r.qualite_image);
  return {
    ...r,
    type_image: texte(r.type_image) || "equipement_physique",
    titre: texte(r.titre) || "Analyse",
    resume: texte(r.resume),
    qualite_image: {
      niveau: texte(qualite.niveau) || "bonne",
      problemes: liste(qualite.problemes),
      detail: texte(qualite.detail),
      conseil: texte(qualite.conseil),
    },
    equipements: liste(r.equipements)
      .filter((e) => e && texte(e.id))
      .map((e) => ({ ...e, nom: texte(e.nom) || e.id, type: texte(e.type) || "inconnu", ports: liste(e.ports).filter((p) => p && texte(p.nom)) })),
    liens: liste(r.liens).filter((l) => l && texte(l.de) && texte(l.vers)),
    configuration: { ...configuration, source: texte(configuration.source) || "aucune", systeme: texte(configuration.systeme), blocs: liste(configuration.blocs).filter((b) => b && texte(b.commandes)) },
    diagnostic: {
      ...diagnostic,
      statut: texte(diagnostic.statut) || "indeterminable",
      resume: texte(diagnostic.resume),
      problemes: liste(diagnostic.problemes).map((p) => ({ ...p, concerne: liste(p?.concerne) })),
      verifications: liste(diagnostic.verifications),
    },
    etapes: liste(r.etapes),
    limites: texte(r.limites),
  };
}
