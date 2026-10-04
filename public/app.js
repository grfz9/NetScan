import { echapper, icone, NOMS_TYPE, dessinerTopologie, dessinerFacade, colorerCommandes, schemaComplexe } from "./rendu.js";
import {
  MAX_PHOTOS,
  MODELE_PAR_DEFAUT,
  analyserAvec,
  messageErreur,
  analyserAvecCompteClaude,
  messageErreurCompteClaude,
} from "./coeur.js";

const $ = (sel) => document.querySelector(sel);
const CLE_HISTORIQUE = "netscan.historique";
const CLE_API = "netscan.cleApi";
const CLE_MODELE = "netscan.modele";
// SDK officiel d'Anthropic, chargé seulement si l'analyse se fait depuis le navigateur.
const URL_SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";

const etat = {
  photos: [], // { data, media_type, apercu }
  resultat: null,
  schemaSimple: false,
  serveur: { cle: false, modele: "" }, // ce que dit /api/statut (absent sur GitHub Pages)
  compteClaude: null, // { sample, maxPhotos } quand la page tourne sur claude.ai
  messageCompteClaude: "Connexion à ton compte Claude…",
};

// Sur claude.ai, `window.claude` existe avant le chargement de la page : on n'y demande jamais de clé API.
const SUR_CLAUDE_AI = Boolean(window.claude?.use);

/* ---------- Stockage local (peut être bloqué en navigation privée) ---------- */

function lire(cle) {
  try {
    return localStorage.getItem(cle) ?? "";
  } catch {
    return "";
  }
}

function ecrire(cle, valeur) {
  try {
    if (valeur) localStorage.setItem(cle, valeur);
    else localStorage.removeItem(cle);
    return true;
  } catch {
    return false;
  }
}

const modeleChoisi = () => lire(CLE_MODELE) || MODELE_PAR_DEFAUT;

// "serveur" si le serveur Node a sa propre clé, "navigateur" si une clé est enregistrée ici.
// "claude" si la page est ouverte sur claude.ai : c'est le compte Claude qui analyse, sans clé.
function modeAnalyse() {
  if (etat.serveur.cle) return "serveur";
  if (etat.compteClaude) return "claude";
  if (lire(CLE_API)) return "navigateur";
  return null;
}

/* ---------- Navigation entre les vues ---------- */

function afficherVue(nom) {
  for (const v of ["accueil", "chargement", "resultat", "historique", "reglages"]) {
    $(`#vue-${v}`).hidden = v !== nom;
  }
  window.scrollTo({ top: 0 });
}

function toast(message, erreur = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("erreur", erreur);
  el.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => (el.hidden = true), erreur ? 6000 : 2500);
}

/* ---------- Photos ---------- */

// Réduit la photo (1568 px max, ce que Claude exploite) pour un envoi rapide.
async function compresser(fichier, cote = 1568, qualite = 0.85) {
  const url = URL.createObjectURL(fichier);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const echelle = Math.min(1, cote / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * echelle);
    canvas.height = Math.round(img.naturalHeight * echelle);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", qualite);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Repère une photo floue ou trop sombre directement sur l'appareil, avant l'envoi.
// Netteté = variance du laplacien (peu de contours nets = image floue). Simple indice : Claude juge aussi.
async function mesurerQualite(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const echelle = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * echelle);
  const h = Math.round(img.naturalHeight * echelle);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const gris = new Float32Array(w * h);
  let lumiere = 0;
  for (let i = 0; i < w * h; i++) {
    gris[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
    lumiere += gris[i];
  }
  let somme = 0;
  let sommeCarres = 0;
  let n = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gris[i] - gris[i - 1] - gris[i + 1] - gris[i - w] - gris[i + w];
      somme += lap;
      sommeCarres += lap * lap;
      n++;
    }
  }
  const variance = sommeCarres / n - (somme / n) ** 2;
  return { floue: variance < SEUIL_FLOU, sombre: lumiere / (w * h) < SEUIL_SOMBRE, variance };
}
const SEUIL_FLOU = 60;
const SEUIL_SOMBRE = 45;

async function miniatureDepuis(dataUrl, cote = 160) {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const echelle = cote / Math.max(img.naturalWidth, img.naturalHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * echelle);
  canvas.height = Math.round(img.naturalHeight * echelle);
  canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.6);
}

