import path from "node:path";
import { fileURLToPath } from "node:url";

import { generationRuntimeEnvironment, superviseGenerationRuntime } from "./generation-runtime.mjs";
import { prepareStandaloneAssets } from "./standalone-assets.mjs";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
const buildRoot = path.join(webRoot, distDir);
const standaloneRoot = path.join(buildRoot, "standalone");
const configuredPort = process.env.PORT?.trim() || (process.env.VOZEB_PRO_INTERNAL_ORIGIN ? new URL(process.env.VOZEB_PRO_INTERNAL_ORIGIN).port : "") || "3000";

await prepareStandaloneAssets({ webRoot, distDir });

const runtime = generationRuntimeEnvironment({
    environment: {
        ...process.env,
        PORT: configuredPort,
        HOSTNAME: process.env.HOSTNAME || (["1", "true", "yes", "on"].includes(process.env.VOZEB_PRO_PERSONAL_MODE?.trim().toLowerCase() || "") ? "127.0.0.1" : "0.0.0.0"),
        VOZEB_PRO_DATA_DIR: process.env.VOZEB_PRO_DATA_DIR || path.join(webRoot, ".data"),
        VOZEB_PRO_INTERNAL_ORIGIN: process.env.VOZEB_PRO_INTERNAL_ORIGIN || `http://127.0.0.1:${configuredPort}`,
    },
});
process.exitCode = await superviseGenerationRuntime({
    app: { command: process.execPath, args: ["server.js"], cwd: standaloneRoot },
    workerScript: path.join(webRoot, "scripts", "generation-worker.mjs"),
    environment: runtime.environment,
});
