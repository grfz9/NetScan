import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { analyser, modele } from "./src/analyse.js";
import { MAX_PHOTOS, messageErreur } from "./public/coeur.js";

try {
  process.loadEnvFile();
} catch {
  // Pas de fichier .env : on garde les variables d'environnement du système.
}

const ici = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const app = express();
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(ici, "public")));

app.get("/api/statut", (req, res) => {
  res.json({
    cle_configuree: Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    modele: modele(),
  });
});

// Réponse en NDJSON : une ligne JSON par événement ({etape}, puis {resultat} ou {erreur}).
app.post("/api/analyse", async (req, res) => {
  const { images, contexte = "" } = req.body ?? {};

  if (!Array.isArray(images) || images.length === 0 || images.length > MAX_PHOTOS) {
    return res.status(400).json({ erreur: `Envoie entre 1 et ${MAX_PHOTOS} photos.` });
  }
  const invalide = images.some(
    (img) => !TYPES_IMAGE.includes(img?.media_type) || typeof img?.data !== "string" || !img.data
  );
  if (invalide) {
    return res.status(400).json({ erreur: "Format d'image non pris en charge (JPEG, PNG, WebP ou GIF)." });
  }

  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const envoyer = (objet) => res.write(JSON.stringify(objet) + "\n");

  try {
    const debut = Date.now();
    const { resultat, modele: utilise, usage } = await analyser({
      images,
      contexte: String(contexte).slice(0, 2000),
      onEtape: (etape) => envoyer({ etape }),
    });
    console.log(
      `Analyse OK en ${((Date.now() - debut) / 1000).toFixed(1)} s ` +
        `(${utilise}, ${usage.input_tokens} tokens entrée / ${usage.output_tokens} sortie)`
    );
    envoyer({ resultat, modele: utilise });
  } catch (err) {
    console.error(err);
    envoyer({ erreur: messageErreur(err, Anthropic) });
  }
  res.end();
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`\nNetScan est lancé :`);
  console.log(`  Sur ce PC :         http://localhost:${PORT}`);
  for (const adresses of Object.values(os.networkInterfaces())) {
    for (const a of adresses ?? []) {
      if (a.family === "IPv4" && !a.internal) {
        console.log(`  Sur ton téléphone : http://${a.address}:${PORT}  (même Wi-Fi)`);
      }
    }
  }
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    console.log("\n⚠  Aucune clé ANTHROPIC_API_KEY trouvée : seul le mode démo fonctionnera.");
  }
  console.log(`  Modèle : ${modele()}\n`);
});