async function ajouterPhotos(fichiers) {
  for (const f of fichiers) {
    if (etat.photos.length >= maxPhotos()) {
      toast(`${maxPhotos()} photos maximum.`);
      break;
    }
    try {
      const apercu = await compresser(f);
      const qualite = await mesurerQualite(apercu).catch(() => ({}));
      etat.photos.push({ apercu, qualite, media_type: "image/jpeg", data: apercu.split(",")[1] });
      if (qualite.floue || qualite.sombre) {
        toast(
          `Cette photo semble ${qualite.floue ? "floue" : "trop sombre"} : reprends-la si tu peux, l'analyse sera plus fiable.`,
          true
        );
      }
    } catch {
      toast("Impossible de lire cette image.", true);
    }
  }
  afficherMiniatures();
}

function afficherMiniatures() {
  const zone = $("#miniatures");
  zone.innerHTML = etat.photos
    .map(
      (p, i) => `<div class="miniature"><img src="${p.apercu}" alt="Photo ${i + 1}">
        ${p.qualite?.floue ? `<span class="badge">floue ?</span>` : p.qualite?.sombre ? `<span class="badge">sombre</span>` : ""}
        <button type="button" data-retirer="${i}" aria-label="Retirer la photo ${i + 1}">×</button></div>`
    )
    .join("");
  zone.hidden = etat.photos.length === 0;
  $("#aide-photos").hidden = etat.photos.length === 0;
  $("#btn-analyser").disabled = etat.photos.length === 0;
  $(".btn-photo span").textContent = etat.photos.length ? "Ajouter une photo" : "Prendre une photo";
}

/* ---------- Analyse ---------- */

const ORDRE_ETAPES = ["envoi", "reflexion", "equipements", "schema", "configuration", "diagnostic", "etapes"];

function marquerEtape(nom) {
  const rang = ORDRE_ETAPES.indexOf(nom);
  if (rang < 0) return;
  document.querySelectorAll("#progression li").forEach((li) => {
    const r = ORDRE_ETAPES.indexOf(li.dataset.etape);
    li.classList.toggle("fait", r < rang);
    li.classList.toggle("en-cours", r === rang);
  });
}

async function lancerAnalyse() {
  if (!etat.photos.length) return;
  if (SUR_CLAUDE_AI && !etat.compteClaude) {
    toast("Connexion à ton compte Claude…");
    await connexionClaude;
    if (!etat.compteClaude) return toast(etat.messageCompteClaude, true);
  }
  const mode = modeAnalyse();
  if (!mode) {
    afficherReglages();
    toast("Ajoute d'abord ta clé API pour analyser tes photos.", true);
    return;
  }
  const contexte = $("#contexte").value.trim();
  const images = etat.photos.map(({ data, media_type }) => ({ data, media_type }));
  $("#scan-image").src = etat.photos[0].apercu;
  marquerEtape("envoi");
  afficherVue("chargement");

  try {
    const analyser = { serveur: analyserViaServeur, claude: analyserViaCompteClaude, navigateur: analyserDansNavigateur }[mode];
    const resultat = await analyser({ images, contexte, onEtape: marquerEtape });
    const vignette = await miniatureDepuis(etat.photos[0].apercu).catch(() => "");
    enregistrerHistorique({ resultat, contexte, vignette });
    afficherResultat(resultat);
  } catch (err) {
    afficherVue("accueil");
    toast(err.message || "L'analyse a échoué.", true);
  }
}

const maxPhotos = () => etat.compteClaude?.maxPhotos ?? MAX_PHOTOS;

// Mode claude.ai : les photos partent avec le compte Claude de la personne (aucune clé).
async function analyserViaCompteClaude({ images, contexte, onEtape }) {
  const fichiers = images.map(({ data, media_type }) => {
    const octets = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    return new Blob([octets], { type: media_type });
  });
  try {
    return await analyserAvecCompteClaude(etat.compteClaude.sample, { images: fichiers, contexte, onEtape });
  } catch (err) {
    throw new Error(messageErreurCompteClaude(err));
  }
}

