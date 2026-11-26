import { build, context } from "esbuild";
import { cp, mkdir } from "node:fs/promises";

const watch = process.argv.includes("--watch");

const options = {
	entryPoints: {
		content: "src/content.ts",
		background: "src/background.ts",
		popup: "src/popup.ts",
	},
	outdir: "dist",
	bundle: true,
	format: "iife", // los content scripts no pueden ser módulos ES
	target: "chrome120",
	sourcemap: true,
};

await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });

if (watch) {
	const ctx = await context(options);
	await ctx.watch();
	console.log(
		"Observando cambios en src/ (si cambias public/, vuelve a correr build)",
	);
} else {
	await build(options);
	console.log("Build listo en dist/");
}
