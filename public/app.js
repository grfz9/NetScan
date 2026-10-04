import { echapper, icone, NOMS_TYPE, dessinerTopologie, dessinerFacade, colorerCommandes } from "./rendu.js";

const $ = (sel) => document.querySelector(sel);
const MAX_PHOTOS = 4;
const CLE_HISTORIQUE = "netscan.historique";

const etat = {
  photos: [], // { data, media_type, apercu }
  resultat: null,
};

/* ---------- Navigation entre les vues ---------- */

function afficherVue(nom) {
  for (const v of ["accueil", "chargement", "resultat", "historique"]) {
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
    if (etat.photos.length >= MAX_PHOTOS) {
      toast(`${MAX_PHOTOS} photos maximum.`);
      break;
    }
    try {
      const apercu = await compresser(f);
      etat.photos.push({ apercu, media_type: "image/jpeg", data: apercu.split(",")[1] });
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
  const contexte = $("#contexte").value.trim();
  $("#scan-image").src = etat.photos[0].apercu;
  marquerEtape("envoi");
  afficherVue("chargement");

  try {
    const reponse = await fetch("/api/analyse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        images: etat.photos.map(({ data, media_type }) => ({ data, media_type })),
        contexte,
      }),
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
        if (msg.etape) marquerEtape(msg.etape);
        if (msg.erreur) throw new Error(msg.erreur);
        if (msg.resultat) resultat = msg.resultat;
      }
    }
    if (!resultat) throw new Error("La connexion a été coupée avant la fin de l'analyse.");

    const vignette = await miniatureDepuis(etat.photos[0].apercu).catch(() => "");
    enregistrerHistorique({ resultat, contexte, vignette });
    afficherResultat(resultat);
  } catch (err) {
    afficherVue("accueil");
    toast(err.message || "L'analyse a échoué.", true);
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
    afficherResultat(resultat);
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

function afficherResultat(r) {
  etat.resultat = r;
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
    html += `<div class="carte">
      <h3>Schéma réseau</h3>
      <div class="defile">${dessinerTopologie(r)}</div>
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

fetch("/api/statut")
  .then((r) => r.json())
  .then((s) => {
    $("#statut-api").textContent = s.cle_configuree
      ? `Analyse par ${s.modele}`
      : "Aucune clé API configurée sur le serveur : seul l'exemple fonctionne pour l'instant.";
  })
  .catch(() => {});

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}