// Mode serveur : le serveur Node appelle Claude et renvoie la progression en NDJSON.
async function analyserViaServeur({ images, contexte, onEtape }) {
  const reponse = await fetch("api/analyse", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, contexte }),
  });
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => ({}));
    throw new Error(corps.erreur || `Erreur du serveur (${reponse.status}).`);
  }

  let resultat = null;
  let tampon = "";
  const lecteur = reponse.body.pipeThrough(new TextDecoderStream()).getReader();
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) break;
    tampon += value;
    let fin;
    while ((fin = tampon.indexOf("\n")) >= 0) {
      const ligne = tampon.slice(0, fin).trim();
      tampon = tampon.slice(fin + 1);
      if (!ligne) continue;
      const msg = JSON.parse(ligne);
      if (msg.etape) onEtape(msg.etape);
      if (msg.erreur) throw new Error(msg.erreur);
      if (msg.resultat) resultat = msg.resultat;
    }
  }
  if (!resultat) throw new Error("La connexion a été coupée avant la fin de l'analyse.");
  return resultat;
}

// Mode navigateur (GitHub Pages) : l'appli appelle Claude directement avec la clé enregistrée ici.
let Anthropic;
async function analyserDansNavigateur({ images, contexte, onEtape }) {
  try {
    Anthropic ??= (await import(URL_SDK)).default;
  } catch {
    throw new Error("Impossible de charger le SDK Anthropic. Vérifie ta connexion Internet.");
  }
  const client = new Anthropic({ apiKey: lire(CLE_API), dangerouslyAllowBrowser: true });
  try {
    const { resultat } = await analyserAvec(client, { images, contexte, onEtape, modele: modeleChoisi() });
    return resultat;
  } catch (err) {
    throw new Error(messageErreur(err, Anthropic));
  }
}

async function lancerDemo() {
  $("#scan-image").src = "demo/exemple.svg";
  afficherVue("chargement");
  try {
    const reponse = await fetch("demo/exemple.json");
    const resultat = await reponse.json();
    for (const e of ORDRE_ETAPES) {
      marquerEtape(e);
      await new Promise((r) => setTimeout(r, 380));
    }
    afficherResultat(resultat, { demo: true });
  } catch {
    afficherVue("accueil");
    toast("Impossible de charger l'exemple.", true);
  }
}

/* ---------- Affichage du résultat ---------- */

const VERDICTS = {
  fonctionnel: { symbole: "✓", texte: "Ça fonctionne" },
  incomplet: { symbole: "!", texte: "Incomplet : il manque des éléments" },
  non_fonctionnel: { symbole: "✕", texte: "Ça ne fonctionne pas en l'état" },
  indeterminable: { symbole: "?", texte: "Impossible de conclure avec cette photo" },
};

const SOURCES_PORT = {
  visible: "vu sur la photo",
  fiche_technique: "fiche technique du modèle",
  config: "lu dans la config",
  deduit: "déduit",
};
const ETATS_PORT = { connecte: "câble branché", libre: "libre", inconnu: "inconnu" };
const SOURCES_CONFIG = {
  lue: ["Lue sur la photo", "ok"],
  proposee: ["Proposée par NetScan", "accent"],
  mixte: ["Lue + complétée par NetScan", "warn"],
  aucune: ["Aucune configuration", ""],
};
const GRAVITES = { bloquant: ["Bloquant", "ko"], important: ["Important", "warn"], conseil: ["Conseil", "accent"] };

const DEFAUTS_PHOTO = {
  floue: "floue",
  sombre: "trop sombre",
  reflets: "reflets",
  trop_loin: "prise de trop loin",
  coupee: "équipement coupé",
  cables_emmeles: "câbles difficiles à suivre",
  angle: "mauvais angle",
};

