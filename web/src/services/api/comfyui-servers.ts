export type ComfyUiServer = { id: string; name: string; host: string; port: number; username: string; remotePort: number; hasPassword: boolean };
export type ComfyUiServersState = {
    activeId: string;
    servers: ComfyUiServer[];
    connection: { activeId: string; connected: boolean; connecting: boolean; error: string };
};
export type ComfyUiHealth = { configured: boolean; online: boolean; status: string; message: string };

export async function getComfyUiServers(): Promise<ComfyUiServersState> {
    const response = await fetch("/api/comfyui/servers", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "读取服务器列表失败");
    return data;
}

export async function getComfyUiHealth(): Promise<ComfyUiHealth> {
    const response = await fetch("/api/comfyui/status", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "检测服务器失败");
    return data;
}

export async function updateComfyUiServer(input: Record<string, unknown>): Promise<ComfyUiServersState> {
    const response = await fetch("/api/comfyui/servers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "服务器操作失败");
    return data;
}
