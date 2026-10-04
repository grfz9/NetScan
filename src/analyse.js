import Anthropic from "@anthropic-ai/sdk";
import { SCHEMA_ANALYSE } from "./schema.js";

// Lu à l'appel (et pas à l'import) pour que le fichier .env soit déjà chargé.
export const modele = () => process.env.NETSCAN_MODEL || "claude-opus-5-5";
const effort = () => process.env.NETSCAN_EFFORT || "medium";

const SYSTEME = `Tu es NetScan, un assistant expert en réseaux informatiques (niveau BTS SIO SISR, Bac pro CIEL, CCNA) qui aide un étudiant.
L'étudiant t'envoie une ou plusieurs photos : un équipement réseau physique (switch, routeur, pare-feu, box, borne Wi-Fi, baie de brassage...), un écran (terminal CLI, Packet Tracer, GNS3, interface web d'administration) ou un schéma de topologie (dessiné ou imprimé). Il peut ajouter une consigne ou un contexte.

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

let client;

// Repère dans quel champ du JSON Claude est en train d'écrire, pour afficher la progression.
const ETAPES_JSON = [
  ['"equipements"', "equipements"],
  ['"liens"', "schema"],
  ['"configuration"', "configuration"],
  ['"diagnostic"', "diagnostic"],
  ['"etapes"', "etapes"],
];

export async function analyser({ images, contexte, onEtape = () => {} }) {
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

  client ??= new Anthropic();
  const stream = client.beta.messages.stream({
    model: modele(),
    max_tokens: 64000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: {
      effort: effort(),
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

export class ErreurAnalyse extends Error {}
