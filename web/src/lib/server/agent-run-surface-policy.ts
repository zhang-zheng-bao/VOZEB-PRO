import type { AuthSettings } from "@/lib/auth/store";
import { AGENT_FALLBACK_EXAMPLE_TOKEN, DEFAULT_AGENT_PROMPTS } from "@/lib/agent-prompt-defaults";
import type { CreativeAsset, CreativeConversationContext, CreativeSurface } from "@/lib/creative-runtime-contract";
import { creativeAssetReferenceAliases, orderCreativeAssetsByIds } from "@/lib/creative-asset-references";
import type { AgentRun, AgentRunPlannerContextSummary, AgentRunTask } from "@/lib/server/agent-run-store";
import type { AgentPlan } from "@/lib/server/agent-run-validation";
import { resolveAgentPlanningProfile } from "@/lib/server/agent-run-planning-profile";
import { canvasSnapshotPlannerView, selectedCanvasNodeIds } from "./agent-run-canvas-snapshot";

export function availableAgentSkills(settings: AuthSettings, surface: CreativeSurface) {
    const workspaces = surface === "canvas" ? new Set(["canvas"]) : surface === "drama" ? new Set(["drama"]) : new Set(["image", "video", "drama"]);
    return settings.agentSkills.filter((skill) => skill.enabled && (skill.workspaces || ["image"]).some((workspace) => workspaces.has(workspace)));
}

export function selectAgentSkills(settings: AuthSettings, surface: CreativeSurface, requestedSkillIds: string[] = []) {
    const available = new Map(availableAgentSkills(settings, surface).map((skill) => [skill.id, skill]));
    return Array.from(new Set(requestedSkillIds.map((id) => id.trim()).filter(Boolean))).flatMap((id) => (available.has(id) ? [available.get(id)!] : []));
}

export function plannerAgentSkills(settings: AuthSettings, run: Pick<AgentRun, "surface" | "selectedSkillIds">) {
    return selectAgentSkills(settings, run.surface, run.selectedSkillIds || []);
}

export function agentPlannerSystemPrompt(surface: CreativeSurface, fallbackExample: string, prompts: AuthSettings["agentPrompts"] = DEFAULT_AGENT_PROMPTS) {
    const template = surface === "canvas" ? prompts.canvas : surface === "drama" ? prompts.drama : prompts.chat;
    return template.replaceAll(AGENT_FALLBACK_EXAMPLE_TOKEN, fallbackExample);
}

export function agentPlannerInput(
    run: AgentRun,
    conversationContext: CreativeConversationContext,
    referencedAssets: CreativeAsset[],
    referenceSource: "current-turn-explicit" | "conversation-memory-candidates" | "none",
    availableSkills: AuthSettings["agentSkills"],
    availableModels: Array<{ id: string; name: string; capability: string }>,
    settings: AuthSettings,
) {
    return buildAgentPlannerInput(run, conversationContext, referencedAssets, referenceSource, availableSkills, availableModels, settings).input;
}

