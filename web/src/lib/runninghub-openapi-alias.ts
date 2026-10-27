export function runningHubOpenApiCreatePathAlias(model: string) {
    const normalized = normalizeRunningHubModelId(model);
    const direct = RUNNINGHUB_OPENAPI_ALIASES[normalized];
    if (direct) return direct;

    const veo = normalized.match(/^google\/(veo3\.1-(?:fast|lite|pro))\/(image-to-video|text-to-video|reference-to-video|start-end-to-video|video-extend)-(?:official-stable|channel-low-price)$/);
    if (veo) return `/openapi/v2/google/${veo[1]}/${veo[2]}`;
    const seedance = normalized.match(/^seedance-2\.5\/(image-to-video|text-to-video|multimodal-video)\s+token$/);
    if (seedance) return `/openapi/v2/bytedance/seedance-2.5-token/${seedance[1]}`;
    const globalSeedance = normalized.match(/^seedance-2\.0-global\/(image-to-video|text-to-video|multimodal-video)$/);
    if (globalSeedance) return `/openapi/v2/bytedance/seedance-2.0-global/${globalSeedance[1]}`;
    const miniSeedance = normalized.match(/^seedance-2\.0-mini\/(image-to-video|text-to-video|multimodal-video)$/);
    if (miniSeedance) return `/openapi/v2/rhart-video/sparkvideo-2.0-mini/${miniSeedance[1]}`;
    const seedanceFast = normalized.match(/^seedance2\.0 fast (image to video|text to video|multimodal video)$/);
    if (seedanceFast) return `/openapi/v2/rhart-video/sparkvideo-2.0-fast/${seedanceFast[1].replaceAll(" ", "-")}`;
    const seedanceStandard = normalized.match(/^seedance2\.0 (image to video|text to video|multimodal video)$/);
    if (seedanceStandard) return `/openapi/v2/rhart-video/sparkvideo-2.0/${seedanceStandard[1].replaceAll(" ", "-")}`;
    const klingDashed = normalized.match(/^(kling-(?:v2\.6|v3\.0)-(?:pro|std)|kling-v3-turbo-(?:pro|std)|kling-video-o3-4k|kling-video-o3-(?:pro|std)|kling-v3-4k)-(image-to-video|text-to-video|motion-control|reference-to-video|video-edit)$/);
    if (klingDashed) return `/openapi/v2/${klingDashed[1]}/${klingDashed[2]}`;
    if (/^vidu-image-to-video-q\d/.test(normalized)) return `/openapi/v2/vidu/image-to-video-${normalized.match(/q\d-(?:turbo|pro(?:-fast)?)/)?.[0] || normalized.replace(/^vidu-image-to-video-/, "")}`;
    if (/^vidu-start-end-to-video-q\d/.test(normalized)) return `/openapi/v2/vidu/start-end-to-video-${normalized.match(/q\d-(?:turbo|pro(?:-fast)?)/)?.[0] || normalized.replace(/^vidu-start-end-to-video-/, "")}`;
    if (/^vidu-text-to-video-q\d/.test(normalized)) return `/openapi/v2/vidu/text-to-video-${normalized.match(/q\d-(?:turbo|pro(?:-fast)?)/)?.[0] || normalized.replace(/^vidu-text-to-video-/, "")}`;
    if (/^vidu-reference-to-video-q\d/.test(normalized)) return `/openapi/v2/vidu/reference-to-video-${normalized.match(/q\d(?:-[a-z]+)?/)?.[0] || normalized.replace(/^vidu-reference-to-video-/, "")}`;
    return "";
}

