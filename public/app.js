import {
  echapper,
  icone,
  NOMS_TYPE,
  dessinerTopologie,
  dessinerFacade,
  colorerCommandes,
  schemaComplexe,
  rendreGuideSchema,
  rendreConnexions,
} from "./rendu.js";
import {
  MAX_PHOTOS,
  MAX_CONFIG,
  MODELE_PAR_DEFAUT,
  analyserAvec,
  messageErreur,
  nettoyerMateriel,
  analyserAvecCompteClaude,
  messageErreurCompteClaude,
} from "./coeur.js";
import { URL_RELAIS } from "./config.js";
import { initialiserCalcul } from "./ecran-calcul.js";
import { construireRapportHtml, exporterWord } from "./rapport.js";

const $ = (sel) => document.querySelector(sel);
const CLE_HISTORIQUE = "netscan.historique";
const CLE_API = "netscan.cleApi";
const CLE_MODELE = "netscan.modele";
const CLE_MATERIEL = "netscan.materiel";
const CLE_CODE = "netscan.codeAcces";
const CLE_CREDIT = "netscan.credit"; // code NetScan NS-… d'un pack acheté
const CLE_EXPORT = "netscan.export"; // nom et classe, pour ne pas les retaper à chaque compte rendu
const RACCOURCIS_MATERIEL = [
  "Routeur Cisco 1841",
  "Routeur Cisco 2911",
  "Switch Cisco Catalyst 2960",
  "Switch Cisco SF300-24",
  "PC",
  "Câble droit RJ45",
  "Câble croisé RJ45",
  "Câble console",
  "Câble série DCE/DTE",
  "Panneau de brassage",
  "Point d'accès Wi-Fi",
];
// SDK officiel d'Anthropic, chargé seulement si l'analyse se fait depuis le navigateur.
const URL_SDK = "https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm";