export function buildAgentPlannerInput(
    run: AgentRun,
    conversationContext: CreativeConversationContext,
    referencedAssets: CreativeAsset[],
    referenceSource: "current-turn-explicit" | "conversation-memory-candidates" | "none",
    availableSkills: AuthSettings["agentSkills"],
    availableModels: Array<{ id: string; name: string; capability: string }>,
    settings: AuthSettings,
): { input: Record<string, unknown>; summary: AgentRunPlannerContextSummary } {
    const selectedNodeIds = run.surface === "canvas" ? selectedCanvasNodeIds(run.snapshot) : [];
    const prioritizedModels = prioritizeAgentPlannerModels(availableModels, run, settings);
    const orderedAssets = orderCreativeAssetsByIds(referencedAssets, run.referencedAssetIds || []);
    const referenceAliases = referenceSource === "current-turn-explicit" ? creativeAssetReferenceAliases(orderedAssets, run.referencedAssetIds || []) : new Map<string, string>();
    const payload = {
        requirement: run.prompt,
        conversationContext: {
            summary: conversationContext.summary,
            recentMessages: conversationContext.recentMessages.map((item) => ({ role: item.role, content: item.content, sequence: item.sequence })),
        },
        surface: run.surface,
        ...(run.projectId ? { projectId: run.projectId } : {}),
        ...(run.surface === "canvas" ? { canvasSnapshot: canvasSnapshotPlannerView(run.snapshot) } : run.surface === "drama" ? { projectSnapshot: compactProjectSnapshot(run.snapshot) } : {}),
        ...(selectedNodeIds.length ? { currentTurnSelection: { selectedNodeIds, rule: "这些节点是本轮明确附件；编辑任务不得改用历史节点" } } : {}),
        referenceContext: { source: referenceSource },
        referencedAssets: orderedAssets.map((asset) => plannerAssetSummary(asset, referenceAliases.get(asset.id))),
        requestedSkillIds: run.selectedSkillIds || [],
        ...(run.generationPreferences ? { generationPreferences: run.generationPreferences } : {}),
        availableSkills: availableSkills.map(plannerSkillSummary),
        availableModels: prioritizedModels,
        defaultModels: settings.defaultModels,
        generationDefaults: settings.generationDefaults,
    };
    const kept = plannerContextIds(payload);
    return {
        input: payload,
        summary: {
            serializedChars: serializedLength(payload),
            kept,
            omitted: { modelIds: [], skillIds: [], assetIds: [], recentMessageSequences: [] },
        },
    };
}

export function prioritizeAgentPlannerModels<T extends { id: string; capability: string }>(models: T[], run: Pick<AgentRun, "requestedModelIds" | "surface" | "prompt" | "snapshot" | "generationPreferences">, settings: AuthSettings) {
    const profile = resolveAgentPlanningProfile(run);
    const requestedOrder = new Map((run.requestedModelIds || []).map((id, index) => [id, index]));
    const defaultOrder = new Map(defaultPlannerModelIds(settings, profile.capabilities).map((id, index) => [id, index]));
    return models
        .map((model, index) => ({ model, index }))
        .sort((left, right) => modelPriority(left.model.id, requestedOrder, defaultOrder) - modelPriority(right.model.id, requestedOrder, defaultOrder) || left.index - right.index)
        .map(({ model }) => model);
}

function plannerSkillSummary(skill: AuthSettings["agentSkills"][number]) {
    return {
        id: skill.id,
        name: skill.name,
        plannerSummary: skill.plannerSummary || skill.description || skill.instructions,
        workspaces: skill.workspaces || ["image"],
    };
}

export function compactCanvasSnapshot(snapshot: unknown) {
    return canvasSnapshotPlannerView(snapshot);
}

function compactProjectSnapshot(snapshot: unknown) {
    return { ...record(snapshot) };
}

function defaultPlannerModelIds(settings: AuthSettings, capabilities: Set<string>) {
    return [
        ["text", settings.defaultModels.textModel],
        ["image", settings.defaultModels.imageModel],
        ["video", settings.defaultModels.videoModel],
        ["audio", settings.defaultModels.audioModel],
    ].flatMap(([capability, id]) => (capabilities.has(capability) && id ? [id] : []));
}

function modelPriority(id: string, requested: Map<string, number>, defaults: Map<string, number>) {
    if (requested.has(id)) return requested.get(id)!;
    if (defaults.has(id)) return requested.size + defaults.get(id)!;
    return requested.size + defaults.size;
}

function plannerContextIds(input: Record<string, unknown>) {
    return {
        modelIds: records(input.availableModels)
            .map((item) => text(item.id))
            .filter(Boolean),
        skillIds: records(input.availableSkills)
            .map((item) => text(item.id))
            .filter(Boolean),
        assetIds: records(input.referencedAssets)
            .map((item) => text(item.id))
            .filter(Boolean),
        recentMessageSequences: records(record(input.conversationContext).recentMessages)
            .map((item) => Number(item.sequence))
            .filter((value) => Number.isFinite(value)),
    };
}

