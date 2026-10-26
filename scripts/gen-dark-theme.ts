import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateDarkThemeCss } from "./lib/dark-theme";

const root = join(__dirname, "..");
const css = generateDarkThemeCss(join(root, "src"));
writeFileSync(join(root, "src", "app", "dark-theme.css"), css);
console.log(`Wrote src/app/dark-theme.css (${css.split("\n").length} lines).`);
