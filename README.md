# NetScan

**Le Photomath du réseau.** Prends en photo un équipement réseau (switch, routeur, pare-feu, box…), un écran de configuration ou un schéma de TP : NetScan affiche :

- 🗺️ **le schéma réseau**, avec le nom des ports à chaque bout des câbles ;
- 🔌 **la façade de chaque équipement**, avec ses ports (branché / libre / inconnu) : touche un port pour voir son détail ;
- ⌨️ **la configuration** : lue sur la photo si elle est visible, sinon proposée, avec des explications et un bouton « Copier » ;
- ✅ **le diagnostic** : est-ce que ça fonctionne ? Ce qui manque ou ce qui est faux, et comment le corriger ;
- 🧠 **les étapes du raisonnement**, une par une, comme Photomath.

L'analyse d'image est faite par l'API Claude (Anthropic), avec une réponse au format JSON imposé, ensuite dessinée par l'appli.

## Démarrer

Il faut [Node.js](https://nodejs.org) 20.12 ou plus récent.

```bash
git clone https://github.com/billalk/NetScan.git
cd NetScan
npm install
cp .env.example .env    # puis colle ta clé dans ANTHROPIC_API_KEY
npm start
```

Ouvre ensuite http://localhost:3000.

> Sans clé API, le bouton **« Voir un exemple sans clé API »** montre une analyse complète de démonstration (TP de routage inter-VLAN).

### Obtenir une clé API

1. Crée un compte sur [console.anthropic.com](https://console.anthropic.com).
2. Ajoute quelques euros de crédit (l'API est payante à l'usage, séparément de l'abonnement Claude.ai).
3. Crée une clé dans *Settings → API Keys* et colle-la dans le fichier `.env`.

Le fichier `.env` est ignoré par Git : ta clé ne part jamais sur GitHub.

### Utiliser l'appli sur ton téléphone

Au démarrage, le serveur affiche une adresse du type `http://192.168.1.20:3000`. Ouvre-la sur ton téléphone connecté **au même Wi-Fi** que ton PC : le bouton « Prendre une photo » ouvre directement l'appareil photo.

Pour l'utiliser partout (en cours, en stage), il faut héberger le serveur en ligne (Render, Railway, Fly.io…) en ajoutant `ANTHROPIC_API_KEY` dans les variables d'environnement de l'hébergeur. L'appli peut alors être installée sur l'écran d'accueil (PWA).

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
| `src/analyse.js` | Consigne envoyée à Claude, appel à l'API en streaming |
| `src/schema.js` | Schéma JSON que la réponse doit respecter (équipements, ports, liens, config, diagnostic, étapes) |
| `public/app.js` | Interface : photos, envoi, onglets, historique |
| `public/rendu.js` | Dessin en SVG du schéma réseau et des façades |
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
