// Visite guidée : met en valeur un élément de la page à la fois, avec une flèche et une explication.
// Deux parcours : l'accueil (saisie) et le résultat d'une analyse. Aucune bibliothèque.

const $ = (sel) => document.querySelector(sel);

const visible = (el) => {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};
const premierVisible = (...selecteurs) => selecteurs.map((s) => $(s)).find(visible) ?? null;
const cliquer = (sel) => () => $(sel)?.click();

export const ETAPES_ACCUEIL = [
  {
    cible: () => $(".choix-source"),
    titre: "1. Choisis ce que tu analyses",
    texte:
      "Prends une photo de ton matériel (switch, routeur, baie de brassage) ou importe jusqu'à 10 photos. Plusieurs angles aident : la façade, l'arrière, l'écran de config.",
  },
  {
    cible: () => $("#bloc-config-texte"),
    titre: "Ou colle une configuration",
    texte:
      "Pas de photo ? Colle la sortie de show running-config ou show ip interface brief. C'est plus fiable qu'une photo d'écran, et ça suffit seul.",
  },
  {
    cible: () => $('label[for="contexte"]'),
    titre: "2. Écris l'objectif du TP",
    texte:
      "Par exemple : « PC1 doit pinger PC2 à travers le routeur ». Avec l'objectif, le diagnostic est bien plus précis. Sans photo, décris ici ton installation.",
  },
  {
    cible: () => $("#bloc-materiel"),
    titre: "Indique ton matériel",
    texte:
      "Liste ce que tu as sous la main. NetScan propose alors un schéma réalisable avec, et te dit ce qui manque.",
  },
  {
    cible: () => $("#btn-analyser"),
    titre: "Lance l'analyse",
    texte:
      "Compte de 30 secondes à 2 minutes. Le bouton s'active dès qu'il y a une photo, une config ou une description.",
  },
  {
    cible: () => premierVisible("#btn-exemple-rapide", "#btn-demo"),
    titre: "Essaie sans rien installer",
    texte:
      "Cet exemple charge tout de suite une analyse déjà faite, sans appel à Claude. C'est le meilleur moyen de voir ce que NetScan te rend.",
  },
  {
    cible: () => $(".navigation"),
    titre: "Les autres outils",
    texte:
      "Calcul IP : réseau, masque et découpage VLSM avec les étapes. Historique : tes analyses passées. Compte : analyses restantes, code NetScan et clé API.",
  },
  {
    cible: () => $("#btn-aide"),
    titre: "C'est tout !",
    texte: "Relance cette visite à tout moment avec ce bouton. Pour voir un résultat, charge l'exemple puis relance la visite.",
  },
];

export const ETAPES_RESULTAT = [
  {
    cible: () => $("#verdict"),
    titre: "Le verdict",
    texte:
      "Vert : ça fonctionne. Orange : il manque des éléments. Rouge : ça ne marche pas en l'état. Dessous, le nombre de problèmes trouvés.",
  },
  {
    cible: () => $('[data-onglet="schema"]'),
    avant: cliquer('[data-onglet="schema"]'),
    titre: "Onglet Schéma",
    texte:
      "La photo analysée, puis le schéma : chaque câble porte le nom du port à ses deux bouts. Touche un équipement pour voir sa fiche, et un port pour son détail.",
  },
  {
    cible: () => $(".bascule-schema"),
    titre: "Schéma conseillé",
    texte:
      "Ici, tu passes de ce qui est branché au câblage conseillé : le plus simple, avec la raison et les changements à faire dans l'ordre.",
  },
  {
    cible: () => $('[data-onglet="config"]'),
    avant: cliquer('[data-onglet="config"]'),
    titre: "Onglet Config",
    texte:
      "La configuration lue sur ta photo ou proposée, bloc par bloc, avec une explication et un bouton Copier pour la coller dans l'équipement.",
  },
  {
    cible: () => $('[data-onglet="diagnostic"]'),
    avant: cliquer('[data-onglet="diagnostic"]'),
    titre: "Onglet Diagnostic",
    texte:
      "Ce qui manque ou ce qui est faux, du plus grave au moins grave, avec la correction. En dessous, les commandes pour vérifier que ça marche.",
  },
  {
    cible: () => $('[data-onglet="etapes"]'),
    avant: cliquer('[data-onglet="etapes"]'),
    titre: "Onglet Étapes",
    texte:
      "Le raisonnement pas à pas, comme dans Photomath. Avance à ton rythme avec « Étape suivante », ou affiche tout d'un coup.",
  },
  {
    cible: () => $("#panneau-export"),
    avant: cliquer('[data-onglet="schema"]'),
    titre: "Exporter pour rendre ton TP",
    texte: "Ouvre ce panneau pour télécharger le compte rendu complet en PDF ou en Word : schéma, ports, config, diagnostic.",
  },
];

