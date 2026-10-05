// Compte rendu de TP : une page imprimable (PDF via l'impression du navigateur) et un fichier Word.
// Tout vient du résultat déjà affiché : aucun appel à Claude.
import { echapper, NOMS_TYPE, dessinerTopologie, NOMS_CABLE, NOMS_CERTITUDE } from "./rendu.js";

// Bibliothèque officielle « docx », chargée seulement au moment d'exporter en Word.
const URL_DOCX = "https://cdn.jsdelivr.net/npm/docx@9.8.1/+esm";

const VERDICTS = {
  fonctionnel: "Ça fonctionne",
  incomplet: "Incomplet : il manque des éléments",
  non_fonctionnel: "Ça ne fonctionne pas en l'état",
  indeterminable: "Impossible de conclure avec ces informations",
};
const GRAVITES = { bloquant: "Bloquant", important: "Important", conseil: "Conseil" };
const ETATS_PORT = { connecte: "câble branché", libre: "libre", inconnu: "inconnu" };
const SOURCES_CONFIG = {
  lue: "lue sur la photo ou le texte collé",
  proposee: "proposée par NetScan",
  mixte: "lue puis complétée par NetScan",
  aucune: "aucune",
};

const dateDuJour = () => new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });

// Version « à plat » du schéma conseillé, pour le dessiner comme un schéma normal.
function vueConseillee(sp) {
  return {
    equipements: sp.equipements.map((e) => ({ ports: [], ...e })),
    liens: sp.liens.map((l) => ({ ...l, certitude: "conseille" })),
    diagnostic: { problemes: [] },
  };
}

const lienTexte = (l) =>
  `${l.de}${l.port_de ? ` (${l.port_de})` : ""} ⟷ ${l.vers}${l.port_vers ? ` (${l.port_vers})` : ""}`;

/* ---------- Page imprimable ---------- */

