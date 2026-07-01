// Ambient declaration so side-effect CSS imports (e.g. `import "@/globals.css"`)
// typecheck at the repo level without Next's generated per-app next-env.d.ts.
declare module "*.css";
