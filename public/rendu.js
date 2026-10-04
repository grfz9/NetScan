// Dessin en SVG : icônes d'équipements, schéma de topologie et façade avec les ports.

export const echapper = (texte) =>
  String(texte ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const NOMS_TYPE = {
  routeur: "Routeur",
  switch: "Switch",
  switch_l3: "Switch niveau 3",
  pare_feu: "Pare-feu",
  point_acces: "Point d'accès Wi-Fi",
  box_modem: "Box / modem",
  serveur: "Serveur",
  pc: "Ordinateur",
  imprimante: "Imprimante",
  telephone_ip: "Téléphone IP",
  cloud_internet: "Internet / cloud",
  panneau_brassage: "Panneau de brassage",
  inconnu: "Inconnu",
};

const COULEURS = {
  routeur: "#2563eb",
  switch: "#0891b2",
  switch_l3: "#0e7490",
  pare_feu: "#dc2626",
  point_acces: "#7c3aed",
  box_modem: "#db2777",
  serveur: "#475569",
  pc: "#334155",
  imprimante: "#64748b",
  telephone_ip: "#0f766e",
  cloud_internet: "#0ea5e9",
  panneau_brassage: "#78716c",
  inconnu: "#94a3b8",
};

// Pictogrammes blancs dessinés dans un carré de 48×48.
const GLYPHES = {
  routeur: `<circle cx="24" cy="24" r="13"/><path d="M19 19l10 10M29 19L19 29M19 19v4M19 19h4M29 29v-4M29 29h-4M29 19h-4M29 19v4M19 29v-4M19 29h4" />`,
  switch: `<path d="M11 19h24M31 15l4 4-4 4M37 29H13M17 25l-4 4 4 4"/>`,
  switch_l3: `<path d="M11 18h24M31 14l4 4-4 4M37 30H13M17 26l-4 4 4 4"/><circle cx="24" cy="24" r="2.2" fill="#fff"/>`,
  pare_feu: `<rect x="11" y="13" width="26" height="22" rx="1.5"/><path d="M11 20.3h26M11 27.6h26M19 13v7.3M29 13v7.3M24 20.3v7.3M15 27.6V35M33 27.6V35M24 27.6V35"/>`,
  point_acces: `<circle cx="24" cy="30" r="2.2" fill="#fff"/><path d="M17.5 23.5a9 9 0 0 1 13 0M13 19a15.5 15.5 0 0 1 22 0"/><path d="M24 32v5"/>`,
  box_modem: `<rect x="11" y="25" width="26" height="10" rx="2.5"/><path d="M16 25l-2-11M32 25l2-11"/><circle cx="17" cy="30" r="1.2" fill="#fff"/><circle cx="22" cy="30" r="1.2" fill="#fff"/>`,
  serveur: `<rect x="14" y="11" width="20" height="8" rx="1.5"/><rect x="14" y="20" width="20" height="8" rx="1.5"/><rect x="14" y="29" width="20" height="8" rx="1.5"/><path d="M18 15h4M18 24h4M18 33h4"/>`,
  pc: `<rect x="11" y="12" width="26" height="18" rx="2"/><path d="M24 30v5M17 36h14"/>`,
  imprimante: `<path d="M17 19v-7h14v7M17 31h-5V20h24v11h-5"/><rect x="17" y="27" width="14" height="9"/>`,
  telephone_ip: `<rect x="15" y="11" width="18" height="26" rx="3"/><path d="M19 16h10"/><circle cx="20" cy="23" r="1" fill="#fff"/><circle cx="24" cy="23" r="1" fill="#fff"/><circle cx="28" cy="23" r="1" fill="#fff"/><circle cx="20" cy="28" r="1" fill="#fff"/><circle cx="24" cy="28" r="1" fill="#fff"/><circle cx="28" cy="28" r="1" fill="#fff"/>`,
  cloud_internet: `<path d="M16 33h17a6 6 0 0 0 .8-11.95A8.5 8.5 0 0 0 17.4 20 6.5 6.5 0 0 0 16 33z"/>`,
  panneau_brassage: `<rect x="9" y="18" width="30" height="12" rx="1.5"/><path d="M13 22h3v4h-3zM19 22h3v4h-3zM25 22h3v4h-3zM31 22h3v4h-3z"/>`,
  inconnu: `<path d="M19.5 19a4.5 4.5 0 1 1 6.2 4.2c-1.1.5-1.7 1.4-1.7 2.6V27"/><circle cx="24" cy="32" r="1.3" fill="#fff"/>`,
};

export function icone(type, taille = 48, x = 0, y = 0) {
  const t = GLYPHES[type] ? type : "inconnu";
  return `<svg x="${x}" y="${y}" width="${taille}" height="${taille}" viewBox="0 0 48 48" aria-hidden="true">
    <rect width="48" height="48" rx="12" fill="${COULEURS[t]}"/>
    <g fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${GLYPHES[t]}</g>
  </svg>`;
}

/* ---------- Schéma de topologie ---------- */

// Ordre vertical : Internet en haut, postes clients en bas.
const RANG = {
  cloud_internet: 0, box_modem: 1, pare_feu: 2, routeur: 3, switch_l3: 4,
  switch: 5, panneau_brassage: 5, point_acces: 6, serveur: 6,
  pc: 7, imprimante: 7, telephone_ip: 7, inconnu: 7,
};

const STYLE_CABLE = {
  console: { couleur: "#38bdf8", tirets: "5 4" },
  fibre: { couleur: "#f97316", tirets: "" },
  serie: { couleur: "#ef4444", tirets: "" },
  wifi: { couleur: "#a78bfa", tirets: "2 5" },
};

const tronquer = (texte, max) => (texte.length > max ? texte.slice(0, max - 1) + "…" : texte);

// Postes « en bout de chaîne » qu'on peut regrouper dans la vue simplifiée.
const TERMINAUX = {
  pc: "PC",
  imprimante: "imprimantes",
  telephone_ip: "téléphones IP",
  serveur: "serveurs",
  point_acces: "bornes Wi-Fi",
};

export const schemaComplexe = (r) => r.equipements.length >= 4 || r.liens.length >= 4;

// Vue simplifiée : les postes identiques reliés au même équipement deviennent un seul
// bloc (« 3 PC »), les câbles en double sont fusionnés et les noms de ports sont masqués.
function simplifier(resultat) {
  const voisins = new Map();
  const ajouter = (a, b) => (voisins.get(a) ?? voisins.set(a, new Set()).get(a)).add(b);
  for (const l of resultat.liens) {
    if (l.de === l.vers) continue;
    ajouter(l.de, l.vers);
    ajouter(l.vers, l.de);
  }

  const groupes = new Map();
  for (const e of resultat.equipements) {
    const v = [...(voisins.get(e.id) ?? [])];
    if (!TERMINAUX[e.type] || v.length > 1) continue;
    const cle = `${e.type}|${v[0] ?? ""}`;
    (groupes.get(cle) ?? groupes.set(cle, []).get(cle)).push(e);
  }

  const remplace = new Map();
  const equipements = [];
  for (const [cle, membres] of groupes) {
    if (membres.length < 2) continue;
    const [type, voisin] = cle.split("|");
    const id = `groupe:${cle}`;
    membres.forEach((m) => remplace.set(m.id, id));
    equipements.push({
      id,
      etiquette: `${membres.length} ${TERMINAUX[type]}`,
      nom: membres.map((m) => m.id).join(", "),
      modele: membres.map((m) => m.id).join(", "),
      type,
      ports: [],
      voisin,
    });
  }
  const versId = (id) => remplace.get(id) ?? id;
  equipements.unshift(...resultat.equipements.filter((e) => !remplace.has(e.id)));

  const vus = new Set();
  const liens = [];
  for (const l of resultat.liens) {
    const de = versId(l.de);
    const vers = versId(l.vers);
    const cle = [de, vers].sort().join("|");
    if (de === vers || vus.has(cle)) continue;
    vus.add(cle);
    liens.push({ ...l, de, vers, port_de: "", port_vers: "" });
  }

  const problemes = (resultat.diagnostic?.problemes ?? []).map((p) => ({
    ...p,
    concerne: (p.concerne ?? []).map(versId),
  }));
  return { ...resultat, equipements, liens, diagnostic: { ...resultat.diagnostic, problemes } };
}

export function dessinerTopologie(source, { simple = false } = {}) {
  const resultat = simple ? simplifier(source) : source;
  const noeuds = resultat.equipements.map((e) => ({ ...e }));
  const parId = new Map(noeuds.map((n) => [n.id, n]));
  // Un lien vers un id absent crée un équipement inconnu plutôt que de disparaître.
  for (const l of resultat.liens) {
    for (const id of [l.de, l.vers]) {
      if (!parId.has(id)) {
        const n = { id, nom: "Équipement non identifié", type: "inconnu", ports: [] };
        noeuds.push(n);
        parId.set(id, n);
      }
    }
  }
  if (noeuds.length === 0) return "";

  const voisins = new Map(noeuds.map((n) => [n.id, []]));
  for (const l of resultat.liens) {
    if (l.de === l.vers) continue;
    voisins.get(l.de).push(l.vers);
    voisins.get(l.vers).push(l.de);
  }

  // Couches : on garde seulement les rangs utilisés.
  const rangs = [...new Set(noeuds.map((n) => RANG[n.type] ?? 7))].sort((a, b) => a - b);
  const couches = rangs.map((r) => noeuds.filter((n) => (RANG[n.type] ?? 7) === r));
  const coucheDe = new Map();
  couches.forEach((c, i) => c.forEach((n) => coucheDe.set(n.id, i)));

  // Réduit les croisements : on trie chaque couche selon la position moyenne de ses voisins.
  const position = new Map();
  const indexer = () => couches.forEach((c) => c.forEach((n, i) => position.set(n.id, (i + 0.5) / c.length)));
  indexer();
  const trier = (ordre) => {
    for (const i of ordre) {
      const moyenne = (n) => {
        const v = voisins.get(n.id).filter((id) => coucheDe.get(id) !== i);
        return v.length ? v.reduce((s, id) => s + position.get(id), 0) / v.length : position.get(n.id);
      };
      couches[i].sort((a, b) => moyenne(a) - moyenne(b));
      indexer();
    }
  };
  const indices = couches.map((_, i) => i);
  trier(indices.slice(1));
  trier(indices.slice(0, -1).reverse());
  trier(indices.slice(1));

  const COL = 175;
  const LIGNE = 150;
  const MARGE_HAUT = 52;
  const largeur = Math.max(...couches.map((c) => c.length)) * COL + 40;
  const hauteur = couches.length * LIGNE + 10;
  const xy = new Map();
  couches.forEach((c, i) => {
    const debut = (largeur - c.length * COL) / 2;
    c.forEach((n, j) => xy.set(n.id, { x: debut + COL * (j + 0.5) - 30, y: MARGE_HAUT + i * LIGNE }));
  });

  // Gravité max des problèmes par équipement, pour la pastille d'alerte.
  const alerte = new Map();
  for (const p of resultat.diagnostic?.problemes ?? []) {
    for (const id of p.concerne ?? []) {
      if (p.gravite === "bloquant" || (p.gravite === "important" && alerte.get(id) !== "bloquant")) {
        alerte.set(id, p.gravite);
      }
    }
  }

  const doublons = new Map();
  let traits = "";
  let etiquettes = "";
  for (const l of resultat.liens) {
    if (l.de === l.vers) continue;
    const a = xy.get(l.de);
    const b = xy.get(l.vers);
    const cle = [l.de, l.vers].sort().join("|");
    const rang = doublons.get(cle) ?? 0;
    doublons.set(cle, rang + 1);

    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const long = Math.hypot(dx, dy) || 1;
    const ux = dx / long;
    const uy = dy / long;
    // Plusieurs câbles entre les mêmes équipements : on les écarte.
    const decal = rang === 0 ? 0 : (rang % 2 ? 1 : -1) * Math.ceil(rang / 2) * 14;
    const ox = -uy * decal;
    const oy = ux * decal;
    const x1 = a.x + ux * 30 + ox, y1 = a.y + uy * 30 + oy;
    const x2 = b.x - ux * 30 + ox, y2 = b.y - uy * 30 + oy;

    const style = STYLE_CABLE[l.cable] ?? { couleur: "var(--lien)", tirets: "" };
    let couleur = style.couleur;
    let tirets = style.tirets;
    if (l.certitude === "deduit" && !tirets) tirets = "7 5";
    if (l.certitude === "propose") {
      couleur = "var(--propose)";
      tirets = "7 5";
    }
    const titre = `${l.de} ${l.port_de || "?"} ↔ ${l.vers} ${l.port_vers || "?"} — câble ${l.cable}, ${l.certitude}${l.remarque ? " — " + l.remarque : ""}`;
    traits += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:${couleur}" stroke-width="2.4" stroke-dasharray="${tirets}" stroke-linecap="round"><title>${echapper(titre)}</title></line>`;

    const distance = Math.min(30, Math.max(14, long * 0.18 - 10));
    for (const [port, px, py] of [
      [l.port_de, x1 + ux * distance, y1 + uy * distance],
      [l.port_vers, x2 - ux * distance, y2 - uy * distance],
    ]) {
      if (!port) continue;
      const texte = tronquer(port, 12);
      const w = texte.length * 6.2 + 10;
      etiquettes += `<g><rect class="port-fond" x="${px - w / 2}" y="${py - 9}" width="${w}" height="18" rx="9" style="stroke:${couleur}"/>
        <text class="port-etiquette" x="${px}" y="${py + 3.5}" text-anchor="middle">${echapper(texte)}</text></g>`;
    }
  }

  let blocs = "";
  for (const n of noeuds) {
    const { x, y } = xy.get(n.id);
    const sous = tronquer(n.modele || n.nom || NOMS_TYPE[n.type] || "", 20);
    const gravite = alerte.get(n.id);
    const pastille = gravite
      ? `<circle cx="${x + 21}" cy="${y - 21}" r="9" style="fill:${gravite === "bloquant" ? "var(--ko)" : "var(--warn)"};stroke:var(--carte)" stroke-width="2"/>
         <text x="${x + 21}" y="${y - 17}" text-anchor="middle" style="fill:#fff;font-size:12px;font-weight:800">!</text>`
      : "";
    blocs += `<g class="noeud" data-id="${echapper(n.id)}" tabindex="0" role="button" aria-label="${echapper(n.id + " " + (n.nom || ""))}">
      ${icone(n.type, 48, x - 24, y - 24)}
      ${pastille}
      <text class="noeud-nom" x="${x + 32}" y="${y - 2}">${echapper(tronquer(n.etiquette ?? n.id, 14))}</text>
      <text class="noeud-sous" x="${x + 32}" y="${y + 12}">${echapper(sous)}</text>
    </g>`;
  }

  return `<svg class="topologie" viewBox="0 0 ${largeur} ${hauteur}" style="max-width:${largeur}px" role="img" aria-label="Schéma réseau">
    ${traits}${etiquettes}${blocs}
  </svg>`;
}

/* ---------- Façade de l'équipement ---------- */

const GROUPES = [
  { cle: "reseau", titre: "Ethernet", types: ["ethernet"] },
  { cle: "wan", titre: "WAN", types: ["wan"] },
  { cle: "sfp", titre: "SFP / fibre", types: ["sfp"] },
  { cle: "serie", titre: "Série", types: ["serie"] },
  { cle: "gestion", titre: "Gestion", types: ["console", "usb"] },
  { cle: "autre", titre: "Autres", types: ["autre"] },
  { cle: "alim", titre: "Alim.", types: ["alimentation"] },
];

const TAILLE_PORT = {
  ethernet: [22, 18], wan: [22, 18], console: [22, 18], sfp: [26, 13],
  serie: [30, 15], usb: [18, 9], alimentation: [18, 18], autre: [20, 16],
};

function formePort(port, x, y) {
  const [w, h] = TAILLE_PORT[port.type] ?? TAILLE_PORT.autre;
  let remplissage = "var(--port-libre)";
  let trait = "rgb(0 0 0 / 35%)";
  let tirets = "";
  if (port.etat === "connecte") remplissage = "var(--port-ok)";
  if (port.etat === "inconnu") {
    remplissage = "transparent";
    trait = "var(--port-libre)";
    tirets = "3 2";
  }
  if (port.type === "console" && port.etat !== "connecte") remplissage = port.etat === "inconnu" ? "transparent" : "#3b82c4";
  if (port.type === "wan" && port.etat === "libre") remplissage = "#7a5a2f";

  const corps =
    port.type === "alimentation"
      ? `<rect class="corps" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="9" style="fill:${remplissage};stroke:${trait}" stroke-dasharray="${tirets}"/>`
      : `<rect class="corps" x="${x - w / 2}" y="${y - h / 2}" width="${w}" height="${h}" rx="2" style="fill:${remplissage};stroke:${trait}" stroke-dasharray="${tirets}"/>`;
  // Encoche des prises RJ45.
  const encoche = ["ethernet", "wan", "console"].includes(port.type)
    ? `<rect x="${x - 4}" y="${y + h / 2 - 5}" width="8" height="5" style="fill:rgb(0 0 0 / 40%)"/>`
    : "";
  return { svg: corps + encoche, h };
}

export function dessinerFacade(equipement, indexEquipement) {
  const ports = equipement.ports ?? [];
  if (ports.length === 0) return "";

  const PAS = 34;
  const groupes = GROUPES.map((g) => ({
    ...g,
    ports: ports.map((p, i) => ({ ...p, i })).filter((p) => g.types.includes(p.type)),
  })).filter((g) => g.ports.length);

  const deuxRangees = groupes.some((g) => g.ports.length > 8);
  const hauteur = deuxRangees ? 112 : 84;
  const xMarque = 14;
  let x = 128;
  let contenu = "";

  for (const g of groupes) {
    const doubler = g.ports.length > 8;
    const colonnes = doubler ? Math.ceil(g.ports.length / 2) : g.ports.length;
    const largeurGroupe = colonnes * PAS;
    contenu += `<text x="${x + largeurGroupe / 2 - PAS / 2 + 4}" y="17" text-anchor="middle" style="fill:#9fb0c8;font-size:9.5px;font-weight:700;letter-spacing:.04em">${echapper(g.titre.toUpperCase())}</text>`;
    g.ports.forEach((p, k) => {
      // Comme sur un vrai switch : ports impairs en haut, pairs en bas.
      const col = doubler ? Math.floor(k / 2) : k;
      const enBas = doubler && k % 2 === 1;
      const px = x + col * PAS + 4;
      const py = doubler ? (enBas ? 76 : 46) : 48;
      const { svg, h } = formePort(p, px, py);
      const ty = enBas || !doubler ? py + h / 2 + 12 : py - h / 2 - 5;
      contenu += `<g class="port" data-eq="${indexEquipement}" data-port="${p.i}" tabindex="0" role="button" aria-label="${echapper(`${p.nom}, ${p.etat}`)}">
        <title>${echapper(`${p.nom} — ${p.etat}${p.detail ? " — " + p.detail : ""}`)}</title>
        ${svg}
        <text x="${px}" y="${ty}" text-anchor="middle" style="fill:#c9d4e5;font-size:8.5px">${echapper(tronquer(p.nom, 8))}</text>
      </g>`;
    });
    x += largeurGroupe + 20;
  }

  const largeur = x + 4;
  const marque = equipement.marque || NOMS_TYPE[equipement.type] || "";
  return `<svg class="facade" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" role="img" aria-label="Façade avec ${ports.length} ports">
    <rect x="1" y="1" width="${largeur - 2}" height="${hauteur - 2}" rx="8" style="fill:var(--chassis);stroke:rgb(0 0 0 / 30%)"/>
    <text x="${xMarque}" y="${hauteur / 2 - 2}" style="fill:#fff;font-size:12px;font-weight:800;letter-spacing:.05em">${echapper(tronquer(marque.toUpperCase(), 10))}</text>
    <text x="${xMarque}" y="${hauteur / 2 + 13}" style="fill:#9fb0c8;font-size:9.5px">${echapper(tronquer(equipement.modele || "", 16))}</text>
    ${contenu}
  </svg>`;
}

/* ---------- Coloration simple des commandes ---------- */

export function colorerCommandes(commandes) {
  return commandes
    .split("\n")
    .map((ligne) => {
      const e = echapper(ligne);
      const t = ligne.trim();
      if (t.startsWith("!") || t.startsWith("#") || t.startsWith("//")) return `<span class="cmt">${e}</span>`;
      return e
        .replace(/^(\s*)(no)(\s)/, '$1<span class="neg">$2</span>$3')
        .replace(/^(\s*)(?!<)(\S+)/, '$1<span class="mot">$2</span>')
        .replace(/\b(\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?)\b/g, '<span class="num">$1</span>');
    })
    .join("\n");
}