const etat = {
  photos: [], // { data, media_type, apercu }
  resultat: null,
  schemaSimple: false,
  vueSchema: "actuel", // "actuel" (ce qui est branché) ou "conseille" (schéma proposé par NetScan)
  serveur: { cle: false, modele: "" }, // ce que dit /api/statut (absent sur GitHub Pages)
  compte: null, // ce que dit le relais : { pack, essais_restants, paiement_actif, credit? }
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
// "relais" si un code d'accès est enregistré : le relais NetScan prête sa clé.
function modeAnalyse() {
  if (etat.serveur.cle) return "serveur";
  if (etat.compteClaude) return "claude";
  if (lire(CLE_API)) return "navigateur";
  // Le relais sert aussi sans code : essais gratuits, puis packs d'analyses achetés.
  if (URL_RELAIS && !SUR_CLAUDE_AI) return "relais";
  return null;
}

/* ---------- Navigation entre les vues ---------- */

function afficherVue(nom) {
  for (const v of ["accueil", "chargement", "resultat", "historique", "reglages", "calcul"]) {
    $(`#vue-${v}`).hidden = v !== nom;
  }
  // La navigation indique où l'on est (un résultat ou une analyse en cours restent sous « Analyser »).
  const onglet = ["historique", "reglages", "calcul"].includes(nom) ? nom : "accueil";
  document.querySelectorAll(".navigation [data-nav]").forEach((b) => {
    if (b.dataset.nav === onglet) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  window.scrollTo({ top: 0 });
}

function toast(message, erreur = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("erreur", erreur);
  el.hidden = false;
  clearTimeout(toast.minuteur);
  toast.minuteur = setTimeout(() => (el.hidden = true), Math.max(erreur ? 6000 : 2500, message.length * 50));
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
  majBoutonAnalyser();
  $(".btn-photo span").textContent = etat.photos.length ? "Ajouter une photo" : "Prendre une photo";
  majBoutonAnalyser();
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

// On peut analyser des photos, ou seulement une description écrite de l'installation.
function majBoutonAnalyser() {
  const vide = etat.photos.length === 0 && !$("#contexte").value.trim() && !$("#config-texte").value.trim();
  $("#btn-analyser").disabled = vide;
  const n = etat.photos.length;
  $("#btn-analyser").textContent = n ? `Analyser ${n > 1 ? `les ${n} photos` : "la photo"}` : "Analyser";
  $("#indice-analyser").hidden = !vide;
  $(".zone-analyser").classList.toggle("prete", !vide);
}

function majTailleConfig() {
  const n = $("#config-texte").value.trim().split("\n").filter((l) => l.trim()).length;
  $("#taille-config").textContent = n ? `${n} ligne${n > 1 ? "s" : ""}` : "vide";
  majBoutonAnalyser();
}

const TEXTE_SANS_PHOTO =
  "Ici, claude.ai ne permet pas d'envoyer des photos à Claude. Décris ton installation dans la consigne (équipements, câbles, ports, config) : NetScan l'analysera à partir du texte.";

async function lancerAnalyse() {
  const contexteSaisi = $("#contexte").value.trim();
  const configTexte = $("#config-texte").value.trim().slice(0, MAX_CONFIG);
  if (!etat.photos.length && !contexteSaisi && !configTexte) return;
  if (SUR_CLAUDE_AI && !etat.compteClaude) {
    toast("Connexion à ton compte Claude…");
    await connexionClaude;
    if (!etat.compteClaude) return toast(etat.messageCompteClaude, true);
  }
  const mode = modeAnalyse();
  if (!mode) {
    afficherReglages();
    toast(URL_RELAIS ? "Entre le code d'accès NetScan ou ta clé API pour analyser." : "Pour analyser sans clé, ouvre NetScan sur claude.ai.", true);
    return;
  }
  const contexte = $("#contexte").value.trim();
  const materiel = $("#utiliser-materiel").checked ? lireMateriel() : [];
  let images = etat.photos.map(({ data, media_type }) => ({ data, media_type }));
  if (mode === "claude" && etat.compteClaude.sansPhotos && images.length) {
    if (!contexte && !configTexte) {
      $("#contexte").focus();
      return toast(TEXTE_SANS_PHOTO, true);
    }
    images = [];
    toast("Les photos ne peuvent pas être envoyées ici : analyse à partir de ta description.");
  }
  $("#scan-image").src = images.length ? etat.photos[0].apercu : "demo/exemple.svg";
  marquerEtape("envoi");
  afficherVue("chargement");

  try {
    const analyser = {
      serveur: analyserViaServeur,
      relais: analyserViaRelais,
      claude: analyserViaCompteClaude,
      navigateur: analyserDansNavigateur,
    }[mode];
    const resultat = await analyser({ images, contexte, materiel, configTexte, onEtape: marquerEtape });
    const vignette = images.length ? await miniatureDepuis(etat.photos[0].apercu).catch(() => "") : "";
    enregistrerHistorique({ resultat, contexte, vignette });
    afficherResultat(resultat, { photos: images.length ? etat.photos.map((p) => p.apercu) : [] });
  } catch (err) {
    afficherVue("accueil");
    toast(err.message || "L'analyse a échoué.", true);
  }
}

const maxPhotos = () => etat.compteClaude?.maxPhotos ?? MAX_PHOTOS;

// Mode claude.ai : les photos partent avec le compte Claude de la personne (aucune clé).
async function analyserViaCompteClaude({ images, contexte, materiel, configTexte, onEtape }) {
  const fichiers = images.map(({ data, media_type }) => {
    const octets = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    return new Blob([octets], { type: media_type });
  });
  try {
    return await analyserAvecCompteClaude(etat.compteClaude.sample, { images: fichiers, contexte, materiel, configTexte, onEtape });
  } catch (err) {
    // claude.ai refuse les photos dans cette vue : on retient l'info et on repart du texte si possible.
    if (err?.code === "images_unavailable") {
      etat.compteClaude.sansPhotos = true;
      majStatut();
      if (contexte || configTexte) {
        toast("Les photos ne peuvent pas être envoyées ici : analyse à partir de ton texte.");
        try {
          return await analyserAvecCompteClaude(etat.compteClaude.sample, { images: [], contexte, materiel, configTexte, onEtape });
        } catch (err2) {
          throw new Error(messageErreurCompteClaude(err2));
        }
      }
      $("#contexte").focus();
      throw new Error(TEXTE_SANS_PHOTO);
    }
    throw new Error(messageErreurCompteClaude(err));
  }
}

// Mode serveur : le serveur Node appelle Claude et renvoie la progression en NDJSON.
const analyserViaServeur = ({ images, contexte, materiel, configTexte, onEtape }) =>
  analyserEnFlux("api/analyse", { images, contexte, materiel, configTexte }, onEtape);

// Mode relais : même format, mais c'est le relais Cloudflare qui détient la clé.
async function analyserViaRelais({ images, contexte, materiel, configTexte, onEtape }) {
  try {
    const corps = { images, contexte, materiel, configTexte };
    if (lire(CLE_CODE)) corps.code = lire(CLE_CODE);
    else if (lire(CLE_CREDIT)) corps.credit = lire(CLE_CREDIT);
    return await analyserEnFlux(`${URL_RELAIS}/analyse`, corps, onEtape);
  } catch (err) {
    if (err.statut === 402) {
      // Plus d'analyses : on ouvre directement l'achat.
      setTimeout(afficherReglages, 0);
      throw err;
    }
    if (err.statut === 401) {
      ecrire(CLE_CODE, "");
      majStatut();
      throw new Error("Code d'accès incorrect ou changé : entre le nouveau code dans les Réglages.");
    }
    if (err instanceof TypeError) throw new Error("Impossible de joindre le relais NetScan. Vérifie ta connexion Internet.");
    throw err;
  }
}

async function analyserEnFlux(url, corpsRequete, onEtape) {
  const reponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpsRequete),
  });
  if (!reponse.ok) {
    const corps = await reponse.json().catch(() => ({}));
    throw Object.assign(new Error(corps.erreur || `Erreur du serveur (${reponse.status}).`), { statut: reponse.status });
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
      if (msg.compte) majCompteApresAnalyse(msg.compte);
    }
  }
  if (!resultat) throw new Error("La connexion a été coupée avant la fin de l'analyse.");
  return resultat;
}