export function construireRapportHtml(r, infos) {
  const d = r.diagnostic;
  const sp = r.schema_propose;
  const blocsParEquipement = new Map();
  for (const b of r.configuration?.blocs ?? []) {
    if (!blocsParEquipement.has(b.equipement)) blocsParEquipement.set(b.equipement, []);
    blocsParEquipement.get(b.equipement).push(b);
  }
  const section = (titre, contenu) => (contenu ? `<section class="r-section"><h2>${echapper(titre)}</h2>${contenu}</section>` : "");

  return `<header class="r-entete">
      <p class="r-sur-titre">Compte rendu de TP</p>
      <h1>${echapper(infos.titre || r.titre)}</h1>
      <p>${[infos.nom, infos.classe, dateDuJour()].filter(Boolean).map(echapper).join(" · ")}</p>
    </header>

    ${section(
      "Résumé",
      `<p>${echapper(r.resume)}</p>
      <p class="r-verdict r-${echapper(d.statut)}"><strong>${echapper(VERDICTS[d.statut] ?? d.statut)}</strong> : ${echapper(d.resume)}</p>
      ${r.qualite_image?.niveau && r.qualite_image.niveau !== "bonne" ? `<p class="r-note">Qualité des photos : ${echapper(r.qualite_image.niveau)}. ${echapper(r.qualite_image.detail)}</p>` : ""}`
    )}

    ${section(
      "Schéma réseau",
      r.equipements.length
        ? `<figure class="r-figure">${dessinerTopologie(r)}</figure>
          ${r.liens.length ? `<table class="r-table"><thead><tr><th>Connexion</th><th>Câble</th><th>Remarque</th></tr></thead><tbody>${r.liens
            .map((l) => `<tr><td>${echapper(lienTexte(l))}</td><td>${echapper(NOMS_CABLE[l.cable] ?? l.cable)}, ${echapper(NOMS_CERTITUDE[l.certitude] ?? l.certitude)}</td><td>${echapper(l.remarque || "")}</td></tr>`)
            .join("")}</tbody></table>` : ""}`
        : ""
    )}

    ${section(
      "Schéma conseillé",
      sp?.liens?.length
        ? `${sp.objectif ? `<p><strong>Objectif :</strong> ${echapper(sp.objectif)}</p>` : ""}
          <figure class="r-figure">${dessinerTopologie(vueConseillee(sp))}</figure>
          ${sp.avantages.length ? `<h3>Pourquoi c'est mieux</h3><ul>${sp.avantages.map((a) => `<li>${echapper(a)}</li>`).join("")}</ul>` : ""}
          ${sp.changements.length ? `<h3>Ce qu'il faut changer</h3><ol>${sp.changements.map((c) => `<li>${echapper(c)}</li>`).join("")}</ol>` : ""}`
        : ""
    )}

    ${section(
      "Équipements et ports",
      r.equipements
        .map(
          (e) => `<div class="r-bloc"><h3>${echapper(e.id)} · ${echapper(e.nom)} <span class="r-muted">(${echapper(NOMS_TYPE[e.type] ?? e.type)})</span></h3>
            ${e.role ? `<p>${echapper(e.role)}</p>` : ""}
            ${e.ports?.length ? `<table class="r-table"><thead><tr><th>Port</th><th>État</th><th>Détail</th></tr></thead><tbody>${e.ports
              .map((p) => `<tr><td>${echapper(p.nom)}</td><td>${echapper(ETATS_PORT[p.etat] ?? p.etat)}</td><td>${echapper(p.detail || "")}</td></tr>`)
              .join("")}</tbody></table>` : ""}</div>`
        )
        .join("")
    )}

    ${section(
      "Configuration",
      blocsParEquipement.size
        ? `<p class="r-muted">Configuration ${echapper(SOURCES_CONFIG[r.configuration.source] ?? r.configuration.source)} · ${echapper(r.configuration.systeme)}</p>
          ${[...blocsParEquipement]
            .map(
              ([id, blocs]) => `<div class="r-bloc"><h3>${echapper(id)}</h3>${blocs
                .map((b) => `<h4>${echapper(b.titre)}</h4><pre class="r-code">${echapper(b.commandes)}</pre><p class="r-muted">${echapper(b.explication)}</p>`)
                .join("")}</div>`
            )
            .join("")}`
        : ""
    )}

    ${section(
      "Diagnostic",
      `${d.problemes.length ? d.problemes
        .map((p) => `<div class="r-bloc r-probleme"><h3>${echapper(p.titre)} <span class="r-muted">(${echapper(GRAVITES[p.gravite] ?? p.gravite)})</span></h3>
          <p>${echapper(p.explication)}</p>${p.correction ? `<pre class="r-code">${echapper(p.correction)}</pre>` : ""}</div>`)
        .join("") : "<p>Aucun problème détecté sur ce qui est visible.</p>"}
      ${d.verifications.length ? `<h3>Vérifications</h3><table class="r-table"><thead><tr><th>Équipement</th><th>Commande</th><th>Résultat attendu</th></tr></thead><tbody>${d.verifications
        .map((v) => `<tr><td>${echapper(v.equipement)}</td><td><code>${echapper(v.commande)}</code></td><td>${echapper(v.attendu)}</td></tr>`)
        .join("")}</tbody></table>` : ""}
      ${r.materiel_a_prevoir?.length ? `<h3>Matériel à prévoir</h3><ul>${r.materiel_a_prevoir.map((m) => `<li>${echapper(m.quantite || "1")} × ${echapper(m.element)} : ${echapper(m.raison)}</li>`).join("")}</ul>` : ""}`
    )}

    ${section("Démarche", r.etapes.length ? `<ol>${r.etapes.map((e) => `<li><strong>${echapper(e.titre)}</strong> : ${echapper(e.detail)}</li>`).join("")}</ol>` : "")}
    ${section("Limites", r.limites ? `<p>${echapper(r.limites)}</p>` : "")}

    <footer class="r-pied">Compte rendu généré avec NetScan. Les résultats sont produits par une intelligence artificielle et doivent être vérifiés sur le matériel.</footer>`;
}

