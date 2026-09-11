/**
 * Vercel serverless entry point.
 *
 * Vercel's Node runtime treats a default-exported `(req, res)` function as the
 * handler, and an Express app is exactly that — so the app is handed over
 * whole rather than re-implemented per route. Every route, every piece of
 * middleware and the error handler behave identically to `npm start`.
 *
 * Plain JavaScript importing the *compiled* app, deliberately.
 *
 * The backend's tsconfig sets `rootDir: "src"`, so a TypeScript file here
 * would sit outside the project — untypechecked by `npm run typecheck` and
 * invisible to CI, which is the worst of both worlds. Importing `../dist`
 * instead means Vercel bundles output that `tsc` has already checked, and
 * nothing has to guess how `moduleResolution: nodenext` and its `.js` import
 * extensions should be resolved by a different bundler.
 *
 * `vercel.json` runs `npm run build` before this is bundled, so `dist` exists.
 */
import { createApp } from '../dist/app.js'

/*
 * Built once per cold start, not once per request.
 *
 * Module scope persists while an instance stays warm, so the Supabase clients
 * and the router tree are reused across invocations on that instance.
 */
export default createApp()