// Mode navigateur (GitHub Pages) : l'appli appelle Claude directement avec la clé enregistrée ici.
let Anthropic;
async function analyserDansNavigateur({ images, contexte, materiel, configTexte, onEtape }) {
  try {
    Anthropic ??= (await import(URL_SDK)).default;
  } catch {
    throw new Error("Impossible de charger le SDK Anthropic. Vérifie ta connexion Internet.");
  }
  const client = new Anthropic({ apiKey: lire(CLE_API), dangerouslyAllowBrowser: true });
  try {
    const { resultat } = await analyserAvec(client, { images, contexte, materiel, configTexte, onEtape, modele: modeleChoisi() });
    return resultat;
  } catch (err) {
    throw new Error(messageErreur(err, Anthropic));
  }
}

// Exemple (Playground) : une vraie photo déjà analysée, affichée tout de suite, sans appel à Claude.
const EXEMPLE = {
  photo: "playground/baie-brassage.jpg",
  credit: `Photo : <a href="https://commons.wikimedia.org/wiki/File:19-inch_rackmount_Ethernet_switches_and_patch_panels.jpg" target="_blank" rel="noopener">Dsimic</a>, licence <a href="https://creativecommons.org/licenses/by-sa/4.0/deed.fr" target="_blank" rel="noopener">CC BY-SA 4.0</a>, Wikimedia Commons`,
};

// Si l'appli a gardé de vieux fichiers en cache avec de nouveaux, certaines pages plantent sans
// raison apparente. On vide alors les caches et le service worker, puis on recharge, une seule fois.
async function reparerAppli(raison) {
  console.error("NetScan : réparation de l'appli", raison);
  try {
    if (sessionStorage.getItem("netscan.reparee")) return false;
    sessionStorage.setItem("netscan.reparee", "1");
    for (const reg of await navigator.serviceWorker?.getRegistrations?.() ?? []) await reg.unregister();
    for (const cle of await caches.keys()) await caches.delete(cle);
    location.reload();
    return true;
  } catch {
    return false;
  }
}

