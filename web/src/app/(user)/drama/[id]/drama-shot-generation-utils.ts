import type { DramaAssetReference, DramaProject, DramaShot } from "../types";
import type { DramaNamedAsset } from "@/lib/drama-project-contract";
import { dramaAssetConsistencySources, type DramaVisualAssetKind } from "@/lib/drama-asset-consistency";
import type { AiConfig, useEffectiveConfig } from "@/stores/use-config-store";
import { resolveDramaGenerationSize } from "@/lib/drama-image-size";
import type { ReferenceImage } from "@/types/image";
import type { VideoReferenceRole } from "@/lib/video-reference-contract";
import { runningHubOpenApiCreatePathAlias } from "@/lib/runninghub-openapi-alias";

export function shotReferenceImages(project: DramaProject, shot: DramaShot) {
    const assetUrls = [...project.characters.filter((item) => shot.characterIds.includes(item.id)), ...project.scenes.filter((item) => item.id === shot.sceneId), ...project.props.filter((item) => shot.propIds.includes(item.id))].flatMap((item) => {
        const reference = primaryAssetReference(item);
        return reference ? [referenceImage(item.id, `${item.name}.png`, reference.url, "image/png", reference.width, reference.height)] : [];
    });
    const sourceUrls = (project.sourceAssets || []).flatMap((item) => {
        if (item.type !== "image") return [];
        const url = item.serverUrl || item.remoteUrl;
        return url ? [referenceImage(item.id, item.title, url, item.mimeType, item.width, item.height)] : [];
    });
    return [...assetUrls, ...sourceUrls];
}

export function storyboardReferenceImages(shot: DramaShot) {
    return [
        shot.storyboardImageUrl ? referenceImage(`storyboard-start-${shot.id}`, `${shot.title}-起始帧.png`, shot.storyboardImageUrl, "image/png", shot.storyboardImageWidth, shot.storyboardImageHeight, "first_frame") : null,
        shot.storyboardFrameMode === "first_last" && shot.storyboardEndImageUrl
            ? referenceImage(`storyboard-end-${shot.id}`, `${shot.title}-结束帧.png`, shot.storyboardEndImageUrl, "image/png", shot.storyboardEndImageWidth, shot.storyboardEndImageHeight, "last_frame")
            : null,
    ].filter((item): item is ReturnType<typeof referenceImage> => Boolean(item));
}

export function dramaAssetGenerationReferences(project: DramaProject, asset: DramaNamedAsset, kind: DramaVisualAssetKind) {
    const source = dramaAssetConsistencySources(project, asset, kind)[0];
    if (!source) return [];
    return [
        referenceImage(
            `${source.role}-${source.asset.id}`,
            `${source.role === "target" ? "目标基准" : source.role === "related-character" ? "关联角色" : "关联道具"}-${source.asset.name}.png`,
            source.reference.url,
            "image/png",
            source.reference.width,
            source.reference.height,
        ),
    ];
}

function primaryAssetReference(item: DramaProject["characters"][number]): Pick<DramaAssetReference, "url" | "width" | "height"> | undefined {
    return item.references?.find((reference) => reference.id === item.primaryReferenceId) || item.references?.[0] || (item.referenceImageUrl ? { url: item.referenceImageUrl } : undefined);
}