function rendreQualite(q) {
  const el = $("#alerte-qualite");
  el.hidden = !q || q.niveau === "bonne";
  if (el.hidden) return;
  const insuffisante = q.niveau === "insuffisante";
  const defauts = (q.problemes ?? []).map((p) => DEFAUTS_PHOTO[p] ?? p).join(", ");
  el.className = `alerte-qualite ${q.niveau}`;
  el.innerHTML = `<div class="symbole" aria-hidden="true">📷</div>
    <div>
      <strong>${insuffisante ? "Photo inexploitable : impossible de conclure" : "Photo de qualité moyenne : analyse peut-être incomplète"}${defauts ? ` (${echapper(defauts)})` : ""}</strong>
      ${q.detail ? `<p>${echapper(q.detail)}</p>` : ""}
      ${q.conseil ? `<p><b>Conseil :</b> ${echapper(q.conseil)}</p>` : ""}
      <button type="button" class="btn-mini" id="btn-reprendre">Reprendre une photo</button>
    </div>`;
}

function afficherResultat(r, { demo = false } = {}) {
  etat.resultat = r;
  $("#bandeau-demo").hidden = !demo;
  $("#btn-demo-reglages").textContent = modeAnalyse() || SUR_CLAUDE_AI ? "Analyser ma photo" : "Ajouter ma clé API";
  rendreQualite(r.qualite_image);
  const d = r.diagnostic ?? { statut: "indeterminable", resume: "", problemes: [], verifications: [] };
  const statut = r.type_image === "hors_sujet" ? "indeterminable" : d.statut;
  const v = VERDICTS[statut] ?? VERDICTS.indeterminable;
  const nbBloquants = d.problemes.filter((p) => p.gravite === "bloquant").length;
  const nbImportants = d.problemes.filter((p) => p.gravite === "important").length;
  const sous = [
    nbBloquants && `${nbBloquants} problème${nbBloquants > 1 ? "s" : ""} bloquant${nbBloquants > 1 ? "s" : ""}`,
    nbImportants && `${nbImportants} important${nbImportants > 1 ? "s" : ""}`,
    r.configuration?.blocs?.length && SOURCES_CONFIG[r.configuration.source]?.[0],
  ].filter(Boolean);

  $("#verdict").className = `verdict ${statut}`;
  $("#verdict").innerHTML = `
    <div class="pastille" aria-hidden="true">${v.symbole}</div>
    <div>
      <div class="etiquette">${r.type_image === "hors_sujet" ? "Ce n'est pas un équipement réseau" : v.texte}</div>
      <p>${echapper(d.resume || r.resume)}</p>
      ${sous.length ? `<p class="sous">${echapper(sous.join(" · "))}</p>` : ""}
    </div>`;

  etat.schemaSimple = false;
  $("#onglet-schema").innerHTML = rendreSchema(r);
  $("#onglet-config").innerHTML = rendreConfig(r);
  $("#onglet-diagnostic").innerHTML = rendreDiagnostic(d);
  $("#onglet-etapes").innerHTML = rendreEtapes(r);
  etapesVisibles = 1;
  majEtapes();
  choisirOnglet("schema");
  afficherVue("resultat");
}

function rendreSchema(r) {
  let html = `<div class="carte">
    <h3>${echapper(r.titre)} <span class="chip">${echapper(libelleTypeImage(r.type_image))}</span></h3>
    <p class="muted">${echapper(r.resume)}</p>
  </div>`;

  if (r.equipements.length) {
    const complexe = schemaComplexe(r);
    const simple = complexe && etat.schemaSimple;
    html += `<div class="carte">
      <div class="entete-schema">
        <h3>Schéma réseau</h3>
        ${complexe ? `<button class="btn-mini" type="button" id="btn-simplifier" aria-pressed="${simple}">${simple ? "Voir le détail" : "Simplifier le schéma"}</button>` : ""}
      </div>
      <div class="defile">${dessinerTopologie(r, { simple })}</div>
      ${simple ? `<p class="note-schema">Vue simplifiée : les postes identiques sont regroupés et les noms de ports sont masqués.</p>` : ""}
      <div class="legende">
        <span><i></i>câble observé</span>
        <span><i class="deduit"></i>déduit</span>
        <span><i class="propose"></i>à ajouter</span>
        <span><i class="console"></i>console</span>
      </div>
    </div>`;
  }

  r.equipements.forEach((e, i) => {
    const conf = { haute: "ok", moyenne: "warn", faible: "ko" }[e.confiance] ?? "";
    html += `<div class="carte" id="equipement-${i}">
      <div class="equipement-entete">
        <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true">${icone(e.type, 48)}</svg>
        <div>
          <h3>${echapper(e.id)} · ${echapper(e.nom)}</h3>
          <span class="chip">${echapper(NOMS_TYPE[e.type] ?? e.type)}</span>
          <span class="chip ${conf}">confiance ${echapper(e.confiance)}</span>
        </div>
      </div>
      ${e.role ? `<p class="muted">${echapper(e.role)}</p>` : ""}
      ${
        e.ports.length
          ? `<div class="defile">${dessinerFacade(e, i)}</div>
             <div class="detail-port" id="detail-port-${i}">Touche un port pour voir son détail.</div>
             <details><summary>Liste des ${e.ports.length} ports</summary>
               <div class="defile"><table>
                 <thead><tr><th>Port</th><th>État</th><th>Détail</th><th>Source</th></tr></thead>
                 <tbody>${e.ports
                   .map(
                     (p) => `<tr><td><strong>${echapper(p.nom)}</strong></td><td>${echapper(ETATS_PORT[p.etat] ?? p.etat)}</td>
                       <td>${echapper(p.detail || "—")}</td><td class="muted">${echapper(SOURCES_PORT[p.source] ?? p.source)}</td></tr>`
                   )
                   .join("")}</tbody>
               </table></div>
             </details>`
          : `<p class="muted">Aucun port visible ou identifiable sur la photo.</p>`
      }
    </div>`;
  });
  return html;
}