export function normalizeRunningHubImagePayload(payload: Record<string, unknown> | undefined, model: string) {
    if (!payload) return payload;
    const alias = runningHubOpenApiCreatePathAlias(model);
    const normalized = normalizeRunningHubModelId(model);
    if (/\/rhart-image-g\//i.test(alias)) {
        return compactPayload({
            prompt: payload.prompt,
            model: runningHubGImageModel(model),
            aspectRatio: runningHubGImageAspectRatio(payload.aspectRatio || payload.aspect_ratio || payload.size),
            imageUrl: payload.imageUrl || payload.image,
            imageUrls: payload.imageUrls || payload.images,
        });
    }
    if (/^(?:bytedance\/jimeng-4\.6|seedream-v(?:4(?:\.5)?|5-(?:lite|pro)))\/text-to-image$/.test(normalized)) {
        const dimensions = runningHubModelImageDimensions(normalized, payload.width, payload.height, payload.size || payload.aspectRatio || payload.aspect_ratio);
        return compactPayload({
            prompt: payload.prompt,
            width: dimensions.width,
            height: dimensions.height,
            sequentialImageGeneration: normalized.startsWith("seedream-v4") ? "disabled" : undefined,
            maxImages: normalizeRunningHubImageCount(payload.maxImages || payload.numImages || payload.n),
            resolution: normalized.startsWith("seedream-v5") ? runningHubImageQualityResolution(payload.resolution || payload.quality) : undefined,
            outputFormat: normalized.startsWith("seedream-v5") ? "jpeg" : undefined,
        });
    }
    if (/^(?:bytedance\/jimeng-4\.6|seedream-v(?:4(?:\.5)?|5-(?:lite|pro)))\/image-to-image$/.test(normalized)) {
        const dimensions = runningHubModelImageDimensions(normalized, payload.width, payload.height, payload.size || payload.aspectRatio || payload.aspect_ratio);
        return compactPayload({
            prompt: normalized.startsWith("bytedance/jimeng-4.6") ? limitRunningHubPrompt(payload.prompt, 800) : payload.prompt,
            imageUrls: payload.imageUrls || payload.images,
            width: dimensions.width,
            height: dimensions.height,
            maxImages: normalizeRunningHubImageCount(payload.maxImages || payload.numImages || payload.n),
            resolution: normalized.startsWith("seedream-v5") ? runningHubImageQualityResolution(payload.resolution || payload.quality) : undefined,
            outputFormat: normalized.startsWith("seedream-v5") ? "jpeg" : undefined,
        });
    }
    if (/\/rhart-imagine-image-quality\//i.test(alias)) {
        return compactPayload({
            prompt: payload.prompt,
            aspectRatio: runningHubImageQualityAspectRatio(payload.aspectRatio || payload.aspect_ratio || payload.size),
            resolution: runningHubImageQualityResolution(payload.resolution || payload.quality),
            numImages: normalizeRunningHubImageCount(payload.numImages || payload.n),
            imageUrl: payload.imageUrl || payload.image,
            imageUrls: payload.imageUrls || payload.images,
        });
    }
    return payload;
}

function runningHubModelImageDimensions(model: string, width: unknown, height: unknown, size: unknown) {
    const dimensions = runningHubImageDimensions(width, height, size);
    if (model !== "seedream-v4.5/image-to-image" && model !== "seedream-v4.5/text-to-image") return dimensions;
    const ratio = dimensions.width / dimensions.height;
    if (Math.abs(ratio - 16 / 9) < 0.01) return { width: 2560, height: 1440 };
    if (Math.abs(ratio - 9 / 16) < 0.01) return { width: 1440, height: 2560 };
    if (Math.abs(ratio - 1) < 0.01) return { width: 1920, height: 1920 };
    return dimensions;
}

function limitRunningHubPrompt(value: unknown, limit: number) {
    const text = String(value || "").trim();
    const characters = Array.from(text);
    if (characters.length <= limit) return text;
    const separator = "\n...\n";
    const available = limit - separator.length;
    const headLength = Math.ceil(available * 0.6);
    return `${characters.slice(0, headLength).join("")}${separator}${characters.slice(-available + headLength).join("")}`;
}

function compactPayload(payload: Record<string, unknown>) {
    return Object.fromEntries(
        Object.entries(payload).filter(([, value]) => {
            if (value === undefined || value === null) return false;
            if (typeof value === "string") return Boolean(value.trim());
            if (Array.isArray(value)) return value.length > 0;
            return true;
        }),
    );
}

function runningHubGImageAspectRatio(value: unknown) {
    const text = String(value || "")
        .trim()
        .toLowerCase();
    if (["720x1280", "1280x720", "1168x784", "784x1168", "960x960"].includes(text)) return text;
    if (text === "16:9" || text === "landscape") return "1280x720";
    if (text === "9:16" || text === "portrait") return "720x1280";
    if (text === "3:2") return "1168x784";
    if (text === "2:3") return "784x1168";
    return "960x960";
}