async function lancerDemo() {
  let resultat;
  try {
    const reponse = await fetch("playground/analyse.json", { cache: "no-cache" });
    if (!reponse.ok) throw new Error(`le serveur répond ${reponse.status}`);
    resultat = await reponse.json();
  } catch (err) {
    console.error(err);
    toast(`L'exemple n'a pas pu être téléchargé (${err.message}). Réessaie dans un instant.`, true);
    return;
  }
  try {
    afficherResultat(resultat, { demo: true, photos: [EXEMPLE.photo], credit: EXEMPLE.credit });
  } catch (err) {
    // Le fichier est bien arrivé : le problème vient de l'appli, pas de la connexion.
    console.error(err);
    if (await reparerAppli(err)) return toast("Mise à jour de l'appli en cours…");
    toast(`L'exemple n'a pas pu s'afficher (${err.message}). Recharge la page avec Ctrl + Maj + R.`, true);
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
  el.innerHTML = `<svg class="symbole" viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
    <div>
      <strong>${insuffisante ? "Photo inexploitable : impossible de conclure" : "Photo de qualité moyenne : analyse peut-être incomplète"}${defauts ? ` (${echapper(defauts)})` : ""}</strong>
      ${q.detail ? `<p>${echapper(q.detail)}</p>` : ""}
      ${q.conseil ? `<p><b>Conseil :</b> ${echapper(q.conseil)}</p>` : ""}
      <button type="button" class="btn-mini" id="btn-reprendre">Reprendre une photo</button>
    </div>`;
}

function afficherResultat(r, { demo = false, photos = [], credit = "" } = {}) {
  etat.resultat = r;
  etat.photosResultat = { photos, credit };
  preparerExport(r);
  $("#bandeau-demo").hidden = !demo;
  $("#btn-demo-reglages").textContent = modeAnalyse() || SUR_CLAUDE_AI ? "Analyser ma photo" : "Analyser mes photos";
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
  etat.vueSchema = "actuel";
  $("#onglet-schema").innerHTML = rendreSchema(r);
  $("#onglet-config").innerHTML = rendreConfig(r);
  $("#onglet-diagnostic").innerHTML = rendreMaterielAPrevoir(r.materiel_a_prevoir) + rendreDiagnostic(d);
  $("#onglet-etapes").innerHTML = rendreEtapes(r);
  etapesVisibles = 1;
  majEtapes();
  choisirOnglet("schema");
  afficherVue("resultat");
}

function rendrePhotosAnalysees() {
  const { photos = [], credit = "" } = etat.photosResultat ?? {};
  if (!photos.length) return "";
  return `<div class="carte panneau-photo">
    <div class="panneau-entete"><h3>Photo analysée</h3>${photos.length > 1 ? `<span class="chip">${photos.length} photos</span>` : ""}</div>
    <div class="photos-analysees">${photos.map((p, i) => `<img src="${p}" alt="Photo analysée ${i + 1}">`).join("")}</div>
    ${credit ? `<p class="credit">${credit}</p>` : ""}
  </div>`;
}

function rendreSchema(r) {
  let html = rendrePhotosAnalysees() + `<div class="carte">
    <h3>${echapper(r.titre)} <span class="chip">${echapper(libelleTypeImage(r.type_image))}</span></h3>
    <p class="muted">${echapper(r.resume)}</p>
    ${equipementsReels(r).length ? `<button class="btn-mini" type="button" id="btn-ajouter-vus">Ajouter ces équipements à mon matériel</button>` : ""}
  </div>`;

  const conseil = r.schema_propose;
  if (conseil?.liens?.length) {
    html += `<div class="bascule-schema" role="group" aria-label="Schéma affiché">
      <button type="button" data-vue="actuel" aria-pressed="${etat.vueSchema === "actuel"}">Ce qui est branché</button>
      <button type="button" data-vue="conseille" aria-pressed="${etat.vueSchema === "conseille"}">✓ Schéma conseillé</button>
    </div>`;
    if (etat.vueSchema === "conseille") return html + rendreSchemaConseille(conseil) + rendreCartesEquipements(r);
  }

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
      ${rendreGuideSchema(r)}
    </div>
    ${rendreConnexions(r)}`;
  }
  return html + rendreCartesEquipements(r);
}

// Le schéma conseillé : même dessin, câbles en vert, avec le pourquoi et les changements à faire.
function rendreSchemaConseille(sp) {
  const vue = {
    equipements: sp.equipements.map((e) => ({ ports: [], ...e })),
    liens: sp.liens.map((l) => ({ ...l, certitude: "conseille" })),
    diagnostic: { problemes: [] },
  };
  return `<div class="carte">
      <h3>Schéma conseillé</h3>
      ${sp.objectif ? `<p class="muted">Objectif : ${echapper(sp.objectif)}</p>` : ""}
      <div class="defile">${dessinerTopologie(vue)}</div>
      ${rendreGuideSchema(vue)}
    </div>
    ${sp.avantages.length ? `<div class="carte"><h3>Pourquoi c'est mieux</h3><ul class="avantages">${sp.avantages.map((a) => `<li>${echapper(a)}</li>`).join("")}</ul></div>` : ""}
    ${sp.changements.length ? `<div class="carte"><h3>Ce qu'il faut changer</h3><ol class="changements">${sp.changements.map((c) => `<li>${echapper(c)}</li>`).join("")}</ol></div>` : ""}
    ${rendreConnexions(vue)}`;
}

function rendreCartesEquipements(r) {
  let html = "";
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

function rendreMaterielAPrevoir(liste = []) {
  if (!liste.length) return "";
  return `<h2>Matériel à prévoir</h2>
    <div class="carte"><ul class="a-prevoir">${liste
      .map(
        (m) => `<li><strong>${echapper(m.quantite || "1")} × ${echapper(m.element)}</strong><br>
          <span class="muted">${echapper(m.raison)}</span></li>`
      )
      .join("")}</ul></div>`;
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
$("#contexte").addEventListener("input", majBoutonAnalyser);
$("#config-texte").addEventListener("input", majTailleConfig);
$("#btn-vider-config").addEventListener("click", () => {
  $("#config-texte").value = "";
  majTailleConfig();
});
$("#fichier-config").addEventListener("change", async (e) => {
  const fichier = e.target.files[0];
  e.target.value = "";
  if (!fichier) return;
  if (fichier.size > 2_000_000) return toast("Fichier trop gros : colle seulement la configuration utile.", true);
  const texte = await fichier.text();
  const zone = $("#config-texte");
  zone.value = (zone.value.trim() ? `${zone.value.trim()}\n\n` : "") + texte.trim();
  if (zone.value.length > MAX_CONFIG) toast(`Seuls les ${MAX_CONFIG.toLocaleString("fr-FR")} premiers caractères seront analysés.`);
  majTailleConfig();
});
$("#btn-demo").addEventListener("click", lancerDemo);
$("#btn-exemple-rapide").addEventListener("click", lancerDemo);
$("#btn-accueil").addEventListener("click", () => afficherVue("accueil"));
$("#btn-nav-accueil").addEventListener("click", () => afficherVue(etat.resultat && !$("#vue-resultat").hidden ? "resultat" : "accueil"));


$("#btn-historique").addEventListener("click", afficherHistorique);
$("#btn-calcul").addEventListener("click", () => afficherVue("calcul"));

// Thème : sombre par défaut ; le clair est retenu sur l'appareil.
function majBoutonTheme() {
  const clair = document.documentElement.dataset.theme === "light";
  $("#btn-theme").setAttribute("aria-label", clair ? "Passer en thème sombre" : "Passer en thème clair");
}
$("#btn-theme").addEventListener("click", () => {
  const clair = document.documentElement.dataset.theme !== "light";
  if (clair) document.documentElement.dataset.theme = "light";
  else delete document.documentElement.dataset.theme;
  ecrire("netscan.theme", clair ? "light" : "");
  majBoutonTheme();

// Raccourci de l'appli installée (« Calcul IP ») : ./#calcul
if (location.hash === "#calcul") afficherVue("calcul");
});
majBoutonTheme();

/* ---------- Export du compte rendu ---------- */

function preparerExport(r) {
  const panneau = $("#panneau-export");
  panneau.open = false;
  let infos = {};
  try {
    infos = JSON.parse(lire(CLE_EXPORT) || "{}");
  } catch {
    infos = {};
  }
  $("#export-nom").value = infos.nom ?? "";
  $("#export-classe").value = infos.classe ?? "";
  $("#export-titre").value = r.titre ?? "";
  // Sur claude.ai, l'impression et les téléchargements sont bloqués par la page.
  $("#boutons-export").hidden = SUR_CLAUDE_AI;
  $("#note-export-pdf").hidden = SUR_CLAUDE_AI;
  $("#note-export-claude").hidden = !SUR_CLAUDE_AI;
}

function infosExport() {
  const infos = { nom: $("#export-nom").value.trim(), classe: $("#export-classe").value.trim() };
  ecrire(CLE_EXPORT, JSON.stringify(infos));
  return { ...infos, titre: $("#export-titre").value.trim() };
}

$("#btn-export-pdf").addEventListener("click", () => {
  if (!etat.resultat) return;
  $("#rapport").innerHTML = construireRapportHtml(etat.resultat, infosExport());
  window.print();
});

$("#btn-export-word").addEventListener("click", async () => {
  if (!etat.resultat) return;
  const bouton = $("#btn-export-word");
  bouton.disabled = true;
  bouton.textContent = "Création du fichier…";
  try {
    const infos = infosExport();
    $("#rapport").innerHTML = construireRapportHtml(etat.resultat, infos);
    const blob = await exporterWord(etat.resultat, infos, $("#rapport"));
    const nom = `NetScan - ${(infos.titre || etat.resultat.titre || "compte rendu").replace(/[\\/:*?"<>|]/g, "-").slice(0, 80)}.docx`;
    const lien = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: nom });
    document.body.append(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 10_000);
    toast("Compte rendu Word téléchargé.");
  } catch (err) {
    console.error(err);
    toast("Impossible de créer le fichier Word. Vérifie ta connexion Internet et réessaie.", true);
  } finally {
    bouton.disabled = false;
    bouton.textContent = "Word (.docx)";
  }
});
initialiserCalcul();
$("#btn-nouvelle").addEventListener("click", () => {
  etat.photos = [];
  $("#contexte").value = "";
  $("#config-texte").value = "";
  majTailleConfig();
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
  if (e.target.id === "btn-ajouter-vus") {
    const n = equipementsReels(etat.resultat).length;
    for (const e of equipementsReels(etat.resultat)) ajouterMateriel(nomMateriel(e), 1);
    return toast(`${n} équipement${n > 1 ? "s" : ""} ajouté${n > 1 ? "s" : ""} à ton matériel.`);
  }
  if (e.target.id === "btn-demo-reglages") return modeAnalyse() || SUR_CLAUDE_AI ? afficherVue("accueil") : afficherReglages();
  const vue = e.target.closest("[data-vue]")?.dataset.vue;
  if (vue) {
    etat.vueSchema = vue;
    const defilement = window.scrollY;
    $("#onglet-schema").innerHTML = rendreSchema(etat.resultat);
    window.scrollTo({ top: defilement });
    return;
  }
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

/* ---------- Mon matériel (gardé sur l'appareil) ---------- */

function lireMateriel() {
  try {
    return nettoyerMateriel(JSON.parse(lire(CLE_MATERIEL) || "[]"));
  } catch {
    return [];
  }
}

function ecrireMateriel(liste) {
  ecrire(CLE_MATERIEL, liste.length ? JSON.stringify(liste) : "");
  afficherMateriel();
}

function ajouterMateriel(nom, quantite) {
  nom = nom.trim();
  if (!nom) return;
  const liste = lireMateriel();
  const existant = liste.find((m) => m.nom.toLowerCase() === nom.toLowerCase());
  if (existant) existant.quantite = Math.min(99, existant.quantite + quantite);
  else liste.push({ nom, quantite });
  ecrireMateriel(liste);
}

function afficherMateriel() {
  const liste = lireMateriel();
  $("#compte-materiel").textContent = liste.length
    ? `${liste.reduce((s, m) => s + m.quantite, 0)} élément${liste.length > 1 ? "s" : ""}`
    : "vide";
  $("#liste-materiel").innerHTML = liste
    .map(
      (m, i) => `<li><span class="qte">${m.quantite} ×</span><span class="nom">${echapper(m.nom)}</span>
        <button type="button" data-moins="${i}" aria-label="Retirer un ${echapper(m.nom)}">−</button>
        <button type="button" data-plus="${i}" aria-label="Ajouter un ${echapper(m.nom)}">+</button></li>`
    )
    .join("");
  const deja = new Set(liste.map((m) => m.nom.toLowerCase()));
  $("#raccourcis-materiel").innerHTML = RACCOURCIS_MATERIEL.filter((n) => !deja.has(n.toLowerCase()))
    .map((n) => `<button type="button" data-raccourci="${echapper(n)}">+ ${echapper(n)}</button>`)
    .join("");
  $("#suggestions-materiel").innerHTML = RACCOURCIS_MATERIEL.map((n) => `<option value="${echapper(n)}"></option>`).join("");
}

// Équipements identifiés sur la photo qui peuvent rejoindre la liste (pas Internet ni « inconnu »).
const equipementsReels = (r) =>
  (r?.equipements ?? []).filter((e) => !["cloud_internet", "inconnu"].includes(e.type));
const nomMateriel = (e) => [e.marque, e.modele].filter(Boolean).join(" ") || NOMS_TYPE[e.type] || e.nom;

$("#btn-ajouter-materiel").addEventListener("click", () => {
  ajouterMateriel($("#nom-materiel").value, Math.max(1, Number($("#quantite-materiel").value) || 1));
  $("#nom-materiel").value = "";
  $("#quantite-materiel").value = "1";
  $("#nom-materiel").focus();
});
$("#nom-materiel").addEventListener("keydown", (e) => {
  if (e.key === "Enter") $("#btn-ajouter-materiel").click();
});
$("#bloc-materiel").addEventListener("click", (e) => {
  const liste = lireMateriel();
  const { plus, moins, raccourci } = e.target.dataset;
  if (raccourci) return ajouterMateriel(raccourci, 1);
  if (plus !== undefined) liste[plus].quantite = Math.min(99, liste[plus].quantite + 1);
  else if (moins !== undefined) {
    liste[moins].quantite--;
    if (liste[moins].quantite < 1) liste.splice(Number(moins), 1);
  } else return;
  ecrireMateriel(liste);
});

afficherMateriel();

/* ---------- Compte NetScan : essais gratuits et packs d'analyses ---------- */

const euros = (centimes) => (centimes / 100).toLocaleString("fr-FR", { style: "currency", currency: "EUR" });

function texteStatutRelais() {
  const lien = (texte) => `<button type="button" class="lien-texte" id="lien-reglages">${texte}</button>`;
  if (lire(CLE_CODE)) return "Analyse avec la clé partagée NetScan (code d'accès).";
  const c = etat.compte;
  if (c?.credit) {
    return c.credit.restant > 0
      ? `${c.credit.restant} analyse${c.credit.restant > 1 ? "s" : ""} restante${c.credit.restant > 1 ? "s" : ""} sur ton code NetScan · ${lien("Mon compte")}`
      : `Plus d'analyses sur ton code NetScan : ${lien("recharge-le")}.`;
  }
  if (!c) return `Analyses NetScan · ${lien("Mon compte")}`;
  if (c.essais_restants > 0) {
    return `${c.essais_restants} analyse${c.essais_restants > 1 ? "s" : ""} gratuite${c.essais_restants > 1 ? "s" : ""} pour essayer · ${lien(`puis ${c.pack.analyses} analyses pour ${euros(c.pack.prix)}`)}`;
  }
  return `Analyses gratuites utilisées : ${lien(`achète ${c.pack.analyses} analyses pour ${euros(c.pack.prix)}`)}, ou entre un code d'accès.`;
}

async function appelRelais(chemin, corps) {
  const reponse = await fetch(`${URL_RELAIS}${chemin}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  const donnees = await reponse.json().catch(() => ({}));
  if (!reponse.ok) throw Object.assign(new Error(donnees.erreur || "Le relais NetScan ne répond pas."), { statut: reponse.status });
  return donnees;
}

async function rafraichirCompte() {
  if (!URL_RELAIS || SUR_CLAUDE_AI) return;
  const credit = lire(CLE_CREDIT);
  try {
    etat.compte = await appelRelais("/compte", credit ? { credit } : {});
  } catch (err) {
    // Code inconnu (paiement pas encore enregistré, ou code faux) : on garde au moins l'essai.
    if (err.statut === 404 && credit) etat.compte = await appelRelais("/compte", {}).catch(() => null);
  }
  afficherCompte();
  majStatut();
}

function majCompteApresAnalyse(compte) {
  if (!etat.compte) return;
  if (compte.type === "credit" && etat.compte.credit) etat.compte.credit.restant = compte.restant;
  if (compte.type === "essai") etat.compte.essais_restants = compte.essais_restants;
  majStatut();
}

function afficherCompte() {
  const c = etat.compte;
  const credit = lire(CLE_CREDIT);
  $("#solde-compte").innerHTML = !c
    ? "Impossible de joindre le relais NetScan pour l'instant."
    : c.credit
      ? `<strong>${c.credit.restant}</strong> analyse${c.credit.restant > 1 ? "s" : ""} restante${c.credit.restant > 1 ? "s" : ""} sur ce code (${c.credit.achete} achetée${c.credit.achete > 1 ? "s" : ""} au total).`
      : `<strong>${c.essais_restants}</strong> analyse${c.essais_restants > 1 ? "s" : ""} gratuite${c.essais_restants > 1 ? "s" : ""} restante${c.essais_restants > 1 ? "s" : ""} sur cet appareil.`;
  $("#mon-code").hidden = !credit;
  $("#mon-code-valeur").textContent = credit;
  if (c?.pack) {
    $("#btn-acheter").textContent = `${credit ? "Recharger" : "Acheter"} ${c.pack.analyses} analyses · ${euros(c.pack.prix)}`;
    $("#prix-analyse").textContent = `Soit ${euros(Math.round(c.pack.prix / c.pack.analyses))} l'analyse, sans abonnement ni date limite.`;
  }
  $("#btn-acheter").disabled = !c?.paiement_actif;
  $("#paiement-inactif").hidden = Boolean(c?.paiement_actif) || !c;
}

$("#btn-acheter").addEventListener("click", async () => {
  if (!$("#accepte-cgv").checked) {
    $("#accepte-cgv").focus();
    return toast("Coche d'abord la case des conditions de vente.", true);
  }
  $("#btn-acheter").disabled = true;
  try {
    const credit = lire(CLE_CREDIT);
    const { url, credit: code } = await appelRelais("/achat", { accepte: true, ...(credit ? { credit } : {}) });
    // Le code est gardé tout de suite : il sera crédité dès que Stripe confirme le paiement.
    ecrire(CLE_CREDIT, code);
    location.href = url;
  } catch (err) {
    toast(err.message, true);
    $("#btn-acheter").disabled = false;
  }
});

$("#btn-copier-code").addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lire(CLE_CREDIT));
    toast("Code copié.");
  } catch {
    toast("Copie impossible : note le code à la main.", true);
  }
});

