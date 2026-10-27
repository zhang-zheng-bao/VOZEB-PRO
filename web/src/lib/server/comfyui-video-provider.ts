import type { SystemChannelAdvancedConfig } from "@/lib/auth/store-types";
import { buildComfyUiPrompt, isComfyUiGenerationMode, parseComfyUiWorkflowConfig, type ComfyUiGenerationMode } from "@/lib/comfyui-workflow";

export function buildComfyUiVideoRequest(input: {
    config: SystemChannelAdvancedConfig | undefined;
    prompt: string;
    raw: Record<string, unknown>;
    references: Array<{ type: "image" | "video" | "audio"; name: string }>;
}) {
    const config = parseComfyUiWorkflowConfig(workflowConfigText(input.config?.comfyuiWorkflow));
    const mode = resolveMode(input.raw.comfyuiMode, config.defaultMode);
    return buildComfyUiPrompt({
        config,
        mode,
        prompt: input.prompt,
        durationSeconds: resolveDuration(input.raw.videoSeconds),
        seed: resolveSeed(input.raw.seed),
        aspectRatio: typeof input.raw.size === "string" ? input.raw.size : undefined,
        references: input.references,
    });
}

export function comfyUiReferenceMediaType(mimeType: string): "image" | "video" | "audio" | undefined {
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("video/")) return "video";
    if (mimeType.startsWith("audio/")) return "audio";
    return undefined;
}

function resolveDuration(value: unknown): number {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 15) return parsed;
    return 5;
}

function resolveSeed(value: unknown): number {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return Math.floor(parsed);
    return Math.floor(Math.random() * 1e15);
}

function resolveMode(value: unknown, fallback: ComfyUiGenerationMode): ComfyUiGenerationMode {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
    return isComfyUiGenerationMode(normalized) ? normalized : fallback;
}

function workflowConfigText(value: SystemChannelAdvancedConfig["comfyuiWorkflow"] | undefined) {
    return typeof value === "string" ? value : value ? JSON.stringify(value) : undefined;
}