function runningHubImageQualityAspectRatio(value: unknown) {
    const text = String(value || "")
        .trim()
        .toLowerCase();
    if (["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"].includes(text)) return text;
    if (text === "1280x720" || text === "landscape") return "16:9";
    if (text === "720x1280" || text === "portrait") return "9:16";
    if (text === "1168x784") return "3:2";
    if (text === "784x1168") return "2:3";
    return "1:1";
}

function normalizeRunningHubImageCount(value: unknown) {
    const count = Math.floor(Number(value) || 1);
    return Math.max(1, Math.min(4, count));
}

function runningHubImageDimensions(widthValue: unknown, heightValue: unknown, sizeValue: unknown) {
    const parsedWidth = Number(widthValue);
    const parsedHeight = Number(heightValue);
    if (Number.isFinite(parsedWidth) && Number.isFinite(parsedHeight) && parsedWidth > 0 && parsedHeight > 0) {
        return { width: clampRunningHubImageEdge(parsedWidth), height: clampRunningHubImageEdge(parsedHeight) };
    }
    const text = String(sizeValue || "")
        .trim()
        .toLowerCase();
    const size = text.match(/^(\d{3,4})x(\d{3,4})$/);
    if (size) return { width: clampRunningHubImageEdge(Number(size[1])), height: clampRunningHubImageEdge(Number(size[2])) };
    if (text === "16:9" || text === "landscape") return { width: 1344, height: 768 };
    if (text === "9:16" || text === "portrait") return { width: 768, height: 1344 };
    if (text === "4:3") return { width: 1152, height: 864 };
    if (text === "3:4") return { width: 864, height: 1152 };
    return { width: 1024, height: 1024 };
}

function clampRunningHubImageEdge(value: number) {
    return Math.max(1024, Math.min(2048, Math.round(value)));
}

function runningHubGImageModel(model: string) {
    const normalized = normalizeRunningHubModelId(model);
    if (normalized.includes("grok-3")) return "g-3";
    if (normalized.includes("grok-4.1")) return "g-4.1";
    if (normalized.includes("grok-4")) return "g-4";
    return "g-4.2";
}

function runningHubImageQualityResolution(value: unknown) {
    const text = String(value || "")
        .trim()
        .toLowerCase();
    return text === "1k" || text === "low" ? "1k" : "2k";
}

function normalizeRunningHubModelId(model: string) {
    return model.trim().toLowerCase();
}

