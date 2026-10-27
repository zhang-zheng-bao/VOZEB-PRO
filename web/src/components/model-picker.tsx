"use client";

import { useEffect, useId, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { Check, ChevronDown, Cpu, Image as ImageIcon, Search, Server, Video } from "lucide-react";
import { Dropdown } from "antd";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { inferVideoModelFeatures, videoModelCapabilityTags, type VideoModelFeatures } from "@/lib/video-model-classification";
import { modelOptionLabel, modelOptionName, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig, type ModelCapability } from "@/stores/use-config-store";

type ModelPickerProps = {
    config: AiConfig;
    value?: string;
    onChange: (model: string) => void;
    capability?: ModelCapability;
    className?: string;
    fullWidth?: boolean;
    placeholder?: string;
    onMissingConfig?: () => void;
};

export function ModelPicker({ config, value, onChange, capability, className, fullWidth = false, placeholder = "选择模型", onMissingConfig }: ModelPickerProps) {
    const pickerId = useId();
    const [open, setOpen] = useState(false);
    const configuredOptions = useMemo(() => selectableModelsByCapability(config, capability), [capability, config]);
    const current = !capability || !value || configuredOptions.includes(value) ? value || "" : "";
    const options = useMemo(() => {
        const currentOption = !capability || !value || configuredOptions.includes(value) ? value : "";
        return Array.from(new Set([currentOption, ...configuredOptions].filter((model): model is string => Boolean(model))));
    }, [capability, configuredOptions, value]);
    const hasConfiguredOptions = configuredOptions.length > 0;

    useEffect(() => {
        const closeOtherPicker = (event: Event) => {
            if ((event as CustomEvent<string>).detail !== pickerId) setOpen(false);
        };
        window.addEventListener("model-picker-open", closeOtherPicker);
        return () => window.removeEventListener("model-picker-open", closeOtherPicker);
    }, [pickerId]);

    if (capability === "image" || capability === "video") {
        const MediaPicker = capability === "image" ? ImageModelPicker : VideoModelPicker;
        return (
            <MediaPicker
                config={config}
                value={current}
                options={options}
                open={open}
                setOpen={(nextOpen) => {
                    if (nextOpen && !hasConfiguredOptions) {
                        setOpen(false);
                        onMissingConfig?.();
                        return;
                    }
                    if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                    setOpen(nextOpen);
                }}
                onChange={onChange}
                className={className}
                fullWidth={fullWidth}
                placeholder={placeholder}
                emptyLabel={emptyModelLabel(config, capability)}
            />
        );
    }

    return (
        <Select
            open={open}
            value={current}
            onOpenChange={(nextOpen) => {
                if (nextOpen && !hasConfiguredOptions) {
                    setOpen(false);
                    onMissingConfig?.();
                    return;
                }
                if (nextOpen) window.dispatchEvent(new CustomEvent("model-picker-open", { detail: pickerId }));
                setOpen(nextOpen);
            }}
            onValueChange={onChange}
        >
            <SelectTrigger
                className={cn(
                    "canvas-composer-model-picker h-8 w-fit max-w-full gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                    fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                    "data-[state=open]:border-ring data-[state=open]:ring-2 data-[state=open]:ring-ring/20",
                    className,
                )}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title={current ? modelOptionLabel(config, current) : placeholder}
            >
                <ModelIcon model={current} />
                <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{current ? compactModelOptionLabel(config, current) : placeholder}</span>
            </SelectTrigger>
            <SelectContent
                data-canvas-no-zoom
                className="z-[1200] max-h-[min(18rem,calc(100vh-96px))] w-[min(20rem,var(--radix-select-content-available-width))] min-w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-32px)] rounded-xl border border-border/70 bg-popover p-1 shadow-xl"
                position="popper"
                align="start"
                side="bottom"
                sideOffset={6}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                {options.length ? (
                    options.map((model) => (
                        <SelectItem key={model} value={model} textValue={compactModelOptionLabel(config, model)}>
                            <ModelLabel config={config} model={model} />
                        </SelectItem>
                    ))
                ) : (
                    <SelectItem value="__empty__" disabled>
                        {emptyModelLabel(config, capability)}
                    </SelectItem>
                )}
            </SelectContent>
        </Select>
    );
}

type ImageFilterId = "all" | "text" | "edit";

const IMAGE_FILTERS: Array<{ id: ImageFilterId; label: string }> = [
    { id: "all", label: "全部模型" },
    { id: "text", label: "文生图" },
    { id: "edit", label: "图片编辑" },
];

function ImageModelPicker(props: Parameters<typeof VideoModelPicker>[0]) {
    const { config, value, options, open, setOpen, onChange, className, fullWidth, placeholder, emptyLabel } = props;
    const [filter, setFilter] = useState<ImageFilterId>("all");
    const [family, setFamily] = useState("全部");
    const entries = useMemo(() => options.map((model) => imageModelEntry(config, model)), [config, options]);
    const filteredByMode = useMemo(() => entries.filter((entry) => filter === "all" || entry.modes.includes(filter)), [entries, filter]);
    const families = useMemo(() => mediaModelFamilies(filteredByMode), [filteredByMode]);
    const activeFamily = families.some((item) => item.name === family) ? family : "全部";
    const visibleEntries = activeFamily === "全部" ? filteredByMode : filteredByMode.filter((entry) => entry.family === activeFamily);

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            rootClassName="canvas-media-model-dropdown"
            open={open}
            onOpenChange={setOpen}
            popupRender={() => (
                <div
                    data-canvas-no-zoom
                    className="w-[min(680px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border/70 bg-popover text-popover-foreground shadow-2xl"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="border-b border-border/70 px-3 py-2.5">
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Search className="size-3.5" />
                            <span>按用途选择图片模型</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {IMAGE_FILTERS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                        "h-7 rounded-full border px-3 text-xs font-medium transition-colors",
                                        filter === item.id ? "!border-slate-900 !bg-slate-900 !text-white" : "border-border/80 bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                    )}
                                    onClick={() => {
                                        setFilter(item.id);
                                        setFamily("全部");
                                    }}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid max-h-[min(28rem,calc(100vh-150px))] grid-cols-[132px_minmax(0,1fr)]">
                        <div className="thin-scrollbar overflow-y-auto border-r border-border/70 p-2">
                            {families.map((item) => (
                                <button
                                    key={item.name}
                                    type="button"
                                    className={cn("mb-1 flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs transition-colors", activeFamily === item.name ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground")}
                                    onClick={() => setFamily(item.name)}
                                >
                                    <span className="truncate font-medium">{item.name}</span>
                                    <span className="rounded-full bg-background/70 px-1.5 text-[10px] tabular-nums opacity-70">{item.count}</span>
                                </button>
                            ))}
                        </div>
                        <div className="thin-scrollbar max-h-[min(28rem,calc(100vh-150px))] overflow-y-auto p-2">
                            {visibleEntries.length ? (
                                <div className="grid gap-1.5">
                                    {visibleEntries.map((entry) => (
                                        <button
                                            key={entry.model}
                                            type="button"
                                            className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors", entry.model === value ? "border-foreground bg-accent" : "border-transparent hover:border-border hover:bg-accent/70")}
                                            title={entry.fullLabel}
                                            onClick={() => {
                                                onChange(entry.model);
                                                setOpen(false);
                                            }}
                                        >
                                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
                                                <ImageIcon className="size-4" />
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold">{entry.label}</span>
                                                <span className="mt-1 flex flex-wrap gap-1">
                                                    {entry.tags.map((tag) => (
                                                        <span key={tag} className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </span>
                                            </span>
                                            {entry.model === value ? <Check className="size-4 shrink-0" /> : null}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid h-32 place-items-center rounded-xl border border-dashed border-border/80 text-xs text-muted-foreground">{options.length ? "这个分类下暂无模型" : emptyLabel}</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        >
            <ModelPickerTrigger config={config} value={value} open={open} className={className} fullWidth={fullWidth} placeholder={placeholder} />
        </Dropdown>
    );
}

type VideoFilterId = "all" | "server" | "text" | "image" | "frames" | "reference" | "other";

const VIDEO_FILTERS: Array<{ id: VideoFilterId; label: string }> = [
    { id: "all", label: "云端模型" },
    { id: "server", label: "服务器" },
    { id: "text", label: "文生视频" },
    { id: "image", label: "图生视频" },
    { id: "frames", label: "首尾帧" },
    { id: "reference", label: "全能参考" },
    { id: "other", label: "其他" },
];

function VideoModelPicker({
    config,
    value,
    options,
    open,
    setOpen,
    onChange,
    className,
    fullWidth,
    placeholder,
    emptyLabel,
}: {
    config: AiConfig;
    value: string;
    options: string[];
    open: boolean;
    setOpen: (open: boolean) => void;
    onChange: (model: string) => void;
    className?: string;
    fullWidth: boolean;
    placeholder: string;
    emptyLabel: string;
}) {
    const [filter, setFilter] = useState<VideoFilterId>(() => value && isServerVideoModel(config, value) ? "server" : "all");
    const [family, setFamily] = useState("全部");
    const entries = useMemo(() => options.map((model) => videoModelEntry(config, model)), [config, options]);
    const filteredByMode = useMemo(() => entries.filter((entry) => videoEntryMatchesFilter(entry, filter)), [entries, filter]);
    const families = useMemo(() => {
        const counts = new Map<string, number>();
        filteredByMode.forEach((entry) => counts.set(entry.family, (counts.get(entry.family) || 0) + 1));
        return [{ name: "全部", count: filteredByMode.length }, ...Array.from(counts.entries()).map(([name, count]) => ({ name, count }))];
    }, [filteredByMode]);
    const activeFamily = families.some((item) => item.name === family) ? family : "全部";
    const visibleEntries = activeFamily === "全部" ? filteredByMode : filteredByMode.filter((entry) => entry.family === activeFamily);
    const currentLabel = value ? compactModelOptionLabel(config, value) : placeholder;

    return (
        <Dropdown
            trigger={["click"]}
            placement="bottomLeft"
            rootClassName="canvas-media-model-dropdown"
            open={open}
            onOpenChange={setOpen}
            popupRender={() => (
                <div
                    data-canvas-no-zoom
                    className="w-[min(680px,calc(100vw-32px))] overflow-hidden rounded-2xl border border-border/70 bg-popover text-popover-foreground shadow-2xl"
                    onPointerDown={(event) => event.stopPropagation()}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => event.stopPropagation()}
                >
                    <div className="border-b border-border/70 px-3 py-2.5">
                        <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                            <Search className="size-3.5" />
                            <span>按用途选择视频模型</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {VIDEO_FILTERS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={cn(
                                        "h-7 rounded-full border px-3 text-xs font-medium transition-colors",
                                        filter === item.id ? "!border-slate-900 !bg-slate-900 !text-white" : "border-border/80 bg-transparent text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                                    )}
                                    onClick={() => {
                                        setFilter(item.id);
                                        setFamily("全部");
                                    }}
                                >
                                    {item.label}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="grid max-h-[min(28rem,calc(100vh-150px))] grid-cols-[132px_minmax(0,1fr)]">
                        <div className="thin-scrollbar overflow-y-auto border-r border-border/70 p-2">
                            {families.map((item) => (
                                <button
                                    key={item.name}
                                    type="button"
                                    className={cn("mb-1 flex h-9 w-full items-center justify-between rounded-lg px-2.5 text-left text-xs transition-colors", activeFamily === item.name ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground")}
                                    onClick={() => setFamily(item.name)}
                                >
                                    <span className="truncate font-medium">{item.name}</span>
                                    <span className="rounded-full bg-background/70 px-1.5 text-[10px] tabular-nums opacity-70">{item.count}</span>
                                </button>
                            ))}
                        </div>
                        <div className="thin-scrollbar max-h-[min(28rem,calc(100vh-150px))] overflow-y-auto p-2">
                            {visibleEntries.length ? (
                                <div className="grid gap-1.5">
                                    {visibleEntries.map((entry) => (
                                        <button
                                            key={entry.model}
                                            type="button"
                                            className={cn("flex min-h-14 w-full items-center gap-3 rounded-xl border p-2.5 text-left transition-colors", entry.model === value ? "border-foreground bg-accent" : "border-transparent hover:border-border hover:bg-accent/70")}
                                            title={entry.fullLabel}
                                            onClick={() => {
                                                onChange(entry.model);
                                                setOpen(false);
                                            }}
                                        >
                                            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-background text-muted-foreground">
                                                {entry.server ? <Server className="size-4" /> : <Video className="size-4" />}
                                            </span>
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm font-semibold">{entry.label}</span>
                                                <span className="mt-1 flex flex-wrap gap-1">
                                                    {entry.tags.map((tag) => (
                                                        <span key={tag} className="rounded-full border border-border/70 px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground">
                                                            {tag}
                                                        </span>
                                                    ))}
                                                </span>
                                            </span>
                                            {entry.model === value ? <Check className="size-4 shrink-0" /> : null}
                                        </button>
                                    ))}
                                </div>
                            ) : (
                                <div className="grid h-32 place-items-center rounded-xl border border-dashed border-border/80 text-xs text-muted-foreground">{options.length ? "这个分类下暂无模型" : emptyLabel}</div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        >
            <ModelPickerTrigger config={config} value={value} open={open} className={className} fullWidth={fullWidth} placeholder={placeholder} label={currentLabel} />
        </Dropdown>
    );
}

function ModelPickerTrigger({ config, value, open, className, fullWidth, placeholder, label, ...buttonProps }: { config: AiConfig; value: string; open: boolean; className?: string; fullWidth: boolean; placeholder: string; label?: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value">) {
    return (
        <button
            {...buttonProps}
            type="button"
            data-canvas-no-zoom
            className={cn(
                "canvas-composer-model-picker inline-flex h-8 max-w-full items-center gap-2 rounded-full border border-input bg-transparent px-3 text-sm font-normal shadow-sm transition-colors",
                fullWidth ? "w-full min-w-0 justify-start" : "min-w-[9rem] justify-start",
                open && "border-ring ring-2 ring-ring/20",
                className,
            )}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            title={value ? modelOptionLabel(config, value) : placeholder}
        >
            <ModelIcon model={value} />
            <span className="canvas-model-picker-text min-w-0 flex-1 truncate text-left">{label || (value ? compactModelOptionLabel(config, value) : placeholder)}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        </button>
    );
}

function emptyModelLabel(config: AiConfig, capability?: ModelCapability) {
    const label = capability === "image" ? "生图" : capability === "video" ? "视频" : capability === "text" ? "文本" : capability === "audio" ? "音频" : "";
    if (capability && config.models.length) return `暂无匹配的${label}模型`;
    return config.models.length ? `暂无匹配的${label}模型` : "请联系管理员在后台配置渠道和模型";
}

function ModelLabel({ config, model }: { config: AiConfig; model: string }) {
    return (
        <span className="flex min-w-0 items-center gap-2">
            <ModelIcon model={model} />
            <span className="truncate">{compactModelOptionLabel(config, model)}</span>
        </span>
    );
}

export function ModelIcon({ model }: { model: string }) {
    const icon = resolveModelIcon(modelOptionName(model));
    if (icon === "video") return <Video className="size-4 shrink-0 opacity-75" />;
    return icon ? <img src={icon} alt="" className="size-4 shrink-0 dark:invert" /> : <Cpu className="size-4 shrink-0 opacity-70" />;
}

function resolveModelIcon(model: string) {
    const name = model.toLowerCase();
    if (name.includes("claude") || name.includes("anthropic")) return "/icons/claude.svg";
    if (name.includes("gemini") || name.includes("google")) return "/icons/gemini.svg";
    if (name.includes("gpt") || name.includes("openai")) return "/icons/openai.svg";
    if (name.includes("grok")) return "/icons/grok.svg";
    if (name.includes("deepseek")) return "/icons/deepseek.svg";
    if (name.includes("glm")) return "/icons/glm.svg";
    if (name.includes("vidu") || name.includes("runninghub") || name.includes("rh-video") || name.includes("seedance") || name.includes("wan-")) return "video";
    return "";
}

export function compactModelOptionLabel(config: AiConfig, value: string) {
    return compactModelDisplayName(config, value);
}

export function imageModelFamilyLabel(input: string) {
    const name = input.toLowerCase();
    if (name.includes("nano-banana") || name.includes("gemini")) return "Nano Banana";
    if (name.includes("seedream") || name.includes("doubao")) return "Seedream";
    if (name.includes("gpt-image") || name.includes("openai")) return "GPT Image";
    if (name.includes("qwen")) return "Qwen Image";
    if (name.includes("flux")) return "Flux";
    if (name.includes("midjourney") || name.includes("mj-")) return "Midjourney";
    if (name.includes("stable-diffusion") || name.includes("sdxl")) return "Stable Diffusion";
    if (name.includes("recraft")) return "Recraft";
    if (name.includes("ideogram")) return "Ideogram";
    if (name.includes("wan-")) return "Wan";
    return "其他";
}

function imageModelEntry(config: AiConfig, model: string) {
    const fullLabel = modelOptionLabel(config, model);
    const requestConfig = resolveModelRequestConfig(config, model);
    const advanced = requestConfig.advancedConfig;
    const source = `${fullLabel} ${modelOptionName(model)} ${advanced?.createPath || ""} ${advanced?.editPath || ""}`.toLowerCase();
    const supportsEdit = Boolean(advanced?.editPath || advanced?.supportsReferenceImage || /(?:image-to-image|image-edit|\/edit(?:\/|$)|edit-)/i.test(source));
    const supportsText = /(?:text-to-image|text2image|t2i)/i.test(source) || !supportsEdit;
    const modes: ImageFilterId[] = [...(supportsText ? (["text"] as const) : []), ...(supportsEdit ? (["edit"] as const) : [])];
    return {
        model,
        fullLabel,
        label: compactModelOptionLabel(config, model),
        family: imageModelFamilyLabel(source),
        modes,
        tags: [supportsText ? "文生图" : "", supportsEdit ? "图片编辑" : ""].filter(Boolean),
    };
}

function mediaModelFamilies(entries: Array<{ family: string }>) {
    const counts = new Map<string, number>();
    entries.forEach((entry) => counts.set(entry.family, (counts.get(entry.family) || 0) + 1));
    return [{ name: "全部", count: entries.length }, ...Array.from(counts.entries()).map(([name, count]) => ({ name, count }))];
}

function videoModelEntry(config: AiConfig, model: string) {
    const fullLabel = modelOptionLabel(config, model);
    const rawName = `${fullLabel} ${modelOptionName(model)}`;
    const features = videoModelFeatures(config, model, rawName);
    const server = isServerVideoModel(config, model);
    return {
        model,
        fullLabel,
        label: compactModelOptionLabel(config, model),
        family: server ? "服务器" : videoModelFamilyLabel(rawName),
        server,
        tags: videoModelCapabilityTags(features),
    };
}

function compactModelDisplayName(config: AiConfig, value: string) {
    const logical = config.logicalModels.find((model) => model.id.toLowerCase() === value.toLowerCase());
    if (logical?.id.toLowerCase().startsWith("comfyui-")) return logical.name;
    const upstream = logical?.bindings.find((binding) => binding.enabled)?.upstreamModel || logical?.bindings[0]?.upstreamModel;
    const label = upstream || modelOptionName(value) || modelOptionLabel(config, value);
    return cleanModelDisplayName(label);
}

function cleanModelDisplayName(input: string) {
    const normalized = input
        .replace(/（[^）]+）$/g, "")
        .replace(/\([^)]*\)$/g, "")
        .replace(/^RH\s*视频\s*-\s*/i, "")
        .replace(/^rh-video-/i, "")
        .replace(/-[a-f0-9]{8}$/i, "")
        .replace(/\s+/g, " ")
        .replace(/official-stable|channel-low-price|comfyui|bf16|safetensors/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
    return normalized || input;
}

function videoModelFamilyLabel(input: string) {
    const name = input.toLowerCase();
    if (name.includes("seedance") || name.includes("doubao") || name.includes("volc")) return "Seedance";
    if (name.includes("kling") || name.includes("kwaivgi")) return "Kling";
    if (name.includes("minimax") || name.includes("hailuo") || name.includes("h3")) return "MiniMax";
    if (name.includes("wan")) return "Wan";
    if (name.includes("vidu")) return "Vidu";
    if (name.includes("runway")) return "Runway";
    if (name.includes("sora")) return "Sora";
    if (name.includes("grok") || name.includes("xai")) return "Grok";
    return "其他";
}

function videoModelFeatures(config: AiConfig, model: string, fallbackName: string): VideoModelFeatures {
    const requestConfig = resolveModelRequestConfig(config, model);
    const advanced = requestConfig.advancedConfig;
    const logical = config.logicalModels.find((item) => item.id.toLowerCase() === model.toLowerCase());
    const profile = logical?.bindings.find((binding) => binding.enabled)?.capabilityProfile;
    return inferVideoModelFeatures({
        model: modelOptionName(model),
        label: fallbackName,
        template: advanced?.requestTemplate,
        createPath: advanced?.createPath,
        imageToVideoPath: advanced?.imageToVideoPath,
        durationRange: advanced?.durationRange,
        supportsReferenceImage: advanced?.supportsReferenceImage || profile?.supportsReferenceImage,
        supportsReferenceVideo: advanced?.supportsReferenceVideo || profile?.supportsReferenceVideo,
        supportsReferenceAudio: advanced?.supportsReferenceAudio || profile?.supportsReferenceAudio,
        maxReferenceImages: profile?.maxReferenceImages,
        minDurationSeconds: profile?.minDurationSeconds,
        maxDurationSeconds: profile?.maxDurationSeconds,
    });
}

function videoEntryMatchesFilter(entry: ReturnType<typeof videoModelEntry>, filter: VideoFilterId) {
    if (filter === "server") return entry.server;
    if (entry.server) return false;
    if (filter === "all") return true;
    const tags = new Set(entry.tags);
    if (filter === "text") return tags.has("文生视频");
    if (filter === "image") return tags.has("图生视频");
    if (filter === "frames") return tags.has("首尾帧");
    if (filter === "reference") return tags.has("全能参考") || tags.has("视频参考") || tags.has("音频");
    return tags.has("视频延长") || tags.has("视频编辑") || tags.has("画质增强") || (entry.family === "其他" && !tags.has("文生视频") && !tags.has("图生视频") && !tags.has("首尾帧") && !tags.has("全能参考"));
}

function isServerVideoModel(config: AiConfig, model: string) {
    return config.logicalModels.some((item) => item.id === model && item.id.toLowerCase().startsWith("comfyui-")) || resolveModelRequestConfig(config, model).advancedConfig?.protocol === "comfyui";
}
