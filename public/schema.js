// Schéma JSON imposé à la réponse de Claude (structured outputs).
// Règles de l'API : chaque objet a additionalProperties: false, pas de minimum/maxLength.

const obj = (properties) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const str = (description) => ({ type: "string", description });
const enumStr = (values, description) => ({ type: "string", enum: values, description });
const arr = (items, description) => ({ type: "array", items, description });

export const TYPES_EQUIPEMENT = [
  "routeur", "switch", "switch_l3", "pare_feu", "point_acces", "box_modem",
  "serveur", "pc", "imprimante", "telephone_ip", "cloud_internet",
  "panneau_brassage", "inconnu",
];

const port = obj({
  nom: str("Nom court de l'interface selon l'OS (Gi0/1, Fa0/24, Se0/0/0, Console, WAN, LAN1...)"),
  type: enumStr(
    ["ethernet", "sfp", "console", "serie", "usb", "wan", "alimentation", "autre"],
    "Type physique du port"
  ),
  etat: enumStr(["connecte", "libre", "inconnu"], "Câble branché, port libre, ou impossible à dire"),
  source: enumStr(
    ["visible", "fiche_technique", "config", "deduit"],
    "D'où vient l'info : vu sur la photo, connu pour ce modèle, lu dans une config, ou déduit"
  ),
  detail: str("Vitesse, LED, VLAN, adresse IP, mode access/trunk... Chaîne vide si rien"),
});

const equipement = obj({
  id: str("Identifiant court et unique utilisé dans les liens (R1, SW1, PC1, FW1...)"),
  nom: str("Nom lisible, ex: 'Routeur Cisco ISR 4321'"),
  type: enumStr(TYPES_EQUIPEMENT, "Catégorie de l'équipement"),
  marque: str("Marque ou chaîne vide"),
  modele: str("Modèle ou chaîne vide si illisible"),
  confiance: enumStr(["haute", "moyenne", "faible"], "Confiance dans l'identification"),
  role: str("Rôle dans le réseau, en une phrase"),
  ports: arr(port, "Ports visibles ou connus de façon fiable, dans l'ordre de la façade"),
});

const lien = obj({
  de: str("id de l'équipement de départ"),
  port_de: str("Port côté départ, ou chaîne vide si inconnu"),
  vers: str("id de l'équipement d'arrivée"),
  port_vers: str("Port côté arrivée, ou chaîne vide si inconnu"),
  cable: enumStr(
    ["droit", "croise", "fibre", "console", "serie", "wifi", "inconnu"],
    "Type de câble ou de liaison"
  ),
  certitude: enumStr(
    ["observe", "deduit", "propose"],
    "observe = vu sur l'image, deduit = logique mais pas vu, propose = à ajouter pour que ça marche"
  ),
  remarque: str("Précision utile ou chaîne vide"),
});

const blocConfig = obj({
  equipement: str("id de l'équipement concerné"),
  titre: str("Titre court du bloc (Interfaces, VLAN, Routage, DHCP, NAT, Sécurité...)"),
  commandes: str("Commandes exactes, une par ligne, prêtes à copier-coller"),
  explication: str("Ce que fait ce bloc, expliqué simplement à un étudiant"),
});

const probleme = obj({
  titre: str("Ce qui manque ou ce qui est faux, en quelques mots"),
  gravite: enumStr(["bloquant", "important", "conseil"], "Impact sur le fonctionnement"),
  concerne: arr({ type: "string" }, "ids des équipements concernés"),
  explication: str("Pourquoi c'est un problème"),
  correction: str("Comment corriger : commandes et/ou action physique"),
});

const verification = obj({
  equipement: str("id de l'équipement où taper la commande"),
  commande: str("Commande de vérification"),
  attendu: str("Résultat attendu si tout fonctionne"),
});

export const SCHEMA_ANALYSE = obj({
  type_image: enumStr(
    ["equipement_physique", "ecran_configuration", "schema_topologie", "mixte", "hors_sujet"],
    "Nature de ce qui a été photographié"
  ),
  titre: str("Titre court de l'analyse"),
  resume: str("Ce que montre la photo, en 1 à 3 phrases"),
  equipements: arr(equipement, "Équipements identifiés"),
  liens: arr(lien, "Câbles et liaisons entre équipements"),
  configuration: obj({
    source: enumStr(
      ["lue", "proposee", "mixte", "aucune"],
      "lue = retranscrite depuis l'image, proposee = écrite par toi, mixte = les deux"
    ),
    systeme: str("Système / syntaxe (Cisco IOS, MikroTik RouterOS, Windows, Linux...)"),
    blocs: arr(blocConfig, "Blocs de configuration, groupés par équipement puis par thème"),
  }),
  diagnostic: obj({
    statut: enumStr(
      ["fonctionnel", "incomplet", "non_fonctionnel", "indeterminable"],
      "Est-ce que la situation observée fonctionne telle quelle ?"
    ),
    resume: str("Verdict expliqué en 1 à 3 phrases"),
    problemes: arr(probleme, "Ce qui manque ou est faux, du plus grave au moins grave"),
    verifications: arr(verification, "Commandes pour vérifier que tout fonctionne"),
  }),
  etapes: arr(
    obj({
      titre: str("Titre de l'étape"),
      detail: str("Ce qui a été observé et ce qu'on en déduit"),
    }),
    "Raisonnement étape par étape, comme Photomath"
  ),
  limites: str("Ce qui n'a pas pu être déterminé et ce qu'il faudrait photographier en plus. Chaîne vide si rien"),
});
