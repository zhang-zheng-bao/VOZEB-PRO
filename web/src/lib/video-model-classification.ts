export type VideoModelMode = "text" | "first_frame" | "first_last" | "reference" | "extend" | "edit" | "enhance" | "";

export type VideoModelClassificationInput = {
    model: string;
    label?: string;
    template?: string;
    createPath?: string;
    imageToVideoPath?: string;
    durationRange?: string;
    supportsReferenceImage?: boolean;
    supportsReferenceVideo?: boolean;
    supportsReferenceAudio?: boolean;
    maxReferenceImages?: number;
    minDurationSeconds?: number;
    maxDurationSeconds?: number;
};

export type VideoModelFeatures = {
    mode: VideoModelMode;
    supportsImage: boolean;
    supportsVideo: boolean;
    supportsAudio: boolean;
    maxImages?: number;
    durationLabel: string;
};

export function inferVideoModelFeatures(input: VideoModelClassificationInput): VideoModelFeatures {
    const template = input.template || "";
    const source = normalizeVideoModelSource(input);
    const hasSingleImage = hasTemplateField(template, ["image", "image_url", "imageUrl"]);
    const hasImageList = hasTemplateField(template, ["images", "image_urls", "imageUrls"]);
    const hasVideoList = hasTemplateField(template, ["videos", "video_urls", "videoUrls"]);
    const hasAudioList = hasTemplateField(template, ["audios", "audio_urls", "audioUrls"]);
    const hasFirstFrameField = hasTemplateField(template, ["first_frame", "first_frame_url", "firstFrame", "firstFrameUrl"]);
    const hasLastFrameField = hasTemplateField(template, ["last_frame", "last_frame_url", "lastFrame", "lastFrameUrl"]);
    const explicitText = /(?:^|[\/\s_-])(?:text-to-video|t2v)(?:$|[\/\s_-])/i.test(source);
    const explicitExtend = /(?:^|[\/\s_-])(?:video-extend|extend-video|extend)(?:$|[\/\s_-])/i.test(source);
    const explicitEdit = /(?:^|[\/\s_-])(?:video-edit|edit-video)(?:$|[\/\s_-])/i.test(source);
    const explicitEnhance = /(?:^|[\/\s_-])(?:upscale|enhance|denoise|interpolation|regeneration)(?:$|[\/\s_-])/i.test(source);
    const explicitFirstLast = hasLastFrameField || /(?:first[\/\s_-]*last|first\/last|start[\/\s_-]*(?:end|to[\/\s_-]*end)|start-end|first-last)(?:$|[\/\s_-]|frame)/i.test(source);
    const explicitReference = hasVideoList || hasAudioList || /(?:reference|refrence|multimodal|multi-modal|all-reference|fl2v|r2va)(?:$|[\/\s_-]|to-video)/i.test(source);
    const explicitFirstFrame = hasSingleImage || hasImageList || hasFirstFrameField || /(?:^|[\/\s_-])(?:image-to-video|i2v)(?:$|[\/\s_-])/i.test(source);
    const supportsVideo = Boolean(input.supportsReferenceVideo || hasVideoList);
    const supportsAudio = Boolean(input.supportsReferenceAudio || hasAudioList);
    const supportsImage = Boolean(input.supportsReferenceImage || hasSingleImage || hasImageList || hasFirstFrameField || hasLastFrameField || explicitFirstFrame || explicitFirstLast);
    const durationLabel = grokVideoDurationLabel(source) || durationRangeLabel(input.durationRange, input.minDurationSeconds, input.maxDurationSeconds);

    if (explicitExtend) return { mode: "extend", supportsImage: false, supportsVideo: true, supportsAudio: false, durationLabel };
    if (explicitEdit) return { mode: "edit", supportsImage, supportsVideo: true, supportsAudio, durationLabel };
    if (explicitEnhance && !explicitFirstFrame && !explicitReference && !explicitFirstLast && !explicitText) return { mode: "enhance", supportsImage, supportsVideo, supportsAudio, durationLabel };
    if (explicitText) return { mode: "text", supportsImage: false, supportsVideo: false, supportsAudio: false, durationLabel };
    if (explicitFirstLast) return { mode: "first_last", supportsImage: true, supportsVideo: false, supportsAudio: false, maxImages: 2, durationLabel };
    if (explicitReference || supportsVideo || supportsAudio) return { mode: "reference", supportsImage, supportsVideo, supportsAudio, maxImages: input.maxReferenceImages, durationLabel };
    if (explicitFirstFrame || supportsImage) return { mode: "first_frame", supportsImage: true, supportsVideo: false, supportsAudio: false, maxImages: input.maxReferenceImages || 1, durationLabel };
    return { mode: "", supportsImage, supportsVideo, supportsAudio, maxImages: input.maxReferenceImages, durationLabel };
}

export function compactVideoModeLabelFromFeatures(features: Pick<VideoModelFeatures, "mode">) {
    if (features.mode === "reference") return "参考";
    if (features.mode === "text") return "文生";
    if (features.mode === "first_frame") return "图生";
    if (features.mode === "first_last") return "首尾帧";
    if (features.mode === "extend") return "延长";
    if (features.mode === "edit") return "编辑";
    if (features.mode === "enhance") return "增强";
    return "";
}

export function videoModelCapabilityTags(features: VideoModelFeatures) {
    const tags: string[] = [];
    if (features.mode === "reference") tags.push("全能参考");
    if (features.mode === "first_last") tags.push("首尾帧", "2张图");
    if (features.mode === "first_frame") tags.push("图生视频", `${features.maxImages || 1}张参考图`);
    if (features.mode === "text") tags.push("文生视频");
    if (features.mode === "extend") tags.push("视频延长");
    if (features.mode === "edit") tags.push("视频编辑");
    if (features.mode === "enhance") tags.push("画质增强");
    if (features.mode === "reference") {
        if (features.supportsImage) tags.push(features.maxImages ? `${features.maxImages}张图` : "图片参考");
        if (features.supportsVideo) tags.push("视频参考");
        if (features.supportsAudio) tags.push("音频参考");
    }
    if (features.durationLabel) tags.push(features.durationLabel);
    return tags.length ? Array.from(new Set(tags)) : ["视频"];
}

function normalizeVideoModelSource(input: VideoModelClassificationInput) {
    return [input.template, input.createPath, input.imageToVideoPath, input.model, input.label].filter(Boolean).join(" ").replace(/[\s_]+/g, "-").toLowerCase();
}

function hasTemplateField(template: string, keys: string[]) {
    return keys.some((key) => new RegExp(`(?:["']${escapeRegExp(key)}["']|\\{\\{\\s*${escapeRegExp(key)}\\s*\\}\\})`, "i").test(template));
}

function durationRangeLabel(durationRange?: string, minDuration?: number, maxDuration?: number) {
    if (minDuration && maxDuration) return `${minDuration}-${maxDuration}s`;
    if (minDuration) return `>=${minDuration}s`;
    if (maxDuration) return `<=${maxDuration}s`;
    const range = durationRange?.match(/(\d{1,4})\s*(?:-|~|～|—|至|到)\s*(\d{1,4})/);
    if (range) return `${range[1]}-${range[2]}s`;
    const options = durationRange?.match(/\d{1,4}/g);
    return options?.length ? `${Array.from(new Set(options)).slice(0, 3).join("/")}s` : "";
}

function grokVideoDurationLabel(input: string) {
    return input.includes("grok-imagine-video") ? "6-15s" : "";
}

function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
