"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { App, Button, Input, InputNumber, Popconfirm, Popover } from "antd";
import { Check, Pencil, Plus, RefreshCw, Server, ServerOff, Trash2 } from "lucide-react";

import { getComfyUiHealth, getComfyUiServers, updateComfyUiServer, type ComfyUiHealth, type ComfyUiServersState } from "@/services/api/comfyui-servers";

type Draft = { id?: string; name: string; host: string; port: number; username: string; password: string; remotePort: number };
const emptyDraft = (): Draft => ({ name: "", host: "", port: 22, username: "root", password: "", remotePort: 8188 });

export function ComfyUiServerControl({ buttonClassName, buttonStyle }: { buttonClassName: string; buttonStyle?: CSSProperties }) {
    const { message } = App.useApp();
    const [open, setOpen] = useState(false);
    const [servers, setServers] = useState<ComfyUiServersState | null>(null);
    const [health, setHealth] = useState<ComfyUiHealth | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [busy, setBusy] = useState(false);
    const mounted = useRef(false);
    const refresh = useCallback(async () => {
        try {
            const list = await getComfyUiServers();
            if (!mounted.current) return;
            setServers(list);
            const nextHealth = await getComfyUiHealth();
            if (mounted.current) setHealth(nextHealth);
        } catch (error) {
            if (mounted.current) setHealth({ configured: false, online: false, status: "offline", message: error instanceof Error ? error.message : "连接状态不可用" });
        }
    }, []);

    useEffect(() => {
        mounted.current = true;
        void refresh();
        const onFocus = () => void refresh();
        window.addEventListener("focus", onFocus);
        const events = new EventSource("/api/comfyui/servers/events");
        events.onmessage = (event) => {
            if (!mounted.current) return;
            const connection = JSON.parse(event.data) as ComfyUiServersState["connection"];
            if (!connection.activeId) return;
            setServers((current) => current ? { ...current, connection } : current);
            if (!connection.connected) setHealth((current) => ({ configured: current?.configured ?? true, online: false, status: "offline", message: connection.error || "ComfyUI 未连接" }));
            else void getComfyUiHealth().then((value) => { if (mounted.current) setHealth(value); }).catch(() => undefined);
        };
        return () => {
            mounted.current = false;
            window.removeEventListener("focus", onFocus);
            events.close();
        };
    }, [refresh]);

    const run = async (input: Record<string, unknown>, success: string) => {
        setBusy(true);
        try {
            setServers(await updateComfyUiServer(input));
            await refresh();
            message.success(success);
            return true;
        } catch (error) {
            message.error(error instanceof Error ? error.message : "服务器操作失败");
            await refresh();
            return false;
        } finally {
            setBusy(false);
        }
    };

    const saveAndTest = async () => {
        if (!draft) return;
        const id = draft.id || crypto.randomUUID();
        if (!(await run({ action: "save", ...draft, id }, "服务器资料已保存"))) return;
        if (await run({ action: "select", id }, "ComfyUI 已连接，当前工作流可直接使用")) setDraft(null);
    };

    const active = servers?.servers.find((item) => item.id === servers.activeId);
    const online = Boolean(health?.online);
    const title = `${active?.name || "ComfyUI 服务器"}：${health?.message || "正在检测"}`;

    return (
        <Popover
            trigger="click"
            placement="bottom"
            open={open}
            styles={{ root: { maxWidth: "calc(100vw - 16px)" } }}
            onOpenChange={(next) => { setOpen(next); if (next) void refresh(); }}
            content={
                <div className="w-[min(292px,calc(100vw-48px))] text-stone-900 dark:text-stone-100 sm:w-[340px]" aria-label="ComfyUI 服务器管理">
                    <div className="flex items-center justify-between border-b border-stone-200 pb-2 dark:border-stone-700">
                        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                            {online ? <Server className="size-4 text-emerald-600" /> : <ServerOff className="size-4 text-rose-500" />}
                            <span className="truncate">{active?.name || "ComfyUI 服务器"}</span>
                        </div>
                        <Button size="small" type="text" icon={<RefreshCw className="size-4" />} loading={busy} disabled={!servers?.activeId} title="手动重连" aria-label="手动重连 ComfyUI" onClick={() => void run({ action: "reconnect" }, "ComfyUI 已重新连接")} />
                    </div>
                    <p className={`my-2 text-xs ${online ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>{health?.message || "正在检测连接"}</p>
                    <div className="max-h-44 space-y-1 overflow-y-auto">
                        {servers?.servers.map((server) => (
                            <div key={server.id} className="flex min-h-11 items-center gap-2 rounded border border-stone-200 px-2 dark:border-stone-700">
                                <button type="button" disabled={busy} className="min-w-0 flex-1 text-left disabled:opacity-50" onClick={() => void run({ action: "select", id: server.id }, `已切换至 ${server.name}`)}>
                                    <span className="flex items-center gap-1 text-sm font-medium">{server.id === servers.activeId ? <Check className="size-3.5 shrink-0 text-emerald-600" /> : null}<span className="truncate">{server.name}</span></span>
                                    <span className="block truncate text-xs text-stone-500 dark:text-stone-400">{server.host}:{server.port}</span>
                                </button>
                                <Button size="small" type="text" icon={<Pencil className="size-3.5" />} title={`编辑 ${server.name}`} aria-label={`编辑 ${server.name}`} onClick={() => setDraft({ ...server, password: "" })} />
                                <Popconfirm title={`删除 ${server.name}？`} okText="删除" cancelText="取消" onConfirm={() => void run({ action: "delete", id: server.id }, "服务器已删除")}>
                                    <Button size="small" type="text" danger icon={<Trash2 className="size-3.5" />} title={`删除 ${server.name}`} aria-label={`删除 ${server.name}`} />
                                </Popconfirm>
                            </div>
                        ))}
                    </div>
                    {draft ? (
                        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
                            <Input className="col-span-2" aria-label="服务器名称" placeholder="服务器名称" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                            <Input className="col-span-2" aria-label="SSH 地址" placeholder="SSH 地址或域名" value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} />
                            <InputNumber className="w-full" aria-label="SSH 端口" min={1} max={65535} value={draft.port} onChange={(value) => setDraft({ ...draft, port: value || 22 })} />
                            <Input aria-label="SSH 用户名" placeholder="SSH 用户名" value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
                            <Input.Password className="col-span-2" aria-label="SSH 密码" autoComplete="new-password" placeholder={draft.id ? "留空则保持原密码" : "SSH 密码"} value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
                            <span className="self-center text-xs text-stone-500 dark:text-stone-400">远端 ComfyUI 端口</span>
                            <InputNumber className="w-full" aria-label="远端 ComfyUI 端口" min={1} max={65535} value={draft.remotePort} onChange={(value) => setDraft({ ...draft, remotePort: value || 8188 })} />
                            <div className="col-span-2 flex justify-end gap-2">
                                <Button size="small" onClick={() => setDraft(null)}>取消</Button>
                                <Button size="small" type="primary" loading={busy} onClick={() => void saveAndTest()}>测试并启用</Button>
                            </div>
                        </div>
                    ) : (
                        <Button className="mt-3 w-full" size="small" icon={<Plus className="size-4" />} onClick={() => setDraft(emptyDraft())}>添加服务器</Button>
                    )}
                </div>
            }
        >
            <button type="button" className={buttonClassName} style={buttonStyle} aria-label={title} title={title} aria-expanded={open}>
                {online ? <Server className="size-4 text-emerald-600 dark:text-emerald-400" /> : <ServerOff className="size-4 text-rose-600 dark:text-rose-400" />}
            </button>
        </Popover>
    );
}
