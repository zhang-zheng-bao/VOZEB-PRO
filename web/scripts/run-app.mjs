import path from "node:path";
import { fileURLToPath } from "node:url";

import { generationRuntimeEnvironment, superviseGenerationRuntime } from "./generation-runtime.mjs";

const mode = process.argv[2];
if (mode !== "dev") throw new Error("Usage: run-app.mjs dev");

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextEntry = path.join(webRoot, "node_modules", "next", "dist", "bin", "next");
const runtime = generationRuntimeEnvironment({ allowEphemeralToken: true });
const environment = { ...runtime.environment, NEXT_DIST_DIR: runtime.environment.NEXT_DIST_DIR?.trim() || ".next-dev" };
const personalMode = ["1", "true", "yes", "on"].includes(environment.VOZEB_PRO_PERSONAL_MODE?.trim().toLowerCase() || "");
const appPort = environment.PORT?.trim() || (environment.VOZEB_PRO_INTERNAL_ORIGIN ? new URL(environment.VOZEB_PRO_INTERNAL_ORIGIN).port : "") || "3000";
if (runtime.ephemeralToken) console.log("Generated ephemeral maintenance and worker tokens for this local development process.");

process.exitCode = await superviseGenerationRuntime({
    app: { command: process.execPath, args: [nextEntry, "dev", "--webpack", "-H", personalMode ? "127.0.0.1" : "0.0.0.0", "-p", appPort], cwd: webRoot },
    workerScript: path.join(webRoot, "scripts", "generation-worker.mjs"),
    environment,
});