function libelleTypeImage(type) {
  return {
    equipement_physique: "Photo d'équipement",
    ecran_configuration: "Écran de configuration",
    schema_topologie: "Schéma de topologie",
    mixte: "Photo mixte",
    hors_sujet: "Hors sujet",
  }[type] ?? type;
}

function rendreConfig(r) {
  const c = r.configuration;
  if (!c?.blocs?.length) {
    return `<div class="carte"><h3>Pas de configuration</h3>
      <p class="muted">Aucune configuration n'est lisible ou ne peut être proposée à partir de cette photo. Ajoute une photo de l'écran (show running-config) ou une consigne.</p></div>`;
  }
  const [libelle, couleur] = SOURCES_CONFIG[c.source] ?? [c.source, ""];
  const parEquipement = new Map();
  for (const b of c.blocs) {
    if (!parEquipement.has(b.equipement)) parEquipement.set(b.equipement, []);
    parEquipement.get(b.equipement).push(b);
  }

  let html = `<p><span class="chip ${couleur}">${echapper(libelle)}</span> <span class="muted">${echapper(c.systeme)}</span></p>`;
  for (const [id, blocs] of parEquipement) {
    const eq = r.equipements.find((e) => e.id === id);
    const tout = blocs.map((b) => b.commandes).join("\n!\n");
    html += `<div class="carte">
      <h3>${echapper(id)}${eq ? ` · <span class="muted">${echapper(eq.nom)}</span>` : ""}</h3>
      <button class="btn-secondaire" type="button" data-copier="${echapper(tout)}">Copier toute la config de ${echapper(id)}</button>
      ${blocs
        .map(
          (b) => `<div class="bloc-config">
            <h4>${echapper(b.titre)}</h4>
            <div class="code"><button class="copier" type="button" data-copier="${echapper(b.commandes)}">Copier</button><pre><code>${colorerCommandes(b.commandes)}</code></pre></div>
            <p class="muted">${echapper(b.explication)}</p>
          </div>`
        )
        .join("")}
    </div>`;
  }
  return html;
}