$("#btn-utiliser-code").addEventListener("click", async () => {
  const code = $("#saisie-credit").value.trim().toUpperCase();
  if (!code) return toast("Entre ton code NetScan (NS-XXXX-XXXX-XXXX-XXXX).", true);
  try {
    const compte = await appelRelais("/compte", { credit: code });
    ecrire(CLE_CREDIT, compte.credit.code);
    $("#saisie-credit").value = "";
    etat.compte = compte;
    afficherCompte();
    majStatut();
    toast(`Code accepté : ${compte.credit.restant} analyses disponibles.`);
  } catch (err) {
    toast(err.message, true);
  }
});

// Retour de la page de paiement Stripe : ?achat=cs_… (payé) ou ?achat=annule.
async function verifierRetourPaiement() {
  const achat = new URLSearchParams(location.search).get("achat");
  if (!achat || !URL_RELAIS) return;
  history.replaceState(null, "", location.pathname);
  if (achat === "annule") return toast("Paiement annulé : rien n'a été débité.");
  try {
    const { credit } = await appelRelais("/confirmer", { session_id: achat });
    ecrire(CLE_CREDIT, credit.code);
    toast(`Paiement reçu : tu as ${credit.restant} analyses. Garde ton code NetScan, il est aussi sur ton reçu Stripe.`);
    afficherReglages();
  } catch (err) {
    toast(err.message, true);
  }
}

