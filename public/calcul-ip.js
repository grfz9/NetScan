// Calculs IPv4 : adresse et masque, découpage VLSM. Tout se fait dans le navigateur,
// sans appel à Claude. Chaque résultat garde les étapes du calcul pour les expliquer.

export class ErreurCalcul extends Error {}

const versNombre = (octets) => ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;

export function lireIP(texte) {
  const morceaux = String(texte).trim().split(".");
  if (morceaux.length !== 4 || morceaux.some((m) => !/^\d{1,3}$/.test(m) || Number(m) > 255)) {
    throw new ErreurCalcul(`« ${texte} » n'est pas une adresse IPv4 (4 nombres de 0 à 255 séparés par des points).`);
  }
  return versNombre(morceaux.map(Number));
}

export const ipTexte = (n) => [24, 16, 8, 0].map((d) => (n >>> d) & 255).join(".");
export const masqueDePrefixe = (p) => (p === 0 ? 0 : (0xffffffff << (32 - p)) >>> 0);
const binaireOctet = (o) => o.toString(2).padStart(8, "0");
export const ipBinaire = (n) => [24, 16, 8, 0].map((d) => binaireOctet((n >>> d) & 255)).join(".");

// Accepte « /26 », « 26 » ou « 255.255.255.192 ».
export function lirePrefixe(texte) {
  const t = String(texte).trim().replace(/^\//, "");
  if (/^\d{1,2}$/.test(t)) {
    const p = Number(t);
    if (p > 32) throw new ErreurCalcul("Le préfixe doit être entre /0 et /32.");
    return p;
  }
  const m = lireIP(t);
  const p = 32 - Math.log2(((~m >>> 0) + 1) || 2 ** 32);
  if (!Number.isInteger(p) || masqueDePrefixe(p) !== m) {
    throw new ErreurCalcul(`« ${texte} » n'est pas un masque valide : ses bits à 1 doivent être tous à gauche (ex : 255.255.255.192).`);
  }
  return p;
}

// « 192.168.1.10/26 » ou adresse + masque séparés.
export function lireAdresseEtPrefixe(adresse, masque) {
  const [ip, suite] = String(adresse).trim().split("/");
  const prefixe = suite !== undefined && suite !== "" ? lirePrefixe(suite) : lirePrefixe(masque);
  return { ip: lireIP(ip), prefixe };
}

function classe(ip) {
  const premier = ip >>> 24;
  if (premier < 128) return "A";
  if (premier < 192) return "B";
  if (premier < 224) return "C";
  if (premier < 240) return "D (multicast)";
  return "E (réservée)";
}

function typeAdresse(ip) {
  const dans = (reseau, p) => ((ip & masqueDePrefixe(p)) >>> 0) === lireIP(reseau);
  if (dans("10.0.0.0", 8) || dans("172.16.0.0", 12) || dans("192.168.0.0", 16)) return "privée (RFC 1918)";
  if (dans("127.0.0.0", 8)) return "boucle locale (loopback)";
  if (dans("169.254.0.0", 16)) return "APIPA (pas de DHCP)";
  if (dans("100.64.0.0", 10)) return "partagée (CGNAT)";
  if ((ip >>> 28) === 14) return "multicast";
  return "publique";
}

const nombreHotes = (p) => (p === 32 ? 1 : p === 31 ? 2 : 2 ** (32 - p) - 2);

export function analyserAdresse(ip, prefixe) {
  const masque = masqueDePrefixe(prefixe);
  const wildcard = ~masque >>> 0;
  const reseau = (ip & masque) >>> 0;
  const broadcast = (reseau | wildcard) >>> 0;
  const special = prefixe >= 31;
  const premier = special ? reseau : reseau + 1;
  const dernier = special ? broadcast : broadcast - 1;
  const bitsHote = 32 - prefixe;

  const etapes = [
    {
      titre: "Le masque en binaire",
      detail: `/${prefixe} signifie ${prefixe} bits à 1 à gauche, puis ${bitsHote} bits à 0 : ${ipBinaire(masque)}, soit ${ipTexte(masque)}.`,
    },
    {
      titre: "L'adresse réseau : ET logique entre l'adresse et le masque",
      detail: `On garde les ${prefixe} premiers bits de l'adresse et on met les ${bitsHote} bits d'hôte à 0 : ${ipBinaire(reseau)}, soit ${ipTexte(reseau)}.`,
    },
    {
      titre: "L'adresse de broadcast : bits d'hôte à 1",
      detail: special
        ? `Avec /${prefixe}, il n'y a pas de broadcast utilisable : ${prefixe === 32 ? "l'adresse désigne un seul hôte" : "c'est un lien point à point (RFC 3021), les 2 adresses servent aux 2 extrémités"}.`
        : `On met les ${bitsHote} bits d'hôte à 1 : ${ipBinaire(broadcast)}, soit ${ipTexte(broadcast)}.`,
    },
    {
      titre: "Le nombre d'hôtes",
      detail: special
        ? `/${prefixe} : ${nombreHotes(prefixe)} adresse${prefixe === 32 ? "" : "s"} utilisable${prefixe === 32 ? "" : "s"}.`
        : `2^${bitsHote} − 2 = ${2 ** bitsHote} − 2 = ${nombreHotes(prefixe)} hôtes (on retire l'adresse réseau et le broadcast).`,
    },
    {
      titre: "La plage utilisable",
      detail: special
        ? `De ${ipTexte(premier)} à ${ipTexte(dernier)}.`
        : `De réseau + 1 = ${ipTexte(premier)} à broadcast − 1 = ${ipTexte(dernier)}.`,
    },
  ];

  return {
    ip: ipTexte(ip),
    prefixe,
    masque: ipTexte(masque),
    wildcard: ipTexte(wildcard),
    reseau: ipTexte(reseau),
    broadcast: special ? "—" : ipTexte(broadcast),
    premier: ipTexte(premier),
    dernier: ipTexte(dernier),
    hotes: nombreHotes(prefixe),
    classe: classe(ip),
    type: typeAdresse(ip),
    estReseau: ip === reseau && !special,
    binaire: { ip: ipBinaire(ip), masque: ipBinaire(masque), reseau: ipBinaire(reseau), broadcast: ipBinaire(broadcast) },
    etapes,
  };
}

// Découpage VLSM : du plus grand besoin au plus petit, chaque sous-réseau à la suite du précédent.
export function decouperVLSM(reseauTexte, besoins) {
  const { ip, prefixe } = lireAdresseEtPrefixe(reseauTexte, "");
  const base = (ip & masqueDePrefixe(prefixe)) >>> 0;
  const fin = base + 2 ** (32 - prefixe);
  const etapes = [];
  if (base !== ip) {
    etapes.push({ titre: "Adresse de départ corrigée", detail: `${ipTexte(ip)}/${prefixe} n'est pas une adresse réseau : on part de ${ipTexte(base)}/${prefixe}.` });
  }

  const liste = besoins
    .map((b, i) => ({ nom: String(b.nom || `Réseau ${i + 1}`).trim(), hotes: Math.floor(Number(b.hotes)) }))
    .filter((b) => b.hotes > 0);
  if (!liste.length) throw new ErreurCalcul("Ajoute au moins un sous-réseau avec un nombre d'hôtes.");
  const tries = [...liste].sort((a, b) => b.hotes - a.hotes);
  etapes.push({
    titre: "Trier du plus grand au plus petit",
    detail: `On place d'abord les plus gros sous-réseaux pour ne pas perdre d'adresses : ${tries.map((b) => `${b.nom} (${b.hotes})`).join(", ")}.`,
  });

  let suivant = base;
  const sousReseaux = tries.map((b) => {
    // Assez de bits d'hôte pour les hôtes + réseau + broadcast (2 hôtes : /30 pour un lien entre routeurs).
    const bits = Math.max(2, Math.ceil(Math.log2(b.hotes + 2)));
    const p = 32 - bits;
    const taille = 2 ** bits;
    const reseau = Math.ceil(suivant / taille) * taille;
    if (reseau + taille > fin) {
      throw new ErreurCalcul(
        `Plus assez de place pour « ${b.nom} » (${b.hotes} hôtes, il faut un /${p} de ${taille} adresses) dans ${ipTexte(base)}/${prefixe}. Prends un réseau de départ plus grand ou réduis les besoins.`
      );
    }
    etapes.push({
      titre: `${b.nom} : ${b.hotes} hôte${b.hotes > 1 ? "s" : ""}`,
      detail: `Il faut 2^n − 2 ≥ ${b.hotes} : n = ${bits} bits d'hôte (2^${bits} − 2 = ${taille - 2}), donc /${p}. Le sous-réseau commence à ${ipTexte(reseau)} et occupe ${taille} adresses.`,
    });
    suivant = reseau + taille;
    return {
      nom: b.nom,
      demandes: b.hotes,
      disponibles: taille - 2,
      reseau: ipTexte(reseau),
      prefixe: p,
      masque: ipTexte(masqueDePrefixe(p)),
      premier: ipTexte(reseau + 1),
      dernier: ipTexte(reseau + taille - 2),
      broadcast: ipTexte(reseau + taille - 1),
    };
  });

  const restant = fin - suivant;
  etapes.push({
    titre: "Espace restant",
    detail: restant
      ? `Il reste ${restant} adresses libres, à partir de ${ipTexte(suivant)}, pour de futurs sous-réseaux.`
      : `Tout l'espace de ${ipTexte(base)}/${prefixe} est utilisé.`,
  });
  return { depart: `${ipTexte(base)}/${prefixe}`, sousReseaux, restant, etapes };
}
