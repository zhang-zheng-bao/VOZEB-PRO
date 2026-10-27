"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";
import { Keyboard, LogOut, Settings, UserCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MenuProps } from "antd";
import { App, Dropdown } from "antd";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { AnnouncementNotificationCenter } from "@/components/layout/announcement-notification-center";
import { ComfyUiServerControl } from "@/components/layout/comfyui-server-control";
import { cn } from "@/lib/utils";
import { userAvatarFallback } from "@/lib/user-avatar";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { resetClientSessionState } from "@/lib/client-session-reset";
import { fetchRunningHubAccountSummary, onRunningHubBalanceRefresh, requestRunningHubBalanceRefresh, type RunningHubAccountSummary } from "@/services/api/runninghub-balance";

type UserStatusActionsProps = {
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    initialUser?: LocalUser;
};

export function UserStatusActions({ variant = "default", onOpenShortcuts, initialUser }: UserStatusActionsProps) {
    const router = useRouter();
    const { message } = App.useApp();
    const [accountOpen, setAccountOpen] = useState(false);
    const [isCompactViewport, setIsCompactViewport] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const storeUser = useUserStore((state) => state.user);
    const user = storeUser || initialUser || null;
    const personalMode = user?.id === "local-personal-user";
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const canvasTheme = canvasThemes[theme];
    const defaultControlClass =
        "inline-flex h-8 shrink-0 items-center justify-center rounded-lg border border-[#e6e9ed] bg-white text-sm font-medium text-[#59616c] transition hover:border-[#d9dde3] hover:bg-[#f3f5f7] hover:text-[#20242a] dark:border-[#2c3138] dark:bg-[#181b20] dark:text-[#b7bec8] dark:hover:border-[#3b424c] dark:hover:bg-[#22262c] dark:hover:text-white";
    const canvasControlClass =
        "inline-flex h-9 shrink-0 items-center justify-center rounded-xl border px-2.5 text-sm font-medium shadow-sm transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/35 [&_svg]:size-4";
    const canvasIconClass = cn(canvasControlClass, "w-9 px-0");
    const canvasControlStyle: CSSProperties | undefined =
        variant === "canvas"
            ? {
                  background: canvasTheme.toolbar.panel,
                  borderColor: canvasTheme.toolbar.border,
                  boxShadow: theme === "dark" ? "0 10px 30px rgba(0,0,0,.28)" : "0 10px 24px rgba(28,25,23,.08)",
                  color: canvasTheme.toolbar.item,
              }
            : undefined;
    const naturalIconClass = variant === "canvas" ? canvasIconClass : cn(defaultControlClass, "w-8 px-0 [&_svg]:size-4");
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? canvasControlStyle : undefined;
    const avatarUrl = user?.avatarUrl?.trim();
    const avatarFallback = userAvatarFallback(user?.displayName || user?.username || "用户");
    const accountName = user?.displayName || user?.username || "用户";
    const accountSecondary = user ? `ID：${user.accountId}` : "";
    const accountItems: MenuProps["items"] = [
        {
            type: "group",
            label: (
                <div className="w-full py-0.5">
                    <div className="flex items-center gap-2.5">
                        {avatarUrl ? (
                            <img src={avatarUrl} alt="" className="size-9 rounded-lg object-cover" referrerPolicy="no-referrer" />
                        ) : (
                            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[#66758e] text-[11px] font-semibold text-white dark:bg-[#d8dee8] dark:text-[#252b33]">{avatarFallback}</span>
                        )}
                        <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-stone-950 dark:text-stone-100">{accountName}</div>
                            {accountSecondary ? (
                                <div className="mt-0.5 truncate text-xs text-stone-400 dark:text-stone-500" title={accountSecondary}>
                                    {accountSecondary}
                                </div>
                            ) : null}
                        </div>
                    </div>
                </div>
            ),
            children: [],
        },
        { type: "divider" },
        {
            key: "profile",
            icon: <UserCircle className="size-4" />,
            label: (
                <Link href="/profile" prefetch onMouseEnter={() => router.prefetch("/profile")} onFocus={() => router.prefetch("/profile")}>
                    个人中心
                </Link>
            ),
        },
        ...(user?.role === "admin"
            ? [
                  { type: "divider" as const },
                  {
                      key: "settings",
                      icon: <Settings className="size-4" />,
                      label: (
                          <Link href="/settings" prefetch onMouseEnter={() => router.prefetch("/settings")} onFocus={() => router.prefetch("/settings")}>
                              设置
                          </Link>
                      ),
                  },
              ]
            : []),
        { type: "divider" },
        {
            key: "logout",
            icon: <LogOut className="size-4" />,
            label: "退出登录",
            danger: true,
        },
    ];

    useEffect(() => {
        if (user?.role === "admin") router.prefetch("/settings");
        if (user) {
            router.prefetch("/canvas");
            router.prefetch("/profile");
        }
    }, [router, user]);

    useEffect(() => {
        const mediaQuery = window.matchMedia("(max-width: 520px)");
        const syncViewport = () => setIsCompactViewport(mediaQuery.matches);
        syncViewport();
        mediaQuery.addEventListener("change", syncViewport);
        return () => mediaQuery.removeEventListener("change", syncViewport);
    }, []);

    const handleMenuClick: MenuProps["onClick"] = async ({ key }) => {
        if (key !== "logout") return;
        try {
            await fetch("/api/auth/logout", { method: "POST" });
            await resetClientSessionState();
            router.replace("/login");
            router.refresh();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "退出登录失败");
        }
    };

    const handleAccountMenuClick: MenuProps["onClick"] = (info) => {
        setAccountOpen(false);
        void handleMenuClick(info);
    };

    useEffect(() => {
        if (variant !== "canvas" || !accountOpen) return;
        const closeCanvasPopups = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (rootRef.current?.contains(target)) return;
            if (target instanceof Element && target.closest(".ant-dropdown, .ant-dropdown-menu, .ant-dropdown-menu-submenu, .ant-dropdown-menu-submenu-popup")) {
                return;
            }
            setAccountOpen(false);
        };
        document.addEventListener("pointerdown", closeCanvasPopups, true);
        return () => document.removeEventListener("pointerdown", closeCanvasPopups, true);
    }, [variant, accountOpen]);

    const handleAccountOpenChange = (open: boolean) => {
        setAccountOpen(open);
    };

    return (
        <div ref={rootRef} className={cn("user-status-actions inline-flex max-w-full items-center gap-1.5 sm:gap-2", variant === "canvas" ? "canvas-user-status-actions shrink-0" : "app-user-status-actions min-w-0")}>
            {user ? <RunningHubBalanceBadge compact={isCompactViewport} style={iconStyle} className={variant === "canvas" ? "canvas-rh-balance-action" : "app-rh-balance-action"} /> : null}
            {variant === "canvas" && personalMode ? <ComfyUiServerControl buttonClassName={cn(naturalIconClass, "canvas-comfyui-action")} buttonStyle={iconStyle} /> : null}
            {variant !== "canvas" ? (
                <AnnouncementNotificationCenter
                    compact={isCompactViewport}
                    buttonClassName={cn(naturalIconClass, "app-notification-action")}
                    buttonStyle={iconStyle}
                    onOpen={() => setAccountOpen(false)}
                />
            ) : null}
            {variant !== "canvas" ? (
                <AnimatedThemeToggler
                    theme={theme}
                    onThemeChange={setTheme}
                    className={naturalIconClass}
                    style={iconStyle}
                    aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                    title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"}
                />
            ) : null}
            {variant !== "canvas" && user ? (
                <>
                    <Dropdown rootClassName="account-menu-dropdown" open={accountOpen} onOpenChange={handleAccountOpenChange} menu={{ items: accountItems, onClick: handleAccountMenuClick }} trigger={["click"]} placement="bottomRight">
                        <button
                            type="button"
                            className={cn(
                                defaultControlClass,
                                "app-account-action size-8 rounded-full border-0 bg-transparent p-0 hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent",
                            )}
                            style={iconStyle}
                            aria-label="账户菜单"
                            title={user.displayName || user.username}
                        >
                            {avatarUrl ? (
                                <img src={avatarUrl} alt="" className="size-full rounded-full object-cover" referrerPolicy="no-referrer" />
                            ) : (
                                <span
                                    aria-hidden="true"
                                    className="user-avatar-fallback grid size-full place-items-center rounded-full bg-[#66758e] text-[11px] font-semibold leading-none text-white ring-1 ring-black/5 transition hover:bg-[#586983] dark:bg-[#d8dee8] dark:text-[#252b33] dark:ring-white/10 dark:hover:bg-white"
                                >
                                    {avatarFallback}
                                </span>
                            )}
                        </button>
                    </Dropdown>
                </>
            ) : variant !== "canvas" ? (
                <Link href="/login" className={cn(defaultControlClass, "gap-2 px-2.5")} style={iconStyle}>
                    <UserCircle className="size-4" />
                    <span className="hidden sm:inline">登录</span>
                </Link>
            ) : null}
            {onOpenShortcuts ? (
                <button type="button" className={cn(naturalIconClass, variant === "canvas" && "canvas-shortcuts-action")} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
        </div>
    );
}

function RunningHubBalanceBadge({ compact, className, style }: { compact: boolean; className?: string; style?: CSSProperties }) {
    const [summary, setSummary] = useState<RunningHubAccountSummary | null>(null);
    const [loading, setLoading] = useState(false);

    const refresh = async () => {
        if (loading) return;
        setLoading(true);
        try {
            setSummary(await fetchRunningHubAccountSummary());
        } catch (error) {
            setSummary({ configured: false, error: error instanceof Error ? error.message : "RH 余额加载失败" });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void refresh();
        return onRunningHubBalanceRefresh(() => void refresh());
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    if (summary?.configured === false) return null;
    const coinText = summary?.displayBalance || (loading ? "..." : "--");
    const moneyText = summary?.displayWalletBalance || "";
    const title = summary?.error
        ? `RH 余额：${summary.error}`
        : [`RH 币余额：${summary?.displayBalance || "--"}`, `人民币余额：${moneyText || "--"}`, summary?.updatedAt ? `更新于 ${new Date(summary.updatedAt).toLocaleTimeString("zh-CN")}` : ""].filter(Boolean).join("，");
    return (
        <button
            type="button"
            className={cn("inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-[#e6e9ed] bg-white px-2 text-xs font-semibold text-[#59616c] transition hover:border-[#d9dde3] hover:bg-[#f3f5f7] hover:text-[#20242a] dark:border-[#2c3138] dark:bg-[#181b20] dark:text-[#b7bec8] dark:hover:border-[#3b424c] dark:hover:bg-[#22262c] dark:hover:text-white", className)}
            style={style}
            title={title}
            onClick={() => {
                requestRunningHubBalanceRefresh();
                void refresh();
            }}
        >
            <span className="rounded bg-stone-900 px-1 text-[10px] font-bold leading-4 text-white dark:bg-white dark:text-stone-950">RH</span>
            <span className={cn("tabular-nums", compact && "max-w-12 truncate")}>{coinText}</span>
            {moneyText ? (
                <>
                    <span className="text-stone-300 dark:text-stone-600">·</span>
                    <span className={cn("tabular-nums text-emerald-700 dark:text-emerald-300", compact && "max-w-16 truncate")}>{moneyText}</span>
                </>
            ) : null}
        </button>
    );
}
