import { describe, expect, it } from "vitest";

import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasVideoModelReferenceMode, resolveCanvasGenerationModel } from "./canvas-node-config";

const config: AiConfig = {
    ...defaultConfig,
    model: "image-main",
    imageModel: "image-main",
    videoModel: "studio-motion",
    textModel: "writer-main",
    audioModel: "voice-main",
    models: ["image-main", "image-alt", "studio-motion", "writer-main", "voice-main"],
    imageModels: ["image-main", "image-alt"],
    videoModels: ["studio-motion"],
    textModels: ["writer-main"],
    audioModels: ["voice-main"],
};

describe("resolveCanvasGenerationModel", () => {
    it("switches to the first model exposed by the selected capability", () => {
        expect(resolveCanvasGenerationModel(config, "video", "image-alt")).toBe("studio-motion");
        expect(resolveCanvasGenerationModel(config, "text", "studio-motion")).toBe("writer-main");
        expect(resolveCanvasGenerationModel(config, "audio", "writer-main")).toBe("voice-main");
    });

    it("preserves a model that belongs to the selected capability", () => {
        expect(resolveCanvasGenerationModel(config, "image", "IMAGE-ALT")).toBe("image-alt");
    });

    it("does not show an unavailable model when the capability has no configured model", () => {
        expect(resolveCanvasGenerationModel({ ...config, videoModels: [] }, "video", "image-main")).toBe("");
    });
});

describe("canvasVideoModelReferenceMode", () => {
    it("classifies Seedance models by their explicit template kind, not by brand", () => {
        expect(canvasVideoModelReferenceMode("rh-video-seedance2-0-fast-image-to-video-4fdb190e", seedanceConfig())).toBe("first_frame");
        expect(canvasVideoModelReferenceMode("rh-video-seedance2-0-fast-multimodal-video-ffd28374", seedanceConfig())).toBe("reference");
    });

    it("keeps explicit start-end models in the first-last category", () => {
        expect(canvasVideoModelReferenceMode("rh-video-vidu-start-end-to-video-q3-pro-42eea342", seedanceConfig())).toBe("first_last");
    });
});

function seedanceConfig(): AiConfig {
    return {
        ...config,
        videoModels: ["rh-video-seedance2-0-fast-image-to-video-4fdb190e", "rh-video-seedance2-0-fast-multimodal-video-ffd28374", "rh-video-vidu-start-end-to-video-q3-pro-42eea342"],
        logicalModels: [
            {
                id: "rh-video-seedance2-0-fast-image-to-video-4fdb190e",
                name: "RH 视频 - Seedance2.0 Fast Image to Video",
                capability: "video",
                enabled: true,
                bindings: [{ id: "seedance-image", channelId: "runninghub-video", upstreamModel: "Seedance2.0 Fast Image to Video", enabled: true, priority: 1 }],
            },
            {
                id: "rh-video-seedance2-0-fast-multimodal-video-ffd28374",
                name: "RH 视频 - Seedance2.0 Fast Multimodal Video",
                capability: "video",
                enabled: true,
                bindings: [
                    {
                        id: "seedance-multimodal",
                        channelId: "runninghub-video",
                        upstreamModel: "Seedance2.0 Fast Multimodal Video",
                        enabled: true,
                        priority: 2,
                        capabilityProfile: { supportsReferenceImage: true, supportsReferenceVideo: true, supportsReferenceAudio: true },
                    },
                ],
            },
            {
                id: "rh-video-vidu-start-end-to-video-q3-pro-42eea342",
                name: "RH 视频 - Vidu-start-end-to-video-q3-pro",
                capability: "video",
                enabled: true,
                bindings: [{ id: "vidu-start-end", channelId: "runninghub-video", upstreamModel: "Vidu-start-end-to-video-q3-pro", enabled: true, priority: 3 }],
            },
        ],
    };
}
