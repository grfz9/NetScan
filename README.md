# NetScan

**Le Photomath du réseau.** Prends en photo un équipement réseau (switch, routeur, pare-feu, box…), un écran de configuration ou un schéma de TP : NetScan affiche :

- 🗺️ **le schéma réseau**, avec le nom des ports à chaque bout des câbles ;
- 🔌 **la façade de chaque équipement**, avec ses ports (branché / libre / inconnu) : touche un port pour voir son détail ;
- ⌨️ **la configuration** : lue sur la photo si elle est visible, sinon proposée, avec des explications et un bouton « Copier » ;
- ✅ **le diagnostic** : est-ce que ça fonctionne ? Ce qui manque ou ce qui est faux, et comment le corriger ;
- 🧠 **les étapes du raisonnement**, une par une, comme Photomath.

Tu peux envoyer **jusqu'à 10 photos** pour une même analyse (façades, arrière, écran de config, schéma du TP…), et le bouton **« Simplifier le schéma »** regroupe les postes identiques quand le schéma est chargé.

L'analyse d'image est faite par l'API Claude (Anthropic), avec une réponse au format JSON imposé, ensuite dessinée par l'appli.

## Outils inclus

- **Coller une configuration** (`show running-config`, `show ip interface brief`…) au lieu de photographier l'écran : plus fiable, et suffisant sans photo.
- **Calcul IP** (icône calculatrice) : réseau, masque, broadcast, plage, binaire et découpage **VLSM**, avec les étapes expliquées. Hors ligne, gratuit.
- **Visite guidée** (bouton « ? » en haut) : met en valeur chaque élément avec une flèche et une explication, pour l'accueil puis pour un résultat. Elle démarre automatiquement à la toute première visite.
- **Compte rendu de TP** : sur un résultat, « Exporter le compte rendu » en **PDF** (impression) ou **Word (.docx)**, avec schémas, ports, configuration, diagnostic et démarche.

## Utiliser l'appli en ligne

👉 **https://grfz9.github.io/NetScan/**

