// Fabrique la page publiée sur claude.ai (dossier artifact/) à partir de public/index.html.
// Sur claude.ai, la page est enveloppée automatiquement dans <html><head><body> : on garde
// seulement le <title>, les styles (intégrés dans la page) et le contenu du <body>.
// Les scripts et les images restent des fichiers publiés à côté de la page.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const racine = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const lire = (f) => fs.readFileSync(path.join(racine, f), "utf8");

const html = lire("public/index.html");
const titre = html.match(/<title>[\s\S]*?<\/title>/)[0];
const corps = html.match(/<body>([\s\S]*)<\/body>/)[1];
const styles = lire("public/styles.css");

const page = `${titre}
<style>
${styles}
</style>
${corps.trim()}
`;

fs.mkdirSync(path.join(racine, "artifact"), { recursive: true });
fs.writeFileSync(path.join(racine, "artifact", "index.html"), page);
console.log(`artifact/index.html écrit (${(page.length / 1024).toFixed(1)} Ko)`);
