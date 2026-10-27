import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:net";
import { Client } from "ssh2";

import { readJsonDataFile, withJsonDataFileLock, writeJsonDataFile } from "@/lib/server/data-adapter";
import { decryptSecretValue, encryptSecretValue } from "@/lib/server/secret-crypto";

const FILE = "comfyui-ssh-servers.json";

type SavedServer = {
    id: string;
    name: string;
    host: string;
    port: number;
    username: string;
    passwordCiphertext: string;
    remotePort: number;
    hostKeyHash?: string;
};
type SavedSettings = { activeId: string; servers: SavedServer[] };
export type ComfyUiServer = Omit<SavedServer, "passwordCiphertext" | "hostKeyHash"> & { hasPassword: boolean };
export type ComfyUiTunnelState = { activeId: string; connected: boolean; connecting: boolean; error: string };
type Runtime = { client?: Client; listener?: Server; activeId: string; connected: boolean; connecting?: Promise<void>; error: string; generation: number; listeners: Set<() => void> };

const scope = globalThis as typeof globalThis & { __comfyUiTunnel?: Runtime };
const runtime = (scope.__comfyUiTunnel ??= { activeId: "", connected: false, error: "", generation: 0, listeners: new Set() });

function publish() {
    for (const listener of runtime.listeners) listener();
}

export function subscribeComfyUiTunnel(listener: () => void) {
    runtime.listeners.add(listener);
    return () => runtime.listeners.delete(listener);
}

export function comfyUiTunnelState(): ComfyUiTunnelState {
    return { activeId: runtime.activeId, connected: runtime.connected, connecting: Boolean(runtime.connecting), error: runtime.error };
}

async function readSettings(): Promise<SavedSettings> {
    return readJsonDataFile(FILE, { activeId: "", servers: [] });
}

export async function listComfyUiServers() {
    const settings = await readSettings();
    return { activeId: settings.activeId, servers: settings.servers.map(({ passwordCiphertext, hostKeyHash, ...server }) => ({ ...server, hasPassword: Boolean(passwordCiphertext) })) as ComfyUiServer[] };
}

function validPort(value: unknown) {
    const port = Number(value);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("端口必须在 1 到 65535 之间");
    return port;
}

export async function saveComfyUiServer(input: Record<string, unknown>) {
    const name = String(input.name || "").trim();
    const host = String(input.host || "").trim();
    const username = String(input.username || "").trim();
    const password = String(input.password || "");
    if (!name || !host || !username || /[\s/:@]/.test(host)) throw new Error("请填写有效的服务器名称、SSH 地址和用户名");
    const port = validPort(input.port);
    const remotePort = validPort(input.remotePort);
    const id = String(input.id || randomUUID());
    await withJsonDataFileLock(FILE, async () => {
        const settings = await readSettings();
        const old = settings.servers.find((item) => item.id === id);
        if (!old && !password) throw new Error("请填写 SSH 密码");
        const server: SavedServer = {
            id, name, host, port, username, remotePort,
            passwordCiphertext: password ? encryptSecretValue(password) : old?.passwordCiphertext || "",
            ...(old?.host === host && old.port === port ? { hostKeyHash: old.hostKeyHash } : {}),
        };
        settings.servers = old ? settings.servers.map((item) => (item.id === id ? server : item)) : [...settings.servers, server];
        await writeJsonDataFile(FILE, settings);
    });
    return id;
}

export async function deleteComfyUiServer(id: string) {
    await withJsonDataFileLock(FILE, async () => {
        const settings = await readSettings();
        settings.servers = settings.servers.filter((item) => item.id !== id);
        if (settings.activeId === id) {
            settings.activeId = "";
            disconnectComfyUiTunnel();
        }
        await writeJsonDataFile(FILE, settings);
    });
}

