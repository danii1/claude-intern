import { readFileSync, writeFileSync } from "fs";
import pkg from "./package.json";

await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "bun",
  minify: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});

// Replace shebang to use bun instead of node
const distPath = "dist/index.js";
let content = readFileSync(distPath, "utf8");
content = content.replace("#!/usr/bin/env node", "#!/usr/bin/env bun");
writeFileSync(distPath, content);

console.log(`Built claude-intern v${pkg.version}`);
