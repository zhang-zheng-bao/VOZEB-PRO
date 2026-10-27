import { generateKeyPairSync } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { connect as connectTcp, createServer as createTcpServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Server as SshServer } from "ssh2";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { disconnectComfyUiTunnel, ensureComfyUiTunnel, listComfyUiServers, saveComfyUiServer, selectComfyUiServer } from "./comfyui-ssh-tunnel";

let directory: string;
let ssh: SshServer;
let http: ReturnType<typeof createHttpServer>;
let sshPort: number;
let remotePort: number;
let localPort: number;

function listen(server: { listen(port: number, host: string, callback: () => void): unknown; address(): string | { port: number } | null }) {
    return new Promise<number>((resolve) => server.listen(0, "127.0.0.1", () => resolve((server.address() as { port: number }).port)));
}

describe("local ComfyUI SSH server switching", () => {
    beforeAll(async () => {
        directory = await mkdtemp(join(tmpdir(), "vozeb-comfyui-ssh-"));
        vi.stubEnv("VOZEB_PRO_DATA_DIR", directory);
        vi.stubEnv("VOZEB_PRO_ENCRYPTION_KEY", "a".repeat(64));
        http = createHttpServer((_request, response) => { response.setHeader("Content-Type", "application/json"); response.end('{"system":{"os":"fixture"}}'); });
        remotePort = await listen(http);
        const key = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs1", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
        ssh = new SshServer({ hostKeys: [key.privateKey] }, (client) => {
            client.on("authentication", (context) => context.method === "password" && context.username === "fixture" && context.password === "secret" ? context.accept() : context.reject());
            client.on("ready", () => client.on("tcpip", (accept, reject, info) => {
                if (info.destPort !== remotePort) return reject();
                const upstream = connectTcp(remotePort, "127.0.0.1");
                upstream.once("connect", () => { const stream = accept(); upstream.pipe(stream).pipe(upstream); });
                upstream.once("error", reject);
            }));
        });
        sshPort = await listen(ssh);
        const available = createTcpServer();
        localPort = await listen(available);
        await new Promise<void>((resolve) => available.close(() => resolve()));
    });

    afterAll(async () => {
        disconnectComfyUiTunnel();
        await new Promise<void>((resolve) => ssh.close(() => resolve()));
        await new Promise<void>((resolve) => http.close(() => resolve()));
        const file = await readFile(join(directory, "comfyui-ssh-servers.json"), "utf8");
        expect(JSON.parse(file).servers[0].passwordCiphertext).not.toBe("secret");
        await rm(directory, { recursive: true, force: true });
        vi.unstubAllEnvs();
    });

    it("stores the password encrypted and forwards ComfyUI HTTP over SSH", async () => {
        const id = await saveComfyUiServer({ name: "测试服务器", host: "127.0.0.1", port: sshPort, username: "fixture", password: "secret", remotePort });
        expect((await listComfyUiServers()).servers[0]).toMatchObject({ id, hasPassword: true });
        await selectComfyUiServer(id, localPort);
        const response = await fetch(`http://127.0.0.1:${localPort}/system_stats`, { headers: { Connection: "close" } });
        expect(response.ok).toBe(true);
        expect(await response.json()).toEqual({ system: { os: "fixture" } });
        const second = await saveComfyUiServer({ name: "备用服务器", host: "127.0.0.1", port: sshPort, username: "fixture", password: "secret", remotePort });
        await selectComfyUiServer(second, localPort);
        expect((await listComfyUiServers()).activeId).toBe(second);
        await ensureComfyUiTunnel(localPort, true);
        expect((await fetch(`http://127.0.0.1:${localPort}/system_stats`, { headers: { Connection: "close" } })).ok).toBe(true);
    });
});
