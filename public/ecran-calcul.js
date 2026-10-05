// Écran « Calcul IP » : adresse + masque, et découpage VLSM. Aucun appel à Claude.
import { lireAdresseEtPrefixe, analyserAdresse, decouperVLSM, ErreurCalcul } from "./calcul-ip.js";
import { echapper } from "./rendu.js";

const $ = (sel) => document.querySelector(sel);

const EXEMPLE_VLSM = [
  { nom: "Admin", hotes: 50 },
  { nom: "Élèves", hotes: 25 },
  { nom: "Serveurs", hotes: 10 },
  { nom: "Lien R1-R2", hotes: 2 },
];

// Binaire avec les bits réseau mis en valeur.
function binaireColore(binaire, prefixe) {
  let bit = 0;
  return [...binaire]
    .map((c) => {
      if (c === ".") return `<span class="point">.</span>`;
      const classe = bit++ < prefixe ? "bit-reseau" : "bit-hote";
      return `<span class="${classe}">${c}</span>`;
    })
    .join("");
}

const etapesHtml = (etapes) =>
  `<ol class="etapes calcul-etapes">${etapes
    .map((e) => `<li class="etape"><h3>${echapper(e.titre)}</h3><p class="muted">${echapper(e.detail)}</p></li>`)
    .join("")}</ol>`;