export async function selectComfyUiServer(id: string, localPort: number) {
    await withJsonDataFileLock(FILE, async () => {
        const settings = await readSettings();
        if (!settings.servers.some((item) => item.id === id)) throw new Error("服务器不存在");
        settings.activeId = id;
        await writeJsonDataFile(FILE, settings);
    });
    disconnectComfyUiTunnel();
    await ensureComfyUiTunnel(localPort);
}

export function disconnectComfyUiTunnel() {
    runtime.generation += 1;
    const client = runtime.client;
    const listener = runtime.listener;
    runtime.client = undefined;
    runtime.listener = undefined;
    runtime.connected = false;
    runtime.connecting = undefined;
    runtime.activeId = "";
    runtime.error = "";
    client?.end();
    listener?.close();
    publish();
}

export async function ensureComfyUiTunnel(localPort: number, reconnect = false) {
    const settings = await readSettings();
    const server = settings.servers.find((item) => item.id === settings.activeId);
    if (!server) return;
    if (reconnect) disconnectComfyUiTunnel();
    if (runtime.connected && runtime.activeId === server.id) return;
    if (runtime.connecting) return runtime.connecting;
    runtime.activeId = server.id;
    runtime.error = "";
    const generation = runtime.generation;
    const connection = connect(server, localPort, generation);
    runtime.connecting = connection;
    publish();
    try {
        await connection;
    } finally {
        if (runtime.connecting === connection) runtime.connecting = undefined;
        publish();
    }
}

async function connect(server: SavedServer, localPort: number, generation: number) {
    const client = new Client();
    runtime.client = client;
    client.on("error", () => undefined);
    let firstConnection = !server.hostKeyHash;
    try {
        await new Promise<void>((resolve, reject) => {
            client.once("ready", resolve);
            client.once("error", reject);
            client.connect({
                host: server.host, port: server.port, username: server.username,
                password: decryptSecretValue(server.passwordCiphertext),
                hostHash: "sha256",
                hostVerifier: (hash: string) => {
                    if (server.hostKeyHash && server.hostKeyHash !== hash) return false;
                    if (firstConnection) server.hostKeyHash = hash;
                    return true;
                },
            });
        });
        if (runtime.generation !== generation) throw new Error("连接已切换");
        if (firstConnection) {
            await withJsonDataFileLock(FILE, async () => {
                const settings = await readSettings();
                const saved = settings.servers.find((item) => item.id === server.id);
                if (saved && saved.host === server.host && saved.port === server.port) {
                    saved.hostKeyHash = server.hostKeyHash;
                    await writeJsonDataFile(FILE, settings);
                }
            });
            firstConnection = false;
        }
        const listener = createServer((socket) => {
            client.forwardOut("127.0.0.1", 0, "127.0.0.1", server.remotePort, (error, stream) => {
                if (error || !stream) return socket.destroy();
                socket.pipe(stream).pipe(socket);
                socket.on("error", () => stream.destroy());
                stream.on("error", () => socket.destroy());
            });
        });
        await new Promise<void>((resolve, reject) => {
            listener.once("error", reject);
            listener.listen(localPort, "127.0.0.1", resolve);
        });
        if (runtime.generation !== generation) {
            listener.close();
            throw new Error("连接已切换");
        }
        runtime.listener = listener;
        runtime.connected = true;
        runtime.error = "";
        publish();
        client.once("close", () => {
            if (runtime.client !== client) return;
            runtime.client = undefined;
            runtime.listener = undefined;
            runtime.connected = false;
            listener.close();
            publish();
            void ensureComfyUiTunnel(localPort).catch(() => undefined);
        });
    } catch (error) {
        if (runtime.client === client) {
            runtime.client = undefined;
            runtime.connected = false;
            runtime.error = error instanceof Error && error.message.includes("EADDRINUSE") ? "本地端口已被占用，请关闭手动隧道" : "SSH 连接失败，请检查服务器地址、密码和主机密钥";
            publish();
        }
        client.end();
        throw new Error(runtime.error || "SSH 连接失败");
    }
}