1. Ouvre le lien sur ton téléphone (tu peux l'ajouter à l'écran d'accueil comme une appli).
2. Va dans **Réglages** (icône ⚙️) et colle ta clé API Anthropic.
3. Prends ta photo et appuie sur **Analyser**.

La clé est enregistrée uniquement dans ton navigateur, sur ton appareil, et n'est envoyée qu'à l'API d'Anthropic. Elle n'est jamais dans le code ni sur GitHub. Chaque personne qui utilise le site met sa propre clé.

Sans clé, le bouton **« Voir un exemple sans clé API »** montre une analyse complète de démonstration.

## Packs d'analyses (paiement Stripe)

Sur le site, chaque appareil a **2 analyses gratuites**, puis on achète un **pack de 20 analyses à 2,99 €** (Réglages → Mon compte NetScan). Le paiement passe par Stripe Checkout ; l'achat donne un **code NetScan** (`NS-XXXX-XXXX-XXXX-XXXX`) qui marche sur tous les appareils et figure sur le reçu Stripe. Une analyse n'est décomptée que si elle réussit. Les packs et essais utilisent Claude Sonnet 5.5.

- Crédits et essais : base Cloudflare D1 `netscan` (tables dans `relais/schema.sql`)
- Prix, taille des packs et essais : `[vars]` dans `relais/wrangler.toml`
- Activer le paiement : secrets `STRIPE_SECRET_KEY` (clé restreinte, droit *Checkout Sessions : écriture*) et `STRIPE_WEBHOOK_SECRET` (webhook vers `https://netscan-relais.netscan.workers.dev/stripe-webhook`, événement `checkout.session.completed`)
- Conditions de vente : `public/cgv.html` (informations du vendeur à compléter avant d'encaisser)

## Clé partagée avec un code d'accès

Le relais `relais/` (Cloudflare Worker) garde une clé API secrète et la prête aux personnes qui ont le **code d'accès** : dans l'appli, *Réglages → Code d'accès NetScan*. La clé n'est jamais dans le code ni sur GitHub, chaque appareil est limité à 5 demandes par minute.

Mettre à jour les secrets (à taper soi-même) :

```bash
npx wrangler secret put ANTHROPIC_API_KEY --config relais/wrangler.toml
npx wrangler secret put CODE_ACCES --config relais/wrangler.toml
```

Redéployer après une modification : `npm run relais:deploy`. Changer `CODE_ACCES` coupe l'accès à tous ceux qui ont l'ancien code.

## Version sans clé API, sur claude.ai

NetScan existe aussi en page claude.ai : l'analyse passe alors par **ton compte Claude** (ton abonnement), sans clé API ni crédit. Elle ne fonctionne que pour les personnes connectées à claude.ai avec qui la page est partagée.

Pour la reconstruire après une modification :

```bash
node scripts/build-artifact.mjs
```

puis republier le dossier `artifact/` avec les fichiers de `public/` (Claude Code s'en charge).

## Lancer en local (avec le serveur Node)

Il faut [Node.js](https://nodejs.org) 20.12 ou plus récent.

```bash
git clone https://github.com/grfz9/NetScan.git
cd NetScan
npm install
cp .env.example .env    # puis colle ta clé dans ANTHROPIC_API_KEY
npm start
```

Ouvre ensuite http://localhost:3000. Avec une clé dans `.env`, c'est le serveur qui appelle Claude (la clé ne quitte pas ton PC). Sans `.env`, l'appli utilise la clé enregistrée dans ses Réglages, comme sur GitHub Pages.

### Obtenir une clé API

1. Crée un compte sur [console.anthropic.com](https://console.anthropic.com).
2. Ajoute quelques euros de crédit (l'API est payante à l'usage, séparément de l'abonnement Claude.ai).
3. Crée une clé dans *Settings → API Keys* et colle-la dans les Réglages de l'appli (ou dans le fichier `.env` en local).

Le fichier `.env` est ignoré par Git : ta clé ne part jamais sur GitHub. **Ne mets jamais ta clé dans le code** : le dépôt et le site sont publics.

### Utiliser l'appli sur ton téléphone

Au démarrage, le serveur affiche une adresse du type `http://192.168.1.20:3000`. Ouvre-la sur ton téléphone connecté **au même Wi-Fi** que ton PC : le bouton « Prendre une photo » ouvre directement l'appareil photo.

Pour l'utiliser partout (en cours, en stage), le plus simple est la version en ligne sur GitHub Pages (voir plus haut).

## Réglages (fichier `.env`)

| Variable | Par défaut | Rôle |
|---|---|---|
| `ANTHROPIC_API_KEY` | — | Clé API Anthropic (obligatoire pour analyser de vraies photos) |
| `PORT` | `3000` | Port du serveur |
| `NETSCAN_MODEL` | `claude-opus-5-5` | Modèle Claude utilisé |
| `NETSCAN_EFFORT` | `medium` | Profondeur de réflexion : `low`, `medium`, `high`, `xhigh`, `max` |

Plus l'effort est élevé, plus le diagnostic est poussé, mais plus l'analyse est lente et coûteuse.

## Conseils pour de bonnes photos

- Photographie la façade bien en face, avec les étiquettes (marque, modèle) lisibles.
- Ajoute une 2ᵉ photo de l'écran (`show running-config`, `show ip interface brief`, Packet Tracer…) : NetScan pourra lire la vraie configuration au lieu d'en proposer une.
- Écris la consigne du TP dans le champ « Consigne » : le diagnostic sera bien plus précis.

## Comment ça marche

```
Téléphone (navigateur)                   Serveur Node.js                 API Claude
──────────────────────                   ───────────────                 ──────────
photo → réduite à 1568 px  ──POST──▶  /api/analyse  ──image + consigne──▶  vision + raisonnement
                                         │                                 │
afficher la progression    ◀──NDJSON──   │ ◀────── réponse JSON (schéma) ──┘
dessiner schéma, ports,                  │
config, diagnostic, étapes  ◀─résultat───┘
```

| Fichier | Rôle |
|---|---|
| `server.js` | Serveur Express : sert l'interface et l'API `/api/analyse` |
| `public/coeur.js` | Consigne envoyée à Claude, appel à l'API en streaming, et version claude.ai sans clé (partagé partout) |
| `relais/worker.js` | Relais Cloudflare : clé API, code d'accès, essais gratuits, packs payés |
| `relais/stripe.js`, `relais/comptes.js` | Paiement Stripe et crédits d'analyses (D1) |
| `public/config.js` | Adresse du relais |
| `scripts/build-artifact.mjs` | Fabrique la page claude.ai à partir de `public/index.html` |
| `public/schema.js` | Schéma JSON que la réponse doit respecter (équipements, ports, liens, config, diagnostic, étapes) |
| `src/analyse.js` | Branche le cœur de l'analyse sur la clé du serveur |
| `public/app.js` | Interface : photos, envoi, onglets, réglages, historique |
| `public/rendu.js` | Dessin en SVG du schéma réseau (vue détaillée ou simplifiée) et des façades |
| `.github/workflows/pages.yml` | Publie le dossier `public/` sur GitHub Pages à chaque push |
| `public/demo/exemple.json` | Résultat de démonstration |

L'historique des analyses est gardé dans le navigateur (localStorage), sur l'appareil.

## Limites

- NetScan peut se tromper : vérifie toujours avec les commandes proposées dans l'onglet *Diagnostic*.
- Il ne voit que ce qui est sur la photo : une LED ou une étiquette illisible reste « inconnue ».
- Chaque analyse consomme des crédits API (environ quelques centimes par photo).

## Idées pour la suite

- Poser une question de suivi sur une analyse (« pourquoi le trunk ? »).
- Exporter le schéma en image ou en PDF pour un compte rendu de TP.
- Générer un fichier Packet Tracer à partir du schéma.

## Licence

MIT

## Crédits

Photo d'exemple (`public/playground/baie-brassage.jpg`) : « 19-inch rackmount Ethernet switches and patch panels », par [Dsimic](https://commons.wikimedia.org/wiki/File:19-inch_rackmount_Ethernet_switches_and_patch_panels.jpg), licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr), via Wikimedia Commons. Photo non modifiée ; l'analyse affichée par-dessus est celle de NetScan.