verifierRetourPaiement().finally(rafraichirCompte);

/* ---------- Réglages ---------- */

function afficherReglages() {
  const surClaude = SUR_CLAUDE_AI;
  $("#etat-compte").textContent = etat.compteClaude ? `Connecté · ${maxPhotos()} photos max par analyse.` : etat.messageCompteClaude;
  $("#carte-compte").hidden = !surClaude;
  // Sans serveur ni compte Claude (GitHub Pages) : on propose d'abord la version claude.ai, gratuite.
  $("#carte-claude-ai").hidden = surClaude || modeAnalyse() === "serveur";
  $("#carte-code").hidden = surClaude || !URL_RELAIS || modeAnalyse() === "serveur";
  $("#carte-achat").hidden = surClaude || !URL_RELAIS || modeAnalyse() === "serveur";
  rafraichirCompte();
  $("#code-acces").value = "";
  $("#etat-code").textContent = lire(CLE_CODE) ? "Code enregistré sur cet appareil." : "";
  $("#carte-cle h3").textContent = $("#carte-claude-ai").hidden ? "Clé API Anthropic" : "Ou avec une clé API Anthropic";
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
  } else if (mode === "claude" && etat.compteClaude.sansPhotos) {
    el.textContent = TEXTE_SANS_PHOTO;
  } else if (mode === "claude") {
    el.textContent = `Analyse avec ton compte Claude, sans clé API · ${maxPhotos()} photos max.`;
  } else if (SUR_CLAUDE_AI) {
    el.textContent = etat.messageCompteClaude;
  } else if (mode === "navigateur") {
    el.textContent = `Clé API enregistrée sur cet appareil · ${$("#choix-modele").selectedOptions[0].text.split(" —")[0]}`;
  } else if (mode === "relais") {
    el.innerHTML = texteStatutRelais();
  } else {
    el.innerHTML = `Pour analyser tes photos sans clé, <a class="lien-texte" href="https://claude.ai/artifact/H1swDNTebB1nnT7PFtLmUS" target="_blank" rel="noopener">ouvre NetScan sur claude.ai</a>, ou <button type="button" class="lien-texte" id="lien-reglages">ajoute une clé API</button>. L'exemple fonctionne sans.`;
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

$("#btn-enregistrer-code").addEventListener("click", async () => {
  const code = $("#code-acces").value.trim();
  if (!code) return toast("Entre d'abord le code.", true);
  $("#btn-enregistrer-code").disabled = true;
  try {
    const reponse = await fetch(`${URL_RELAIS}/verifier`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const corps = await reponse.json().catch(() => ({}));
    if (!reponse.ok) return toast(corps.erreur || "Code refusé.", true);
    if (!ecrire(CLE_CODE, code)) return toast("Impossible d'enregistrer le code (navigation privée ?).", true);
    $("#code-acces").value = "";
    $("#etat-code").textContent = "Code enregistré sur cet appareil.";
    majStatut();
    toast("Code accepté : tu peux analyser tes photos.");
  } catch {
    toast("Impossible de joindre le relais NetScan. Vérifie ta connexion Internet.", true);
  } finally {
    $("#btn-enregistrer-code").disabled = false;
  }
});

$("#btn-supprimer-code").addEventListener("click", () => {
  ecrire(CLE_CODE, "");
  $("#etat-code").textContent = "";
  majStatut();
  toast("Code retiré de cet appareil.");
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
      // limits() n'est qu'une indication : si elle échoue, on essaie quand même d'envoyer les photos,
      // et seul un vrai refus (images_unavailable) bascule sur l'analyse d'une description écrite.
      const limites = await sample.limits().catch(() => null);
      etat.compteClaude = {
        sample,
        maxPhotos: Math.min(MAX_PHOTOS, limites?.images?.maxCount ?? MAX_PHOTOS),
        sansPhotos: Boolean(limites) && !limites.images,
      };
      if (!etat.compteClaude.sansPhotos) {
        $("#aide-photos").textContent = `Tu peux ajouter jusqu'à ${maxPhotos()} photos : la façade de chaque équipement, l'arrière, l'écran de config, le schéma du TP…`;
      }
    }
  } catch {
    etat.messageCompteClaude = "Impossible de se connecter à ton compte Claude. Recharge la page.";
  }
  majStatut();
}

if ("serviceWorker" in navigator && window.isSecureContext && !window.claude) {
  // updateViaCache "none" : le navigateur vérifie toujours s'il existe une nouvelle version de l'appli.
  navigator.serviceWorker
    .register("sw.js", { updateViaCache: "none" })
    .then((reg) => reg.update())
    .catch(() => {});
  // Quand une nouvelle version prend le relais, on recharge une fois pour l'afficher.
  // (Pas à la toute première visite : il n'y avait pas encore d'ancienne version.)
  const ancienneVersion = Boolean(navigator.serviceWorker.controller);
  let rechargee = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (rechargee || !ancienneVersion) return;
    rechargee = true;
    location.reload();
  });
}