let visiteEnCours = null;

export function visiteActive() {
  return visiteEnCours !== null;
}

// Options : { resultat: true pour le parcours du résultat, preparer(), declencheur, fin() }
export function demarrerVisite({ resultat = false, preparer = () => {}, declencheur = null, fin = () => {} } = {}) {
  visiteEnCours?.fermer(false);
  preparer();
  // On ne garde que les étapes dont l'élément est bien affiché (l'exemple change selon la taille d'écran).
  const etapes = (resultat ? ETAPES_RESULTAT : ETAPES_ACCUEIL).filter((e) => visible(e.cible()));
  if (!etapes.length) return;

  const fond = Object.assign(document.createElement("div"), { className: "visite-fond" });
  const cadre = Object.assign(document.createElement("div"), { className: "visite-cadre" });
  const carte = document.createElement("div");
  carte.className = "visite-carte";
  carte.setAttribute("role", "dialog");
  carte.setAttribute("aria-modal", "true");
  carte.setAttribute("aria-labelledby", "visite-titre");
  carte.setAttribute("aria-describedby", "visite-texte");
  carte.innerHTML = `
    <span class="visite-fleche" aria-hidden="true"></span>
    <div class="visite-tete">
      <span class="visite-compteur" id="visite-compteur"></span>
      <button type="button" class="visite-passer" aria-label="Fermer la visite guidée">Passer</button>
    </div>
    <h2 id="visite-titre"></h2>
    <p id="visite-texte"></p>
    <div class="visite-actions">
      <button type="button" class="btn-secondaire" id="visite-precedent">Précédent</button>
      <button type="button" class="btn-principal" id="visite-suivant">Suivant</button>
    </div>`;
  document.body.append(fond, cadre, carte);

  const btnPrecedent = carte.querySelector("#visite-precedent");
  const btnSuivant = carte.querySelector("#visite-suivant");
  let i = 0;
  let courant = etapes[0];

  function placer() {
    const el = courant.cible();
    if (!visible(el)) return;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const marge = 8;
    const ecart = 18; // distance entre le cadre et la carte : la flèche y tient

    Object.assign(cadre.style, {
      top: `${r.top - marge}px`,
      left: `${r.left - marge}px`,
      width: `${r.width + 2 * marge}px`,
      height: `${r.height + 2 * marge}px`,
    });

    const largeur = Math.min(360, vw - 24);
    carte.style.width = `${largeur}px`;
    const hauteur = carte.offsetHeight;

    const bordBas = limiteBasse();
    const placeEnBas = bordBas - r.bottom - marge - ecart;
    const placeEnHaut = r.top - marge - ecart;

    let cote = "libre";
    let haut;
    if (placeEnBas >= hauteur) {
      cote = "bas";
      haut = r.bottom + marge + ecart;
    } else if (placeEnHaut >= hauteur) {
      cote = "haut";
      haut = r.top - marge - ecart - hauteur;
    } else {
      // Élément plus grand que l'écran : la carte reste en bas, sans flèche.
      haut = Math.max(12, bordBas - hauteur - 12);
    }
    const centre = r.left + r.width / 2;
    const gauche = Math.min(Math.max(centre - largeur / 2, 12), vw - largeur - 12);
    carte.dataset.cote = cote;
    carte.style.top = `${haut}px`;
    carte.style.left = `${gauche}px`;
    carte.style.setProperty("--fleche-x", `${Math.min(Math.max(centre - gauche - 9, 18), largeur - 36)}px`);
  }

  // Sur téléphone, la barre de navigation fixe occupe le bas de l'écran.
  function limiteBasse() {
    const nav = $(".navigation");
    return nav && getComputedStyle(nav).position === "fixed" ? nav.getBoundingClientRect().top : window.innerHeight;
  }

  function defiler(el) {
    // Les éléments fixes (barre du haut, navigation du bas) restent où ils sont.
    if (el.closest(".navigation, .barre")) return;
    const r = el.getBoundingClientRect();
    const haut = ($(".barre")?.offsetHeight ?? 60) + 16;
    carte.style.width = `${Math.min(360, window.innerWidth - 24)}px`;
    const place = limiteBasse() - haut;
    let y;
    if (r.height > window.innerHeight * 0.25 && r.height + carte.offsetHeight + 44 <= place) {
      // Grand élément : on le met en haut pour que la carte tienne juste dessous.
      y = window.scrollY + r.top - haut;
    } else if (r.height > window.innerHeight * 0.5) {
      y = window.scrollY + r.top - haut;
    } else {
      y = window.scrollY + r.top - (window.innerHeight - r.height) / 2;
    }
    window.scrollTo({ top: Math.max(0, y), behavior: "instant" });
  }

  function afficher(index, sens = 1) {
    // Saute les étapes dont l'élément a disparu (changement d'écran en cours de visite).
    for (let k = index; k >= 0 && k < etapes.length; k += sens) {
      etapes[k].avant?.();
      if (visible(etapes[k].cible())) {
        i = k;
        courant = etapes[k];
        const dernier = k === etapes.length - 1;
        carte.querySelector("#visite-compteur").textContent = `${k + 1} / ${etapes.length}`;
        carte.querySelector("#visite-titre").textContent = courant.titre;
        carte.querySelector("#visite-texte").textContent = courant.texte;
        btnPrecedent.hidden = k === 0;
        btnSuivant.textContent = dernier ? "Terminer" : "Suivant";
        defiler(courant.cible());
        placer();
        btnSuivant.focus({ preventScroll: true });
        return;
      }
    }
    fermer(true);
  }

  let image = 0;
  const replacer = () => {
    cancelAnimationFrame(image);
    image = requestAnimationFrame(placer);
  };
  function touches(e) {
    if (e.key === "Escape") return fermer(true);
    if (e.key === "ArrowRight") return btnSuivant.click();
    if (e.key === "ArrowLeft" && !btnPrecedent.hidden) return btnPrecedent.click();
    if (e.key === "Tab") {
      // Le focus reste dans la carte tant que la visite est ouverte.
      const boutons = [...carte.querySelectorAll("button")].filter((b) => !b.hidden);
      const premier = boutons[0];
      const dernier = boutons.at(-1);
      if (e.shiftKey && document.activeElement === premier) (e.preventDefault(), dernier.focus());
      else if (!e.shiftKey && document.activeElement === dernier) (e.preventDefault(), premier.focus());
    }
  }

  function fermer(termine) {
    cancelAnimationFrame(image);
    window.removeEventListener("resize", replacer);
    window.removeEventListener("scroll", replacer, true);
    document.removeEventListener("keydown", touches, true);
    fond.remove();
    cadre.remove();
    carte.remove();
    visiteEnCours = null;
    if (termine) {
      declencheur?.focus({ preventScroll: true });
      fin();
    }
  }

  btnSuivant.addEventListener("click", () => (i === etapes.length - 1 ? fermer(true) : afficher(i + 1, 1)));
  btnPrecedent.addEventListener("click", () => afficher(i - 1, -1));
  carte.querySelector(".visite-passer").addEventListener("click", () => fermer(true));
  window.addEventListener("resize", replacer);
  window.addEventListener("scroll", replacer, true);
  document.addEventListener("keydown", touches, true);

  visiteEnCours = { fermer };
  afficher(0, 1);
}
