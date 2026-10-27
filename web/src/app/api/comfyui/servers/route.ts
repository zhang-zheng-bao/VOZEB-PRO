import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { readJsonBodyResult } from "@/lib/auth/request";
import { getAuthSettings } from "@/lib/auth/store";
import { isPersonalMode } from "@/lib/server/personal-mode";
import { comfyUiTunnelState, deleteComfyUiServer, ensureComfyUiTunnel, listComfyUiServers, saveComfyUiServer, selectComfyUiServer } from "@/lib/server/comfyui-ssh-tunnel";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";

export const runtime = "nodejs";

function localPort(baseUrl: string) {
    const url = new URL(baseUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) throw new Error("SSH 模式要求 ComfyUI 渠道的 Base URL 为 http://127.0.0.1:端口");
    return Number(url.port);
}

async function channelPort() {
    const settings = await getAuthSettings();
    const channel = settings.systemChannels.find((item) => item.enabled && item.advancedConfig?.protocol === "comfyui");
    if (!channel) throw new Error("请先启用 ComfyUI 渠道");
    return localPort(channel.baseUrl);
}

async function testComfyUi() {
    const port = await channelPort();
    try {
        const response = await fetchSafeOutbound(`http://127.0.0.1:${port}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new Error(`ComfyUI 返回 ${response.status}`);
    } catch (error) {
        throw new Error(`SSH 已连接，但远端 ComfyUI 不可用：${error instanceof Error ? error.message : "连接失败"}`);
    }
}

async function authorized(request: Request) {
    const user = await getCurrentUser(request);
    return Boolean(user && user.role === "admin" && isPersonalMode());
}

async function snapshot() {
    const saved = await listComfyUiServers();
    return { ...saved, connection: comfyUiTunnelState() };
}

export async function GET(request: Request) {
    if (!(await authorized(request))) return NextResponse.json({ error: "仅本地个人模式可管理 SSH 服务器" }, { status: 403 });
    const saved = await listComfyUiServers();
    if (saved.activeId) {
        try {
            await ensureComfyUiTunnel(await channelPort());
        } catch {
            // The connection error is returned in the snapshot.
        }
    }
    return NextResponse.json(await snapshot());
}

export async function POST(request: Request) {
    if (!(await authorized(request))) return NextResponse.json({ error: "仅本地个人模式可管理 SSH 服务器" }, { status: 403 });
    try {
        const parsed = await readJsonBodyResult<Record<string, unknown>>(request, 16 * 1024);
        if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: parsed.status });
        const input = parsed.data;
        if (input.action === "save") await saveComfyUiServer(input);
        else if (input.action === "delete") await deleteComfyUiServer(String(input.id || ""));
        else if (input.action === "select") {
            await selectComfyUiServer(String(input.id || ""), await channelPort());
            await testComfyUi();
        } else if (input.action === "reconnect") {
            await ensureComfyUiTunnel(await channelPort(), true);
            await testComfyUi();
        }
        else return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
        return NextResponse.json(await snapshot());
    } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "服务器操作失败", ...(await snapshot()) }, { status: 400 });
    }
}