function rendreDiagnostic(d) {
  const ordre = { bloquant: 0, important: 1, conseil: 2 };
  const problemes = [...d.problemes].sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);
  let html = "";
  if (!problemes.length) {
    html += `<div class="carte ok-vide">${
      d.statut === "fonctionnel" ? "Rien ne manque : tout est en place." : "Aucun problème détecté sur ce qui est visible."
    }</div>`;
  } else {
    html += `<h2>Ce qui manque ou ce qui est faux</h2>`;
    for (const p of problemes) {
      const [libelle, couleur] = GRAVITES[p.gravite] ?? [p.gravite, ""];
      html += `<div class="carte probleme ${p.gravite}">
        <h3>${echapper(p.titre)} <span class="chip ${couleur}">${libelle}</span></h3>
        ${p.concerne?.length ? `<p class="muted">Concerne : ${echapper(p.concerne.join(", "))}</p>` : ""}
        <p>${echapper(p.explication)}</p>
        ${p.correction ? `<div class="code"><button class="copier" type="button" data-copier="${echapper(p.correction)}">Copier</button><pre><code>${colorerCommandes(p.correction)}</code></pre></div>` : ""}
      </div>`;
    }
  }
  if (d.verifications.length) {
    html += `<h2>Pour vérifier que ça marche</h2><div class="carte">${d.verifications
      .map(
        (v) => `<div class="bloc-config">
          <h4>Sur ${echapper(v.equipement)}</h4>
          <div class="code"><button class="copier" type="button" data-copier="${echapper(v.commande)}">Copier</button><pre><code>${colorerCommandes(v.commande)}</code></pre></div>
          <p class="muted">Attendu : ${echapper(v.attendu)}</p>
        </div>`
      )
      .join("")}</div>`;
  }
  return html;
}

let etapesVisibles = 1;

function rendreEtapes(r) {
  const etapes = r.etapes ?? [];
  return `<ol class="etapes">${etapes
    .map((e, i) => `<li class="etape" data-i="${i}"><h3>${echapper(e.titre)}</h3><p class="muted">${echapper(e.detail)}</p></li>`)
    .join("")}</ol>
    <div class="actions-etapes">
      <button class="btn-secondaire" type="button" id="btn-etape-suivante">Étape suivante</button>
      <button class="btn-secondaire" type="button" id="btn-toutes-etapes">Tout afficher</button>
    </div>
    ${r.limites ? `<div class="carte" style="margin-top:16px"><h3>Limites de l'analyse</h3><p class="muted">${echapper(r.limites)}</p></div>` : ""}`;
}

function majEtapes() {
  const items = document.querySelectorAll("#onglet-etapes .etape");
  items.forEach((li, i) => (li.hidden = i >= etapesVisibles));
  const fini = etapesVisibles >= items.length;
  const actions = $("#onglet-etapes .actions-etapes");
  if (actions) actions.hidden = fini;
}