function serializedLength(value: unknown) {
    return JSON.stringify(value).length;
}

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
    return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

export { selectedCanvasNodeIds } from "./agent-run-canvas-snapshot";

export function taskPlanSummary(task: AgentRunTask) {
    return { id: task.id, title: task.title, type: task.type, model: task.model, dependencies: task.dependencies, referenceAssetIds: task.references?.map((item) => item.assetId).filter(Boolean) || [] };
}

export function conversationFallbackReply(surface: CreativeSurface) {
    if (surface === "canvas") return "在的，你可以直接告诉我想了解什么，或让我操作当前画布。";
    if (surface === "drama") return "在的，你可以直接询问当前项目，也可以让我继续创作角色、场景、分镜或媒体产物。";
    return "在的，你可以直接告诉我想了解什么，或描述你想创作的内容。";
}

export function resolveTaskReference(requestedIds: string[] | undefined, assets: Map<string, CreativeAsset>, taskType: AgentRunTask["type"]) {
    return resolveTaskReferences(requestedIds, assets, taskType)[0];
}

export function resolveTaskReferences(requestedIds: string[] | undefined, assets: Map<string, CreativeAsset>, taskType: AgentRunTask["type"]) {
    const requested = Array.from(new Set((requestedIds || []).map((id) => id.trim()).filter(Boolean)))
        .map((id) => assets.get(id))
        .filter((asset): asset is CreativeAsset => Boolean(asset));
    return requested.filter((asset) => {
        if (taskType === "image") return asset.type === "image" && Boolean(assetAccessUrl(asset));
        if (taskType === "video") return asset.type !== "text" && Boolean(assetAccessUrl(asset));
        if (taskType === "audio") return asset.type === "audio" || asset.type === "text";
        return true;
    });
}

export function assetAccessUrl(asset?: CreativeAsset) {
    if (!asset) return undefined;
    return [asset.remoteUrl, asset.serverUrl].find((value) => typeof value === "string" && value.trim() && !value.startsWith("data:"))?.trim();
}

export function creativeAssetContext(asset: CreativeAsset, alias?: string) {
    const content = asset.textContent?.trim();
    const url = assetAccessUrl(asset);
    return [alias ? `引用别名：@${alias}` : "", `资产 ID：${asset.id}`, `类型：${asset.type}`, `标题：${asset.title}`, content ? `文本：${content}` : "", url ? `媒体地址：${url}` : ""].filter(Boolean).join("；");
}

export function agentPlanReply(_plan: AgentPlan, tasks: AgentRunTask[], surface: CreativeSurface) {
    const hasReferences = tasks.some((task) => task.targetNodeId || task.references?.length);
    if (surface === "canvas" && tasks.length === 1 && tasks[0]?.type === "text" && tasks[0].targetNodeId) return "已收到，我会直接修改当前提示词节点，不会自动生成图片。";
    if (surface === "canvas") return hasReferences ? "已收到，我会基于当前参考素材完成这次画布创作。" : "已收到，我会按你的要求完成这次画布创作。";
    if (surface === "drama") return hasReferences ? "已收到，我会基于当前项目素材继续创作。" : "已收到，我会按你的要求继续完成项目创作。";
    return hasReferences ? "已收到，我会基于当前参考素材完成这次创作。" : "已收到，我会按你的要求完成这次创作。";
}

function plannerAssetSummary(asset: CreativeAsset, alias?: string) {
    return {
        id: asset.id,
        ...(alias ? { alias: `@${alias}` } : {}),
        type: asset.type,
        title: asset.title,
        ...(asset.textContent ? { textContent: asset.textContent } : {}),
        ...(assetAccessUrl(asset) ? { url: assetAccessUrl(asset) } : {}),
        ...(asset.mimeType ? { mimeType: asset.mimeType } : {}),
    };
}