/* ---------- Fichier Word ---------- */

// Convertit un schéma SVG en PNG (couleurs du thème clair) pour l'insérer dans Word.
async function svgEnPng(svg) {
  const racine = document.documentElement;
  const theme = racine.getAttribute("data-theme");
  racine.setAttribute("data-theme", "light");
  const clone = svg.cloneNode(true);
  const sources = [svg, ...svg.querySelectorAll("*")];
  const copies = [clone, ...clone.querySelectorAll("*")];
  const proprietes = ["fill", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "paint-order", "font-size", "font-weight", "font-family", "opacity"];
  sources.forEach((el, i) => {
    const style = getComputedStyle(el);
    for (const p of proprietes) copies[i].style.setProperty(p, style.getPropertyValue(p));
  });
  if (theme === null) racine.removeAttribute("data-theme");
  else racine.setAttribute("data-theme", theme);

  const { width, height } = svg.viewBox.baseVal;
  const echelle = 2;
  clone.setAttribute("width", width * echelle);
  clone.setAttribute("height", height * echelle);
  clone.removeAttribute("style");
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = width * echelle;
    canvas.height = height * echelle;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    return { data: new Uint8Array(await blob.arrayBuffer()), largeur: width, hauteur: height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function exporterWord(r, infos, conteneurRapport) {
  const docx = await import(URL_DOCX);
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, ImageRun, Table, TableRow, TableCell, WidthType, ShadingType } = docx;

  const schemas = await Promise.all([...conteneurRapport.querySelectorAll("svg.topologie")].map(svgEnPng));
  const image = (s) => {
    const largeur = Math.min(600, s.largeur);
    return new Paragraph({
      children: [new ImageRun({ type: "png", data: s.data, transformation: { width: largeur, height: Math.round((s.hauteur * largeur) / s.largeur) } })],
    });
  };
  const titre = (texte, niveau = HeadingLevel.HEADING_1) => new Paragraph({ text: texte, heading: niveau, spacing: { before: 240, after: 120 } });
  const texte = (t, options = {}) => new Paragraph({ children: [new TextRun({ text: t, ...options })], spacing: { after: 100 } });
  const puce = (t) => new Paragraph({ text: t, bullet: { level: 0 } });
  const code = (t) =>
    new Paragraph({
      shading: { type: ShadingType.CLEAR, fill: "F2F4F7", color: "auto" },
      spacing: { after: 120 },
      children: t.split("\n").map((ligne, i) => new TextRun({ text: ligne, font: "Consolas", size: 18, break: i ? 1 : 0 })),
    });
  const tableau = (entetes, lignes) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          tableHeader: true,
          children: entetes.map((e) => new TableCell({ shading: { type: ShadingType.CLEAR, fill: "E3E8EF", color: "auto" }, children: [texte(e, { bold: true })] })),
        }),
        ...lignes.map((l) => new TableRow({ children: l.map((c) => new TableCell({ children: [texte(String(c ?? ""))] })) })),
      ],
    });

  const d = r.diagnostic;
  const sp = r.schema_propose;
  let iSchema = 0;
  const contenu = [
    texte("Compte rendu de TP", { color: "5F6B80", size: 20 }),
    new Paragraph({ text: infos.titre || r.titre, heading: HeadingLevel.TITLE }),
    texte([infos.nom, infos.classe, dateDuJour()].filter(Boolean).join(" · "), { color: "5F6B80" }),

    titre("Résumé"),
    texte(r.resume),
    texte(`${VERDICTS[d.statut] ?? d.statut} : ${d.resume}`, { bold: true }),
  ];
  if (r.qualite_image?.niveau && r.qualite_image.niveau !== "bonne") {
    contenu.push(texte(`Qualité des photos : ${r.qualite_image.niveau}. ${r.qualite_image.detail}`, { italics: true }));
  }
  if (r.equipements.length) {
    contenu.push(titre("Schéma réseau"));
    if (schemas[iSchema]) contenu.push(image(schemas[iSchema++]));
    if (r.liens.length) {
      contenu.push(
        tableau(
          ["Connexion", "Câble", "Remarque"],
          r.liens.map((l) => [lienTexte(l), `${NOMS_CABLE[l.cable] ?? l.cable}, ${NOMS_CERTITUDE[l.certitude] ?? l.certitude}`, l.remarque || ""])
        )
      );
    }
  }
  if (sp?.liens?.length) {
    contenu.push(titre("Schéma conseillé"));
    if (sp.objectif) contenu.push(texte(`Objectif : ${sp.objectif}`));
    if (schemas[iSchema]) contenu.push(image(schemas[iSchema++]));
    if (sp.avantages.length) contenu.push(titre("Pourquoi c'est mieux", HeadingLevel.HEADING_2), ...sp.avantages.map(puce));
    if (sp.changements.length) {
      contenu.push(titre("Ce qu'il faut changer", HeadingLevel.HEADING_2), ...sp.changements.map((c, i) => texte(`${i + 1}. ${c}`)));
    }
  }
  if (r.equipements.length) {
    contenu.push(titre("Équipements et ports"));
    for (const e of r.equipements) {
      contenu.push(titre(`${e.id} · ${e.nom} (${NOMS_TYPE[e.type] ?? e.type})`, HeadingLevel.HEADING_2));
      if (e.role) contenu.push(texte(e.role));
      if (e.ports?.length) contenu.push(tableau(["Port", "État", "Détail"], e.ports.map((p) => [p.nom, ETATS_PORT[p.etat] ?? p.etat, p.detail || ""])));
    }
  }
  if (r.configuration?.blocs?.length) {
    contenu.push(titre("Configuration"), texte(`Configuration ${SOURCES_CONFIG[r.configuration.source] ?? r.configuration.source} · ${r.configuration.systeme}`, { color: "5F6B80" }));
    for (const b of r.configuration.blocs) {
      contenu.push(titre(`${b.equipement} : ${b.titre}`, HeadingLevel.HEADING_2), code(b.commandes), texte(b.explication, { color: "5F6B80" }));
    }
  }
  contenu.push(titre("Diagnostic"));
  if (d.problemes.length) {
    for (const p of d.problemes) {
      contenu.push(titre(`${p.titre} (${GRAVITES[p.gravite] ?? p.gravite})`, HeadingLevel.HEADING_2), texte(p.explication));
      if (p.correction) contenu.push(code(p.correction));
    }
  } else {
    contenu.push(texte("Aucun problème détecté sur ce qui est visible."));
  }
  if (d.verifications.length) {
    contenu.push(titre("Vérifications", HeadingLevel.HEADING_2), tableau(["Équipement", "Commande", "Résultat attendu"], d.verifications.map((v) => [v.equipement, v.commande, v.attendu])));
  }
  if (r.materiel_a_prevoir?.length) {
    contenu.push(titre("Matériel à prévoir", HeadingLevel.HEADING_2), ...r.materiel_a_prevoir.map((m) => puce(`${m.quantite || "1"} × ${m.element} : ${m.raison}`)));
  }
  if (r.etapes.length) contenu.push(titre("Démarche"), ...r.etapes.map((e, i) => texte(`${i + 1}. ${e.titre} : ${e.detail}`)));
  if (r.limites) contenu.push(titre("Limites"), texte(r.limites));
  contenu.push(
    texte("Compte rendu généré avec NetScan. Les résultats sont produits par une intelligence artificielle et doivent être vérifiés sur le matériel.", { italics: true, color: "5F6B80", size: 18 })
  );

  const document = new Document({
    creator: infos.nom || "NetScan",
    title: infos.titre || r.titre,
    styles: { default: { document: { run: { font: "Calibri", size: 22 } } } },
    sections: [{ children: contenu }],
  });
  return Packer.toBlob(document);
}