export function referenceImage(id: string, name: string, url: string, type = "image/png", width?: number, height?: number, videoRole?: VideoReferenceRole): ReferenceImage {
    return { id, name, type, dataUrl: url, url, width, height, ...(videoRole ? { videoRole } : {}), ...(url.startsWith("/") ? { serverUrl: url } : /^https?:\/\//i.test(url) ? { remoteUrl: url } : {}) };
}

export function dramaGenerationSize(project: DramaProject, prompt: string, references: ReferenceImage[] = []) {
    return resolveDramaGenerationSize({ projectSize: project.ratio, prompt, references });
}

export function selectDramaImageModel(config: Pick<AiConfig, "imageModel" | "model" | "logicalModels" | "channels">, hasReference: boolean) {
    const current = config.imageModel || config.model;
    const candidates = config.logicalModels
        .filter((model) => model.enabled && model.capability === "image")
        .sort((left, right) => Number(right.id === current) - Number(left.id === current));
    const desired = candidates.find((model) => isDramaImageModelUsable(config, model.id) && (hasReference ? dramaImageModelSupportsReference(config, model.id) : dramaImageModelSupportsText(config, model.id)));
    const currentMatchesMode = hasReference ? dramaImageModelSupportsReference(config, current) : dramaImageModelSupportsText(config, current);
    return desired?.id || (isDramaImageModelUsable(config, current) && currentMatchesMode ? current : "");
}

export function selectDramaStoryboardImageModel(config: Pick<AiConfig, "imageModel" | "model" | "logicalModels" | "channels">, project: DramaProject) {
    const configured = project.storyboardImageModel || project.assetImageModels?.character;
    return configured && isDramaImageModelUsable(config, configured) && dramaImageModelSupportsReference(config, configured) ? configured : selectDramaImageModel(config, true);
}

export function dramaImageModelOptions(config: Pick<AiConfig, "logicalModels" | "channels">) {
    return config.logicalModels
        .filter((model) => model.enabled && model.capability === "image" && isDramaImageModelUsable(config, model.id))
        .filter((model) => dramaImageModelSupportsText(config, model.id) || dramaImageModelSupportsReference(config, model.id))
        .map((model) => ({ id: model.id, name: model.name, supportsText: dramaImageModelSupportsText(config, model.id), supportsReference: dramaImageModelSupportsReference(config, model.id) }));
}

export function isDramaImageModelUsable(config: Pick<AiConfig, "logicalModels" | "channels">, modelId: string) {
    const model = config.logicalModels.find((item) => item.id === modelId);
    return Boolean(model?.enabled && model.capability === "image" && model.bindings.some((binding) => binding.enabled && hasUsableImageRoute(config, binding.channelId, binding.upstreamModel)));
}

export function dramaImageModelSupportsReference(config: Pick<AiConfig, "logicalModels" | "channels">, modelId: string) {
    const model = config.logicalModels.find((item) => item.id === modelId);
    if (model?.bindings.some((binding) => binding.enabled && binding.capabilityProfile?.supportsReferenceImage && hasUsableImageRoute(config, binding.channelId, binding.upstreamModel))) return true;
    return imageModelText(config, modelId, true).some((text) => /gpt[- /]?image|image[- /]to[- /]image|image edit|\/edit(?:-|$)|图生图|图片编辑/.test(text));
}

export function dramaImageModelSupportsText(config: Pick<AiConfig, "logicalModels" | "channels">, modelId: string) {
    const texts = imageModelText(config, modelId, true);
    if (texts.some((text) => /text[- /]to[- /]image|文生图|gpt-image|imagen|(?:^|[- /])f-dev(?:$|[- /])/.test(text))) return true;
    return texts.length > 0 && !texts.every((text) => /image[- /]to[- /]image|image edit|\/edit(?:-|$)|图生图|图片编辑/.test(text));
}

function imageModelText(config: Pick<AiConfig, "logicalModels" | "channels">, modelId: string, usableOnly: boolean) {
    const model = config.logicalModels.find((item) => item.id === modelId);
    if (!model) return [];
    const bindings = model.bindings.filter((binding) => binding.enabled && (!usableOnly || hasUsableImageRoute(config, binding.channelId, binding.upstreamModel)));
    return [model.id, model.name, ...bindings.map((binding) => binding.upstreamModel)].map((value) => value.toLowerCase());
}

function hasUsableImageRoute(config: Pick<AiConfig, "channels">, channelId: string, upstreamModel: string) {
    const channel = config.channels.find((item) => item.id === channelId);
    const isRunningHub = channel?.advancedConfig?.protocol === "runninghub" || channelId.toLowerCase().includes("runninghub");
    if (!isRunningHub) return Boolean(channel);
    const modelConfig = channel?.advancedConfig?.modelConfigs?.[upstreamModel.trim().toLowerCase()];
    const createPath = modelConfig?.createPath || channel?.advancedConfig?.createPath;
    if (createPath) return !/\s/.test(createPath);
    if (runningHubOpenApiCreatePathAlias(upstreamModel)) return true;
    return upstreamModel.includes("/") && !/\s/.test(upstreamModel);
}

export function estimateTaskPoints(config: ReturnType<typeof useEffectiveConfig>, type: "image" | "video" | "audio", duration = 5, modelOverride = "") {
    const model = modelOverride || (type === "image" ? config.imageModel || config.model : type === "video" ? config.videoModel || config.model : config.audioModel);
    const base = Number(config.modelPointCosts[model] || 0);
    if (type === "image") return Number((base * (config.generationPointMultipliers.imageQuality[config.quality] || 1)).toFixed(2));
    if (type === "video") {
        const quality = config.generationPointMultipliers.videoQuality[config.vquality] || 1;
        const seconds = config.generationPointMultipliers.videoSeconds[String(duration)] || config.generationPointMultipliers.videoSeconds[config.videoSeconds] || 1;
        return Number((base * quality * seconds).toFixed(2));
    }
    return Number(base.toFixed(2));
}

export function estimateEpisodePoints(config: ReturnType<typeof useEffectiveConfig>, project: DramaProject, shots: DramaShot[]) {
    const total = shots.reduce((sum, shot) => {
        const mode = shot.videoMode || project.defaultVideoMode;
        const image = mode === "storyboard" ? estimateTaskPoints(config, "image") * (shot.storyboardFrameMode === "first_last" ? 2 : 1) : 0;
        const audio = shot.audioMode === "voiceover" && (shot.subtitle || shot.dialogue || shot.narration).trim() ? estimateTaskPoints(config, "audio") : 0;
        return sum + image + estimateTaskPoints(config, "video", shot.duration) + audio;
    }, 0);
    return Number(total.toFixed(2));
}
