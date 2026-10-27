"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
    BookOpen,
    Cloud,
    ChevronDown,
    DatabaseBackup,
    ExternalLink,
    Globe2,
    HardDrive,
    KeyRound,
    Menu,
    MessageSquareText,
    PanelLeftClose,
    PanelLeftOpen,
    Palette,
    PlugZap,
    SlidersHorizontal,
    Sparkles,
    X,
} from "lucide-react";
import { canAccessAdminSection, type AdminSectionKey } from "@/components/admin/admin-sections";
import { SiteLogo } from "@/components/layout/site-logo";
import type { PublicUser } from "@/lib/auth/store";
import { DEFAULT_SITE_TITLE } from "@/lib/site-brand";
import { usePublicSessionStore } from "@/stores/use-public-session-store";

type AdminSection = { key: AdminSectionKey; label: string; description: string; shortDescription: string; icon: ReactNode };
type AdminSectionGroup = { title: string; items: AdminSection[] };

export function AdminSectionNav({
    activeKey,
    onChange,
    onIntent,
    mobileOpen,
    desktopCollapsed,
    onDesktopToggle,
    onMobileToggle,
    onMobileClose,
    currentUser,
}: {
    activeKey: AdminSectionKey;
    onChange: (key: AdminSectionKey) => void;
    onIntent?: (key: AdminSectionKey) => void;
    mobileOpen: boolean;
    desktopCollapsed: boolean;
    onDesktopToggle: () => void;
    onMobileToggle: () => void;
    onMobileClose: () => void;
    currentUser: PublicUser;
}) {
    const allowedGroups = adminSectionGroups.map((group) => ({ ...group, items: group.items.filter((section) => canAccessAdminSection(currentUser, section.key)) })).filter((group) => group.items.length);
    const activeGroup = allowedGroups.find((group) => group.items.some((section) => section.key === activeKey));
    const activeGroupTitle = activeGroup?.title;
    const site = usePublicSessionStore((state) => state.payload?.settings?.site) || { title: DEFAULT_SITE_TITLE, logoUrl: "/logo.svg" };
    const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!activeGroupTitle) return;
        setCollapsedGroups((current) => {
            const next = { ...current };
            if (next[activeGroupTitle]) next[activeGroupTitle] = false;
            return next;
        });
    }, [activeGroupTitle]);

    const renderSectionItems = (items: AdminSection[]) =>
        items.map((section) => {
            const active = section.key === activeKey;
            return (
                <button
                    key={section.key}
                    type="button"
                    title={desktopCollapsed ? section.label : undefined}
                    aria-label={section.label}
                    className={`admin-section-nav-item relative flex h-9 w-full min-w-0 items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition ${active ? "is-active bg-zinc-100 font-medium text-zinc-950 dark:bg-zinc-900 dark:text-zinc-50" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"}`}
                    onPointerEnter={() => onIntent?.(section.key)}
                    onPointerDown={() => onIntent?.(section.key)}
                    onFocus={() => onIntent?.(section.key)}
                    onClick={() => {
                        onChange(section.key);
                        onMobileClose();
                    }}
                >
                    <span className="admin-section-nav-icon flex size-4 shrink-0 items-center justify-center">{section.icon}</span>
                    <span className="admin-section-nav-copy min-w-0 truncate">{section.label}</span>
                </button>
            );
        });

    return (
        <aside className={`admin-section-nav h-dvh min-w-0 border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950 lg:sticky lg:top-0 lg:z-40 ${mobileOpen ? "is-open" : ""} ${desktopCollapsed ? "is-collapsed" : ""}`}>
            <div className="admin-section-nav-shell flex h-full max-w-full flex-col overflow-hidden">
                <div className="admin-section-mobile-head flex h-[58px] shrink-0 items-center justify-between border-b border-zinc-200 px-3 dark:border-zinc-800 lg:hidden">
                    <button
                        type="button"
                        className="admin-section-nav-toggle flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-200 dark:hover:bg-zinc-900"
                        aria-label={mobileOpen ? "收起设置侧边栏" : "展开设置侧边栏"}
                        aria-expanded={mobileOpen}
                        onClick={onMobileToggle}
                    >
                        {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
                    </button>
                    <Link href="/" className="admin-section-mobile-brand flex min-w-0 flex-1 items-center gap-2.5 px-1 text-zinc-950 dark:text-zinc-100" onClick={onMobileClose}>
                        <SiteLogo logoUrl={site.logoUrl} className="size-7" />
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{site.title}</span>
                            <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">设置中心</span>
                        </span>
                    </Link>
                </div>
                <div className="admin-section-desktop-head hidden h-[58px] shrink-0 min-w-0 items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800 lg:flex">
                    <Link href="/" className="admin-section-brand flex min-w-0 flex-1 items-center gap-2.5 text-zinc-950 dark:text-zinc-100">
                        <SiteLogo logoUrl={site.logoUrl} className="size-7" />
                        <span className="admin-section-brand-copy min-w-0">
                            <span className="block truncate text-sm font-semibold">{site.title}</span>
                            <span className="block truncate text-[10px] text-zinc-400 dark:text-zinc-500">设置中心</span>
                        </span>
                    </Link>
                    <button
                        type="button"
                        className="admin-section-desktop-toggle flex size-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-950 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-white"
                        aria-label={desktopCollapsed ? "展开设置侧边栏" : "收起设置侧边栏"}
                        aria-expanded={!desktopCollapsed}
                        title={desktopCollapsed ? "展开侧边栏" : "收起侧边栏"}
                        onClick={onDesktopToggle}
                    >
                        {desktopCollapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                    </button>
                </div>
                <div className="admin-section-nav-list flex flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto px-3 py-4">
                    {allowedGroups.map((group) => {
                        const collapsed = Boolean(collapsedGroups[group.title]) && !desktopCollapsed;
                        return (
                            <div key={group.title} className="admin-section-nav-group block min-w-0">
                                <button
                                    type="button"
                                    className="admin-section-nav-group-title relative flex w-full items-center rounded-md px-2 pb-1.5 pr-7 text-left text-[10px] font-semibold text-zinc-400 transition hover:text-zinc-700 dark:text-zinc-600 dark:hover:text-zinc-300"
                                    aria-expanded={!collapsed}
                                    aria-controls={`admin-section-group-${group.title}`}
                                    onClick={() => setCollapsedGroups((current) => ({ ...current, [group.title]: !current[group.title] }))}
                                >
                                    <span>{group.title}</span>
                                    <ChevronDown className={`admin-section-nav-group-chevron absolute right-2 top-1/2 size-3 shrink-0 -translate-y-1/2 transition-transform ${collapsed ? "-rotate-90" : ""}`} />
                                </button>
                                {!collapsed ? (
                                    <div id={`admin-section-group-${group.title}`} className="admin-section-nav-group-items flex flex-col gap-1">
                                        {renderSectionItems(group.items)}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </div>
        </aside>
    );
}

export const adminSections: AdminSection[] = [
    { key: "channels", label: "模型与工作流", description: "配置模型 API、逻辑模型、默认能力和 ComfyUI 工作流。", shortDescription: "模型连接", icon: <PlugZap className="size-4" /> },
    { key: "agentPrompts", label: "Agent 提示词", description: "编辑统一创作、无限画布和短剧项目实际使用的完整系统提示词。", shortDescription: "系统提示词", icon: <MessageSquareText className="size-4" /> },
    { key: "dramaStyles", label: "短剧提示词", description: "按人物、场景、道具、分镜图片和视频生成分类维护模板。", shortDescription: "短剧模板", icon: <Palette className="size-4" /> },
    { key: "skills", label: "Agent Skills", description: "管理 Agent 专业能力、触发词、来源和执行规则。", shortDescription: "专业能力", icon: <Sparkles className="size-4" /> },
    { key: "prompts", label: "提示词库", description: "维护本地创作界面可以重复使用的提示词。", shortDescription: "创作模板", icon: <KeyRound className="size-4" /> },
    { key: "site", label: "应用外观", description: "管理应用名称、Logo、图标和界面品牌信息。", shortDescription: "名称与图标", icon: <Globe2 className="size-4" /> },
    { key: "settings", label: "通用设置", description: "管理生成行为、邮件能力和本地数据维护选项。", shortDescription: "应用行为", icon: <SlidersHorizontal className="size-4" /> },
    { key: "mediaStorage", label: "本地媒体", description: "查看本机图片、视频和音频文件，管理临时期限与长期存储。", shortDescription: "文件与期限", icon: <HardDrive className="size-4" /> },
    { key: "externalStorage", label: "外部存储", description: "配置 S3 兼容存储，迁移本地媒体并管理外部对象。", shortDescription: "S3 与 OSS", icon: <Cloud className="size-4" /> },
    { key: "backup", label: "数据备份", description: "导出和恢复本地配置与创作数据，并管理媒体备份边界。", shortDescription: "导入与恢复", icon: <DatabaseBackup className="size-4" /> },
    { key: "updates", label: "版本更新", description: "查看应用版本、更新日志和可用更新。", shortDescription: "升级维护", icon: <ExternalLink className="size-4" /> },
    { key: "adminHelp", label: "使用文档", description: "查看模型、服务器、工作流与本地存储的配置说明。", shortDescription: "配置帮助", icon: <BookOpen className="size-4" /> },
];

export const adminSectionGroups: AdminSectionGroup[] = [
    { title: "AI 与模型", items: sectionsFor(["channels", "agentPrompts", "skills"]) },
    { title: "创作", items: sectionsFor(["dramaStyles", "prompts"]) },
    { title: "应用", items: sectionsFor(["site", "settings"]) },
    { title: "存储与数据", items: sectionsFor(["mediaStorage", "externalStorage", "backup"]) },
    { title: "关于", items: sectionsFor(["updates", "adminHelp"]) },
];

function sectionsFor(keys: AdminSectionKey[]) {
    const sections = new Map(adminSections.map((section) => [section.key, section]));
    return keys.map((key) => sections.get(key)).filter((section): section is AdminSection => Boolean(section));
}