const RUNNINGHUB_OPENAPI_ALIASES: Record<string, string> = {
    "seedance-v1.5-pro-image-to-video": "/openapi/v2/seedance-v1.5-pro/image-to-video",
    "seedance-v1.5-pro-image-to-video-fast": "/openapi/v2/seedance-v1.5-pro/image-to-video-fast",
    "seedance-v1.5-pro-text-to-video": "/openapi/v2/seedance-v1.5-pro/text-to-video",
    "seedance-v1.5-pro-text-to-video-fast": "/openapi/v2/seedance-v1.5-pro/text-to-video-fast",
    "wan-2.5-preview/image-to-video": "/openapi/v2/alibaba/wan-2.5-preview/image-to-video",
    "wan-2.5-preview/text-to-video": "/openapi/v2/alibaba/wan-2.5-preview/text-to-video",
    "wan-2.6-image-to-video-flash": "/openapi/v2/alibaba/wan-2.6/image-to-video-flash",
    "wan-2.7/image-edit": "/openapi/v2/alibaba/wan-2.7/image-edit",
    "wan-2.7/image-edit-pro": "/openapi/v2/alibaba/wan-2.7/image-edit-pro",
    "wan-2.7/image-to-video": "/openapi/v2/alibaba/wan-2.7/image-to-video",
    "wan-2.7/text-to-image": "/openapi/v2/alibaba/wan-2.7/text-to-image",
    "wan-2.7/text-to-image-pro": "/openapi/v2/alibaba/wan-2.7/text-to-image-pro",
    "wan-2.7/text-to-video": "/openapi/v2/alibaba/wan-2.7/text-to-video",
    "wan-2.7/video-edit": "/openapi/v2/alibaba/wan-2.7/video-edit",
    "wan-2.7/video-extend": "/openapi/v2/alibaba/wan-2.7/video-extend",
    "wan-2.7-spicy/image-to-video": "/openapi/v2/alibaba/wan-2.7-spicy/image-to-video",
    "xai/grok-imagine-image/edit-official-stable": "/openapi/v2/rhart-imagine-image-quality/edit",
    "xai/grok-imagine-image/text-to-image-official-stable": "/openapi/v2/rhart-imagine-image-quality/text-to-image",
    "xai/rhart-imagine-image-quality/edit-official-stable": "/openapi/v2/rhart-imagine-image-quality/edit",
    "xai/rhart-imagine-image-quality/text-to-image-official-stable": "/openapi/v2/rhart-imagine-image-quality/text-to-image",
    "grok-image/image-to-image/channel-low-price": "/openapi/v2/rhart-image-g/image-to-image",
    "grok-image/text-to-image/channel-low-price": "/openapi/v2/rhart-image-g/text-to-image",
    "grok-3-image-to-image": "/openapi/v2/rhart-image-g/image-to-image",
    "grok-3-image-text-to-image": "/openapi/v2/rhart-image-g/text-to-image",
    "grok-4-image-image-to-image": "/openapi/v2/rhart-image-g/image-to-image",
    "grok-4-image-text-to-image": "/openapi/v2/rhart-image-g/text-to-image",
    "pixverse-v6/image-to-video": "/openapi/v2/pixverse-v6/image-to-video",
    "pixverse-v6/text-to-video": "/openapi/v2/pixverse-v6/text-to-video",
    "pixverse-v6/transition": "/openapi/v2/pixverse-v6/transition",
    "pixverse-v6/extend": "/openapi/v2/pixverse-v6/extend",
    "skyreels-v4/image-to-video-fast": "/openapi/v2/skyreels-v4/image-to-video-fast",
    "skyreels-v4/image-to-video-std": "/openapi/v2/skyreels-v4/image-to-video-std",
    "skyreels-v4/text-to-video-fast": "/openapi/v2/skyreels-v4/text-to-video-fast",
    "skyreels-v4/text-to-video-std": "/openapi/v2/skyreels-v4/text-to-video-std",
    "skyreels-v4/omni-reference-fast": "/openapi/v2/skyreels-v4/omni-reference-fast",
    "skyreels-v4/omni-reference-std": "/openapi/v2/skyreels-v4/omni-reference-std",
    "happyhorse-1.0/image-to-video": "/openapi/v2/alibaba/happyhorse-1.0/image-to-video",
    "happyhorse-1.1/image-to-video": "/openapi/v2/alibaba/happyhorse-1.1/image-to-video",
    "xai/grok-imagine-video-v1.5/reference-to-video-official-stable": "/openapi/v2/rhart-video-g-official/reference-to-video-v1.5",
    "xai/grok-imagine-video/reference-to-video-official-stable": "/openapi/v2/rhart-video-g-official/reference-to-video",
    "xai/grok-imagine-video-v1.5/image-to-video-official-stable": "/openapi/v2/rhart-video-g-official/image-to-video-v1.5",
    "xai/grok-imagine/image-to-video-official-stable": "/openapi/v2/rhart-video-g-official/image-to-video",
    "xai / grok-imagine-video-v1.5 / text-to-video-official-stable": "/openapi/v2/rhart-video-g-official/text-to-video-v1.5",
    "xai/grok-imagine/text-to-video-official-stable": "/openapi/v2/rhart-video-g-official/text-to-video",
    "xai/grok-imagine/text-to-video-channel-low-price-v1.5": "/openapi/v2/rhart-video-g/text-to-video",
    "xai/grok-imagine/image-to-video-channel-low-price-v1.5": "/openapi/v2/rhart-video-g/image-to-video",
    "xai/grok-imagine-video/video-extend-official-stable": "/openapi/v2/rhart-video-g-official/video-extend",
    "xai/grok-imagine/edit-video-official-stable": "/openapi/v2/rhart-video-g-official/edit-video",
};