function choisirOnglet(nom) {
  document.querySelectorAll(".onglets button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.onglet === nom)));
  for (const o of ["schema", "config", "diagnostic", "etapes"]) $(`#onglet-${o}`).hidden = o !== nom;
}

function afficherDetailPort(iEq, iPort) {
  const e = etat.resultat?.equipements[iEq];
  const p = e?.ports[iPort];
  if (!p) return;
  document.querySelectorAll(`#equipement-${iEq} .port`).forEach((g) => g.classList.toggle("actif", g.dataset.port === String(iPort)));
  const liens = etat.resultat.liens.filter(
    (l) => (l.de === e.id && l.port_de === p.nom) || (l.vers === e.id && l.port_vers === p.nom)
  );
  const relie = liens
    .map((l) => (l.de === e.id ? `${l.vers} ${l.port_vers}` : `${l.de} ${l.port_de}`).trim())
    .join(", ");
  $(`#detail-port-${iEq}`).innerHTML = `<strong>${echapper(p.nom)}</strong> · ${echapper(ETATS_PORT[p.etat] ?? p.etat)}
    ${p.detail ? `<br>${echapper(p.detail)}` : ""}
    ${relie ? `<br>Relié à : ${echapper(relie)}` : ""}
    <br><span class="muted">Source : ${echapper(SOURCES_PORT[p.source] ?? p.source)}</span>`;
}

/* ---------- Historique (stocké dans le navigateur) ---------- */

function lireHistorique() {
  try {
    return JSON.parse(localStorage.getItem(CLE_HISTORIQUE)) ?? [];
  } catch {
    return [];
  }
}

function enregistrerHistorique({ resultat, contexte, vignette }) {
  const liste = [
    { id: Date.now(), date: new Date().toISOString(), titre: resultat.titre, statut: resultat.diagnostic?.statut, vignette, contexte, resultat },
    ...lireHistorique(),
  ].slice(0, 15);
  // Si le stockage est plein, on retire les plus anciennes analyses.
  while (liste.length) {
    try {
      localStorage.setItem(CLE_HISTORIQUE, JSON.stringify(liste));
      return;
    } catch {
      liste.pop();
    }
  }
}

function afficherHistorique() {
  const liste = lireHistorique();
  $("#liste-historique").innerHTML = liste.length
    ? liste
        .map(
          (h) => `<button class="item-historique" type="button" data-historique="${h.id}">
            ${h.vignette ? `<img src="${h.vignette}" alt="">` : `<span class="vignette"></span>`}
            <span><strong>${echapper(h.titre)}</strong>
            <span class="muted">${new Date(h.date).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })} · ${echapper(
              VERDICTS[h.statut]?.texte ?? ""
            )}</span></span>
          </button>`
        )
        .join("")
    : `<p class="muted">Aucune analyse pour l'instant. Tes analyses sont gardées sur cet appareil.</p>`;
  afficherVue("historique");
}

/* ---------- Événements ---------- */

for (const id of ["#input-camera", "#input-galerie"]) {
  $(id).addEventListener("change", async (e) => {
    await ajouterPhotos([...e.target.files]);
    e.target.value = "";
  });
}

$("#miniatures").addEventListener("click", (e) => {
  const i = e.target.dataset.retirer;
  if (i === undefined) return;
  etat.photos.splice(Number(i), 1);
  afficherMiniatures();
});

$("#btn-analyser").addEventListener("click", lancerAnalyse);
$("#btn-demo").addEventListener("click", lancerDemo);
$("#btn-accueil").addEventListener("click", () => afficherVue("accueil"));
$("#btn-historique").addEventListener("click", afficherHistorique);
$("#btn-nouvelle").addEventListener("click", () => {
  etat.photos = [];
  $("#contexte").value = "";
  afficherMiniatures();
  afficherVue("accueil");
});

document.querySelector(".onglets").addEventListener("click", (e) => {
  if (e.target.dataset.onglet) choisirOnglet(e.target.dataset.onglet);
});

$("#liste-historique").addEventListener("click", (e) => {
  const item = e.target.closest("[data-historique]");
  const h = item && lireHistorique().find((x) => String(x.id) === item.dataset.historique);
  if (h) afficherResultat(h.resultat);
});

$("#vue-resultat").addEventListener("click", async (e) => {
  const copier = e.target.closest("[data-copier]");
  if (copier) {
    try {
      await navigator.clipboard.writeText(copier.dataset.copier);
      toast("Copié !");
    } catch {
      toast("Copie impossible sur cet appareil.", true);
    }
    return;
  }
  const port = e.target.closest(".port");
  if (port) return afficherDetailPort(Number(port.dataset.eq), Number(port.dataset.port));

  const noeud = e.target.closest(".noeud");
  if (noeud) {
    const i = etat.resultat.equipements.findIndex((x) => x.id === noeud.dataset.id);
    if (i >= 0) document.getElementById(`equipement-${i}`).scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (e.target.id === "btn-reprendre") return afficherVue("accueil");
  if (e.target.id === "btn-demo-reglages") return modeAnalyse() || SUR_CLAUDE_AI ? afficherVue("accueil") : afficherReglages();
  if (e.target.id === "btn-simplifier") {
    etat.schemaSimple = !etat.schemaSimple;
    const defilement = window.scrollY;
    $("#onglet-schema").innerHTML = rendreSchema(etat.resultat);
    window.scrollTo({ top: defilement });
    return;
  }
  if (e.target.id === "btn-etape-suivante") {
    etapesVisibles++;
    majEtapes();
  }
  if (e.target.id === "btn-toutes-etapes") {
    etapesVisibles = Infinity;
    majEtapes();
  }
});

// Clavier : Entrée ou Espace sur un port ou un équipement du schéma.
$("#vue-resultat").addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && e.target.closest(".port, .noeud")) {
    e.preventDefault();
    e.target.closest(".port, .noeud").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }
});

/* ---------- Réglages ---------- */

function afficherReglages() {
  const surClaude = SUR_CLAUDE_AI;
  $("#etat-compte").textContent = etat.compteClaude ? `Connecté · ${maxPhotos()} photos max par analyse.` : etat.messageCompteClaude;
  $("#carte-compte").hidden = !surClaude;
  $("#carte-cle").hidden = surClaude;
  $("#carte-modele").hidden = surClaude;
  $("#cle-api").value = "";
  $("#choix-modele").value = modeleChoisi();
  majEtatCle();
  afficherVue("reglages");
}

