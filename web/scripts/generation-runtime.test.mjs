import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { generationRuntimeEnvironment, resolveGenerationWorkerOrigin, superviseGenerationRuntime } from "./generation-runtime.mjs";

describe("generation runtime environment", () => {
    it("uses distinct configured maintenance and worker tokens", () => {
        const maintenanceToken = "a".repeat(32);
        const workerToken = "b".repeat(32);
        const result = generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: maintenanceToken, VOZEB_PRO_WORKER_TOKEN: workerToken, PORT: "3100" } });

        expect(result).toMatchObject({ ephemeralToken: false, environment: { VOZEB_PRO_MAINTENANCE_TOKEN: maintenanceToken, VOZEB_PRO_WORKER_TOKEN: workerToken, VOZEB_PRO_WORKER_API_ORIGIN: "http://127.0.0.1:3100" } });
    });

    it("generates a process-local token only for development", () => {
        const result = generationRuntimeEnvironment({ environment: {}, allowEphemeralToken: true });

        expect(result.ephemeralToken).toBe(true);
        expect(result.environment.VOZEB_PRO_MAINTENANCE_TOKEN).toHaveLength(64);
        expect(result.environment.VOZEB_PRO_WORKER_TOKEN).toHaveLength(64);
        expect(result.environment.VOZEB_PRO_WORKER_TOKEN).not.toBe(result.environment.VOZEB_PRO_MAINTENANCE_TOKEN);
    });

    it("fails production startup before the app can run without a valid token", () => {
        expect(() => generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: "short", VOZEB_PRO_WORKER_TOKEN: "b".repeat(32) } })).toThrow("distinct and contain at least 32 characters");
        expect(() => generationRuntimeEnvironment({ environment: { VOZEB_PRO_MAINTENANCE_TOKEN: "a".repeat(32), VOZEB_PRO_WORKER_TOKEN: "a".repeat(32) } })).toThrow("distinct and contain at least 32 characters");
    });

    it("normalizes a Render private hostport to an HTTP origin", () => {
        expect(resolveGenerationWorkerOrigin({ environment: { VOZEB_PRO_WORKER_API_ORIGIN: "vozeb-pro:3000" } })).toBe("http://vozeb-pro:3000");
    });

    it("keeps the web process alive and restarts a crashed generation worker", async () => {
        const children = [];
        const spawnProcess = vi.fn(() => {
            const child = new EventEmitter();
            child.exitCode = null;
            child.signalCode = null;
            child.kill = vi.fn((signal) => {
                child.signalCode = signal;
                queueMicrotask(() => child.emit("close", null));
            });
            children.push(child);
            return child;
        });
        const runtime = superviseGenerationRuntime({
            app: { command: "node", args: ["server.js"], cwd: "/app" },
            workerScript: "/app/generation-worker.mjs",
            environment: {},
            spawnProcess,
            workerRestartDelayMs: 0,
        });

        children[1].exitCode = 1;
        children[1].emit("close", 1);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(spawnProcess).toHaveBeenCalledTimes(3);
        expect(children[0].kill).not.toHaveBeenCalled();
        children[0].exitCode = 0;
        children[0].emit("close", 0);
        await runtime;
        expect(children[2].kill).toHaveBeenCalledWith("SIGTERM");
    });
});
