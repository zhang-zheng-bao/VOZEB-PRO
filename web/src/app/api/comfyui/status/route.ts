import { NextResponse } from "next/server";

import { getAuthSettings } from "@/lib/auth/store";
import { getCurrentUser } from "@/lib/auth/session";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { isPersonalMode } from "@/lib/server/personal-mode";
import { ensureComfyUiTunnel, listComfyUiServers } from "@/lib/server/comfyui-ssh-tunnel";

export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const settings = await getAuthSettings();
    const channel = settings.systemChannels.find((item) => item.enabled && item.advancedConfig?.protocol === "comfyui");
    if (!channel) return NextResponse.json({ configured: false, online: false, status: "missing", message: "未配置 ComfyUI 渠道" });

    const baseUrl = channel.baseUrl.trim().replace(/\/+$/, "");
    if (!baseUrl) return NextResponse.json({ configured: false, online: false, status: "missing", message: "ComfyUI Base URL 为空" });

    try {
        if (isPersonalMode() && (await listComfyUiServers()).activeId) {
            const url = new URL(baseUrl);
            if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port) throw new Error("当前 ComfyUI 渠道地址不适用于 SSH 隧道");
            await ensureComfyUiTunnel(Number(url.port));
        }
        const response = await fetchSafeOutbound(`${baseUrl}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return NextResponse.json({ configured: true, online: false, status: "error", message: `ComfyUI 返回 ${response.status}` });
        return NextResponse.json({ configured: true, online: true, status: "online", message: "ComfyUI 在线" });
    } catch (error) {
        return NextResponse.json({ configured: true, online: false, status: "offline", message: error instanceof Error && error.message.startsWith("当前 ComfyUI") ? error.message : "ComfyUI 未连接" });
    }
}
