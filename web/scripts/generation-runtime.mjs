import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";

const MIN_TOKEN_LENGTH = 32;

export function generationRuntimeEnvironment({ environment = process.env, allowEphemeralToken = false } = {}) {
    const source = { ...environment };
    const maintenanceToken = source.VOZEB_PRO_MAINTENANCE_TOKEN?.trim() || "";
    const workerToken = source.VOZEB_PRO_WORKER_TOKEN?.trim() || "";
    if (!allowEphemeralToken && (maintenanceToken.length < MIN_TOKEN_LENGTH || workerToken.length < MIN_TOKEN_LENGTH || maintenanceToken === workerToken)) {
        throw new Error("VOZEB_PRO_MAINTENANCE_TOKEN and VOZEB_PRO_WORKER_TOKEN must be distinct and contain at least 32 characters");
    }

    const port = validPort(source.PORT) || 3000;
    const resolvedMaintenanceToken = maintenanceToken.length >= MIN_TOKEN_LENGTH ? maintenanceToken : randomBytes(32).toString("hex");
    let resolvedWorkerToken = workerToken.length >= MIN_TOKEN_LENGTH ? workerToken : randomBytes(32).toString("hex");
    if (resolvedWorkerToken === resolvedMaintenanceToken) resolvedWorkerToken = randomBytes(32).toString("hex");
    return {
        environment: {
            ...source,
            VOZEB_PRO_MAINTENANCE_TOKEN: resolvedMaintenanceToken,
            VOZEB_PRO_WORKER_TOKEN: resolvedWorkerToken,
            VOZEB_PRO_WORKER_API_ORIGIN: resolveGenerationWorkerOrigin({ environment: source, fallbackOrigin: `http://127.0.0.1:${port}` }),
        },
        ephemeralToken: maintenanceToken.length < MIN_TOKEN_LENGTH || workerToken.length < MIN_TOKEN_LENGTH || maintenanceToken === workerToken,
    };
}

export function resolveGenerationWorkerOrigin({ environment = process.env, fallbackOrigin = "http://127.0.0.1:3000" } = {}) {
    const raw = environment.VOZEB_PRO_WORKER_API_ORIGIN?.trim() || environment.VOZEB_PRO_INTERNAL_ORIGIN?.trim() || environment.NEXT_PUBLIC_SITE_URL?.trim() || fallbackOrigin;
    const value = /^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Generation worker origin must use HTTP or HTTPS");
    return url.origin;
}

export function superviseGenerationRuntime({ app, workerScript, environment, spawnProcess = spawn, workerRestartDelayMs }) {
    const webDefinition = { name: "web", command: app.command, args: app.args, cwd: app.cwd };
    const workerDefinition = { name: "generation-worker", command: process.execPath, args: [workerScript], cwd: app.cwd };
    const restartDelayMs = workerRestartDelayMs ?? validWorkerInterval(environment.VOZEB_PRO_GENERATION_WORKER_INTERVAL_MS);
    return new Promise((resolve) => {
        let stopping = false;
        let requestedExitCode = 0;
        let forceTimer;
        let workerRestartTimer;
        let webProcess;
        let workerProcess;

        const cleanup = () => {
            process.off("SIGINT", stopForSignal);
            process.off("SIGTERM", stopForSignal);
            if (forceTimer) clearTimeout(forceTimer);
            if (workerRestartTimer) clearTimeout(workerRestartTimer);
        };
        const finishIfStopped = () => {
            if (!stopping || isRunning(webProcess) || isRunning(workerProcess)) return;
            cleanup();
            resolve(requestedExitCode);
        };
        const stop = (exitCode) => {
            if (stopping) return;
            stopping = true;
            requestedExitCode = exitCode;
            if (workerRestartTimer) clearTimeout(workerRestartTimer);
            for (const child of [webProcess, workerProcess]) if (isRunning(child)) child.kill("SIGTERM");
            forceTimer = setTimeout(() => {
                for (const child of [webProcess, workerProcess]) if (isRunning(child)) child.kill("SIGKILL");
            }, 5_000);
            forceTimer.unref();
            finishIfStopped();
        };
        const stopForSignal = () => stop(0);
        const startChild = (definition) => {
            const child = spawnProcess(definition.command, definition.args, { cwd: definition.cwd, env: environment, stdio: "inherit" });
            child.once("error", (error) => {
                console.error(`${definition.name} process failed to start`, error);
                if (definition === webDefinition) stop(1);
            });
            child.once("close", (code) => {
                if (definition === webDefinition) {
                    if (!stopping) console.error(`web process stopped unexpectedly with code ${code ?? "unknown"}`);
                    stop(code && code > 0 ? code : stopping ? requestedExitCode : 1);
                } else if (!stopping) {
                    console.error(`generation-worker process stopped unexpectedly with code ${code ?? "unknown"}; restarting in ${restartDelayMs}ms`);
                    workerProcess = undefined;
                    workerRestartTimer = setTimeout(() => {
                        workerRestartTimer = undefined;
                        if (!stopping) workerProcess = startChild(workerDefinition);
                    }, restartDelayMs);
                }
                finishIfStopped();
            });
            return child;
        };

        process.once("SIGINT", stopForSignal);
        process.once("SIGTERM", stopForSignal);
        webProcess = startChild(webDefinition);
        workerProcess = startChild(workerDefinition);
    });
}

function validPort(value) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}

function validWorkerInterval(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(500, Math.min(30_000, Math.floor(parsed))) : 2_000;
}

function isRunning(child) {
    return Boolean(child && child.exitCode === null && child.signalCode === null);
}
