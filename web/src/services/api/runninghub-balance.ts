"use client";

export type RunningHubAccountSummary = {
    configured?: boolean;
    balance?: number;
    displayBalance?: string;
    runningTasks?: number;
    walletBalance?: number;
    displayWalletBalance?: string;
    updatedAt?: string;
    error?: string;
};

const REFRESH_EVENT = "runninghub-balance-refresh";

export async function fetchRunningHubAccountSummary(): Promise<RunningHubAccountSummary> {
    const response = await fetch("/api/runninghub/account", { cache: "no-store" });
    const payload = (await response.json().catch(() => ({}))) as RunningHubAccountSummary;
    if (!response.ok) throw new Error(payload.error || "RunningHub 余额加载失败");
    return payload;
}

export function requestRunningHubBalanceRefresh() {
    if (typeof window === "undefined") return;
    window.dispatchEvent(new Event(REFRESH_EVENT));
}

export function onRunningHubBalanceRefresh(listener: () => void) {
    window.addEventListener(REFRESH_EVENT, listener);
    return () => window.removeEventListener(REFRESH_EVENT, listener);
}