function calculerAdresse() {
  const sortie = $("#resultat-adresse");
  const adresse = $("#calcul-ip").value.trim();
  if (!adresse) return (sortie.innerHTML = "");
  try {
    const { ip, prefixe } = lireAdresseEtPrefixe(adresse, $("#calcul-masque").value);
    const r = analyserAdresse(ip, prefixe);
    const lignes = [
      ["Adresse réseau", `${r.reseau}/${r.prefixe}`],
      ["Masque", `${r.masque} (/${r.prefixe})`],
      ["Première adresse utilisable", r.premier],
      ["Dernière adresse utilisable", r.dernier],
      ["Broadcast", r.broadcast],
      ["Nombre d'hôtes", r.hotes.toLocaleString("fr-FR")],
      ["Wildcard (ACL, OSPF)", r.wildcard],
      ["Classe / type", `${r.classe} · ${r.type}`],
    ];
    sortie.innerHTML = `<div class="carte">
        <table class="table-calcul"><tbody>${lignes
          .map(([k, v]) => `<tr><th>${echapper(k)}</th><td><code>${echapper(String(v))}</code></td></tr>`)
          .join("")}</tbody></table>
        ${r.estReseau ? `<p class="muted petit">${echapper(r.ip)} est l'adresse du réseau lui-même : elle ne peut pas être donnée à un hôte.</p>` : ""}
      </div>
      <div class="carte">
        <h3>En binaire</h3>
        <div class="defile"><pre class="binaire">${[
          ["Adresse  ", r.binaire.ip],
          ["Masque   ", r.binaire.masque],
          ["Réseau   ", r.binaire.reseau],
          ["Broadcast", r.binaire.broadcast],
        ]
          .map(([k, b]) => `${k} ${binaireColore(b, r.prefixe)}`)
          .join("\n")}</pre></div>
        <p class="legende-bits"><span class="bit-reseau">■</span> partie réseau (${r.prefixe} bits) <span class="bit-hote">■</span> partie hôte (${32 - r.prefixe} bits)</p>
      </div>
      <h2>Les étapes du calcul</h2>
      ${etapesHtml(r.etapes)}`;
  } catch (err) {
    if (!(err instanceof ErreurCalcul)) throw err;
    sortie.innerHTML = `<div class="carte erreur-calcul">${echapper(err.message)}</div>`;
  }
}

function lireBesoins() {
  return [...document.querySelectorAll("#liste-besoins .besoin")].map((l) => ({
    nom: l.querySelector(".besoin-nom").value,
    hotes: l.querySelector(".besoin-hotes").value,
  }));
}

function afficherBesoins(besoins) {
  $("#liste-besoins").innerHTML = besoins
    .map(
      (b, i) => `<div class="besoin">
        <label class="visuellement-cache" for="besoin-nom-${i}">Nom du sous-réseau ${i + 1}</label>
        <input id="besoin-nom-${i}" class="besoin-nom" type="text" maxlength="40" value="${echapper(b.nom)}" placeholder="Nom (ex : Admin)">
        <label class="visuellement-cache" for="besoin-hotes-${i}">Hôtes nécessaires pour le sous-réseau ${i + 1}</label>
        <input id="besoin-hotes-${i}" class="besoin-hotes" type="number" min="1" inputmode="numeric" value="${echapper(String(b.hotes))}" placeholder="Hôtes">
        <button type="button" class="btn-icone retirer-besoin" data-i="${i}" aria-label="Retirer ce sous-réseau">×</button>
      </div>`
    )
    .join("");
}

function calculerVLSM() {
  const sortie = $("#resultat-vlsm");
  try {
    const r = decouperVLSM($("#vlsm-reseau").value, lireBesoins());
    sortie.innerHTML = `<div class="carte">
        <h3>Plan d'adressage de ${echapper(r.depart)}</h3>
        <div class="defile"><table class="table-vlsm">
          <thead><tr><th>Sous-réseau</th><th>Hôtes</th><th>Réseau</th><th>Masque</th><th>Plage utilisable</th><th>Broadcast</th></tr></thead>
          <tbody>${r.sousReseaux
            .map(
              (s) => `<tr><td><strong>${echapper(s.nom)}</strong></td>
                <td>${s.demandes} <span class="muted">/ ${s.disponibles}</span></td>
                <td><code>${s.reseau}/${s.prefixe}</code></td><td><code>${s.masque}</code></td>
                <td><code>${s.premier}</code> → <code>${s.dernier}</code></td><td><code>${s.broadcast}</code></td></tr>`
            )
            .join("")}</tbody>
        </table></div>
        <p class="muted petit">Hôtes : demandés / disponibles. ${r.restant ? `${r.restant} adresses restent libres.` : "Tout l'espace est utilisé."}</p>
      </div>
      <h2>Les étapes du découpage</h2>
      ${etapesHtml(r.etapes)}`;
  } catch (err) {
    if (!(err instanceof ErreurCalcul)) throw err;
    sortie.innerHTML = `<div class="carte erreur-calcul">${echapper(err.message)}</div>`;
  }
}

function choisirOutil(nom) {
  document.querySelectorAll("#vue-calcul .bascule-schema button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.outil === nom)));
  $("#outil-adresse").hidden = nom !== "adresse";
  $("#outil-vlsm").hidden = nom !== "vlsm";
}

export function initialiserCalcul() {
  afficherBesoins(EXEMPLE_VLSM);
  calculerAdresse();
  calculerVLSM();

  $("#vue-calcul .bascule-schema").addEventListener("click", (e) => {
    if (e.target.dataset.outil) choisirOutil(e.target.dataset.outil);
  });
  $("#calcul-ip").addEventListener("input", calculerAdresse);
  $("#calcul-masque").addEventListener("input", calculerAdresse);
  $("#vlsm-reseau").addEventListener("input", calculerVLSM);
  $("#liste-besoins").addEventListener("input", calculerVLSM);
  $("#liste-besoins").addEventListener("click", (e) => {
    const i = e.target.closest(".retirer-besoin")?.dataset.i;
    if (i === undefined) return;
    const besoins = lireBesoins();
    besoins.splice(Number(i), 1);
    afficherBesoins(besoins);
    calculerVLSM();
  });
  $("#btn-ajouter-besoin").addEventListener("click", () => {
    const besoins = lireBesoins();
    besoins.push({ nom: "", hotes: "" });
    afficherBesoins(besoins);
    document.querySelector("#liste-besoins .besoin:last-child .besoin-nom").focus();
  });
}
