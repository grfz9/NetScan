import Anthropic from "@anthropic-ai/sdk";
import { analyserAvec, MODELE_PAR_DEFAUT, EFFORT_PAR_DEFAUT } from "../public/coeur.js";

// Lu à l'appel (et pas à l'import) pour que le fichier .env soit déjà chargé.
export const modele = () => process.env.NETSCAN_MODEL || MODELE_PAR_DEFAUT;
const effort = () => process.env.NETSCAN_EFFORT || EFFORT_PAR_DEFAUT;

let client;

export function analyser({ images, contexte, materiel, onEtape }) {
  client ??= new Anthropic();
  return analyserAvec(client, { images, contexte, materiel, onEtape, modele: modele(), effort: effort() });
}
