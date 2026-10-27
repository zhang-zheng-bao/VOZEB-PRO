import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings } from "@/lib/auth/store";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const settings = await getAuthSettings();
    const channel = settings.systemChannels.find((item) => item.enabled && item.apiKey && item.advancedConfig?.protocol === "runninghub") || settings.systemChannels.find((item) => item.enabled && item.apiKey && /runninghub|rh/i.test(`${item.id} ${item.name} ${item.baseUrl}`));
    if (!channel?.apiKey) return NextResponse.json({ configured: false, error: "未配置 RunningHub API Key" }, { status: 404 });

    const response = await fetchSafeOutbound("https://www.runninghub.cn/uc/openapi/accountStatus", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${channel.apiKey}`,
        },
        body: JSON.stringify({ apikey: channel.apiKey, apiKey: channel.apiKey }),
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const payload = parseJson(text);
    if (!response.ok) return NextResponse.json({ configured: true, error: readError(payload) || `RunningHub 余额查询失败：${response.status}` }, { status: 502 });

    const data = payload && typeof payload === "object" && !Array.isArray(payload) && "data" in payload ? (payload as Record<string, unknown>).data : payload;
    const balance = readBalance(data);
    const walletBalance = readFirstNumber(data, ["remainMoney", "money", "walletBalance", "wallet_balance", "wallet", "amount", "cashBalance", "cash_balance", "rmbBalance", "cnyBalance"]);
    return NextResponse.json({
        configured: true,
        balance,
        displayBalance: balance === undefined ? "" : formatNumber(balance),
        runningTasks: readFirstNumber(data, ["runningTasks", "runningTask", "running_task", "taskRunning", "queueRunning", "running"]),
        walletBalance,
        displayWalletBalance: walletBalance === undefined ? "" : formatCurrency(walletBalance),
        updatedAt: new Date().toISOString(),
    });
}

function parseJson(text: string) {
    try {
        return text ? (JSON.parse(text) as unknown) : {};
    } catch {
        return {};
    }
}

function readError(payload: unknown) {
    if (!payload || typeof payload !== "object") return "";
    const record = payload as Record<string, unknown>;
    for (const key of ["msg", "message", "error", "errorMessage"]) {
        if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
    }
    return "";
}

function readBalance(value: unknown) {
    return readFirstNumber(value, ["rhCoins", "rhCoin", "coins", "coin", "balance", "remainCoins", "remainingCoins", "remaining", "remain", "credits"]);
}

function readFirstNumber(value: unknown, keys: string[], depth = 0): number | undefined {
    if (!value || depth > 4) return undefined;
    if (typeof value !== "object") return undefined;
    if (Array.isArray(value)) {
        for (const item of value) {
            const found = readFirstNumber(item, keys, depth + 1);
            if (found !== undefined) return found;
        }
        return undefined;
    }
    const record = value as Record<string, unknown>;
    const normalizedKeys = new Set(keys.map(normalizeKey));
    for (const [key, item] of Object.entries(record)) {
        if (!normalizedKeys.has(normalizeKey(key))) continue;
        const number = Number(item);
        if (Number.isFinite(number)) return number;
    }
    for (const item of Object.values(record)) {
        const found = readFirstNumber(item, keys, depth + 1);
        if (found !== undefined) return found;
    }
    return undefined;
}

function normalizeKey(value: string) {
    return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function formatNumber(value: number) {
    return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 4 }).format(value);
}

function formatCurrency(value: number) {
    return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}
