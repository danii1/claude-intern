import pkg from "./package.json";

await Bun.build({
  entrypoints: ["src/index.ts"],
  outdir: "dist",
  target: "node",
  minify: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
  },
});

console.log(`Built claude-intern v${pkg.version}`);