function majEtatCle() {
  const cle = lire(CLE_API);
  $("#etat-cle").textContent = cle
    ? `Clé enregistrée sur cet appareil (…${cle.slice(-4)}).`
    : etat.serveur.cle
      ? "Pas de clé sur cet appareil : c'est la clé du serveur qui est utilisée."
      : "Aucune clé enregistrée.";
  majStatut();
}

function majStatut() {
  const el = $("#statut-api");
  const mode = modeAnalyse();
  if (mode === "serveur") {
    el.textContent = `Analyse par le serveur (${etat.serveur.modele}).`;
  } else if (mode === "claude") {
    el.textContent = `Analyse avec ton compte Claude, sans clé API · ${maxPhotos()} photos max.`;
  } else if (SUR_CLAUDE_AI) {
    el.textContent = etat.messageCompteClaude;
  } else if (mode === "navigateur") {
    el.textContent = `Clé API enregistrée sur cet appareil · ${$("#choix-modele").selectedOptions[0].text.split(" —")[0]}`;
  } else {
    el.innerHTML = `Pour analyser tes photos, <button type="button" class="lien-texte" id="lien-reglages">ajoute ta clé API</button>. L'exemple fonctionne sans.`;
  }
}

$("#btn-reglages").addEventListener("click", afficherReglages);
$("#statut-api").addEventListener("click", (e) => {
  if (e.target.id === "lien-reglages") afficherReglages();
});

$("#btn-enregistrer-cle").addEventListener("click", () => {
  const cle = $("#cle-api").value.trim();
  if (!cle) return toast("Colle d'abord ta clé dans le champ.", true);
  if (!cle.startsWith("sk-ant-")) return toast("Une clé Anthropic commence par « sk-ant- ».", true);
  if (!ecrire(CLE_API, cle)) return toast("Impossible d'enregistrer la clé (navigation privée ?).", true);
  $("#cle-api").value = "";
  majEtatCle();
  toast("Clé enregistrée sur cet appareil.");
});

$("#btn-supprimer-cle").addEventListener("click", () => {
  ecrire(CLE_API, "");
  majEtatCle();
  toast("Clé supprimée de cet appareil.");
});

$("#choix-modele").addEventListener("change", (e) => {
  ecrire(CLE_MODELE, e.target.value);
  majStatut();
});

$("#choix-modele").value = modeleChoisi();
majStatut();

// Sur GitHub Pages il n'y a pas de serveur : cette requête échoue et on reste en mode navigateur.
fetch("api/statut")
  .then((r) => (r.ok ? r.json() : null))
  .then((statut) => {
    if (statut) etat.serveur = { cle: statut.cle_configuree, modele: statut.modele };
    majStatut();
  })
  .catch(() => {});

// Sur claude.ai, la page demande à Claude d'analyser les photos avec le compte de la personne.
const connexionClaude = SUR_CLAUDE_AI ? connecterCompteClaude() : Promise.resolve();

async function connecterCompteClaude() {
  try {
    const sample = await window.claude.use("sample");
    if (!sample) {
      etat.messageCompteClaude =
        "Cette page n'a pas accès à ton compte Claude ici. Ouvre-la depuis claude.ai en étant connecté.";
    } else {
      const limites = await sample.limits().catch(() => null);
      if (!limites?.images) {
        etat.messageCompteClaude =
          "Ici, Claude ne peut pas recevoir de photos. Ouvre la page sur claude.ai dans un navigateur (Chrome, Safari…).";
      } else {
        etat.compteClaude = { sample, maxPhotos: Math.min(MAX_PHOTOS, limites.images.maxCount) };
        $("#aide-photos").textContent = `Tu peux ajouter jusqu'à ${maxPhotos()} photos : la façade de chaque équipement, l'arrière, l'écran de config, le schéma du TP…`;
      }
    }
  } catch {
    etat.messageCompteClaude = "Impossible de se connecter à ton compte Claude. Recharge la page.";
  }
  majStatut();
}

if ("serviceWorker" in navigator && window.isSecureContext && !window.claude) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
