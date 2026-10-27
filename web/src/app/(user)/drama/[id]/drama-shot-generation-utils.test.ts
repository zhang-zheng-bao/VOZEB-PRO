import { describe, expect, it } from "vitest";

import type { AiConfig } from "@/stores/use-config-store";
import type { DramaProject } from "@/lib/drama-project-contract";
import { dramaAssetGenerationReferences, dramaImageModelOptions, selectDramaImageModel, selectDramaStoryboardImageModel } from "./drama-shot-generation-utils";

describe("selectDramaImageModel", () => {
    const config = {
        imageModel: "luma-edit",
        model: "luma-edit",
        channels: [
            {
                id: "rh",
                name: "RunningHub",
                baseUrl: "https://www.runninghub.cn",
                apiKey: "secret",
                apiFormat: "openai",
                models: [],
                advancedConfig: {
                    protocol: "runninghub",
                    textModel: "",
                    imageModel: "",
                    videoModel: "",
                    createPath: "",
                    queryPath: "/openapi/v2/query/:task_id",
                    requestTemplate: "",
                    resultField: "",
                    statusField: "",
                    durationRange: "",
                    referenceRule: "",
                    supportsReferenceImage: true,
                    supportsReferenceVideo: false,
                    supportsReferenceAudio: false,
                    modelConfigs: {
                        "luma uni-1 image edit": { capability: "image", createPath: "/openapi/v2/Luma uni-1 Image Edit" },
                        "luma uni-1 text to image": { capability: "image", createPath: "/openapi/v2/Luma uni-1 Text to Image" },
                        "bytedance/jimeng-4.6/text-to-image": { capability: "image", createPath: "/openapi/v2/bytedance/jimeng-4.6/text-to-image" },
                        "seedream-v4/image-to-image": { capability: "image", createPath: "/openapi/v2/seedream-v4/image-to-image" },
                    },
                },
            },
        ],
        logicalModels: [
            { id: "luma-edit", name: "Luma Image Edit", capability: "image", enabled: true, bindings: [{ id: "edit", channelId: "rh", upstreamModel: "Luma uni-1 Image Edit", enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: true } }] },
            { id: "luma-text", name: "Luma Text to Image", capability: "image", enabled: true, bindings: [{ id: "text", channelId: "rh", upstreamModel: "Luma uni-1 Text to Image", enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: false } }] },
            { id: "jimeng-text", name: "即梦文生图", capability: "image", enabled: true, bindings: [{ id: "jimeng", channelId: "rh", upstreamModel: "bytedance/jimeng-4.6/text-to-image", enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: false } }] },
            { id: "seedream-image", name: "Seedream 图生图", capability: "image", enabled: true, bindings: [{ id: "seedream", channelId: "rh", upstreamModel: "seedream-v4/image-to-image", enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: true } }] },
        ],
    } as Pick<AiConfig, "imageModel" | "model" | "logicalModels" | "channels">;

    it("uses text-to-image without a reference", () => {
        expect(selectDramaImageModel(config, false)).toBe("jimeng-text");
    });

    it("uses a reference-capable model with a reference", () => {
        expect(selectDramaImageModel(config, true)).toBe("seedream-image");
    });

    it("uses the project storyboard image model before the global default", () => {
        expect(selectDramaStoryboardImageModel(config, { storyboardImageModel: "seedream-image" } as DramaProject)).toBe("seedream-image");
    });

    it("follows the character asset model when no storyboard override exists", () => {
        expect(selectDramaStoryboardImageModel(config, { assetImageModels: { character: "seedream-image" } } as DramaProject)).toBe("seedream-image");
    });

    it("rejects display-name RunningHub paths when public settings omit advanced config", () => {
        const publicConfig = {
            ...config,
            channels: [{ id: "runninghub-image", name: "RunningHub", baseUrl: "/api/ai/system/runninghub-image", apiKey: "system", apiFormat: "openai", models: [] }],
            logicalModels: config.logicalModels.map((model) => ({ ...model, bindings: model.bindings.map((binding) => ({ ...binding, channelId: "runninghub-image" })) })),
        } as typeof config;

        expect(selectDramaImageModel(publicConfig, false)).toBe("jimeng-text");
        expect(dramaImageModelOptions(publicConfig).map((model) => model.id)).not.toContain("luma-text");
    });

    it("offers OpenAI-compatible GPT image models for text generation", () => {
        const openAiConfig = {
            ...config,
            imageModel: "gpt-image-2.5",
            channels: [{ id: "apikey-fan-image", name: "APIKEY.FAN 图片", baseUrl: "/api/ai/system/apikey-fan-image", apiKey: "system", apiFormat: "openai", models: ["gpt-image-2.5"] }],
            logicalModels: [{ id: "gpt-image-2.5", name: "GPT Image 2.5", capability: "image", enabled: true, bindings: [{ id: "gpt-image-2.5-binding", channelId: "apikey-fan-image", upstreamModel: "gpt-image-2.5", enabled: true, priority: 1, capabilityProfile: { supportsReferenceImage: false } }] }],
        } as typeof config;

        expect(selectDramaImageModel(openAiConfig, false)).toBe("gpt-image-2.5");
        expect(dramaImageModelOptions(openAiConfig)).toEqual([expect.objectContaining({ id: "gpt-image-2.5", supportsText: true, supportsReference: true })]);
    });
});

describe("dramaAssetGenerationReferences", () => {
    it("uses a related character base image when generating a prop carried by that character", () => {
        const project = {
            characters: [{ id: "hero", name: "王生", description: "", references: [{ id: "hero-ref", url: "/api/reference-assets/hero.png", source: "generated", label: "基准图", createdAt: "2026-01-01T00:00:00.000Z" }], primaryReferenceId: "hero-ref" }],
            props: [{ id: "bag", name: "华丽行囊", description: "" }],
            episodes: [{ shots: [{ characterIds: ["hero"], propIds: ["bag"] }] }],
        } as DramaProject;

        expect(dramaAssetGenerationReferences(project, project.props[0], "props")).toEqual([
            expect.objectContaining({ id: "related-character-hero", name: "关联角色-王生.png", url: "/api/reference-assets/hero.png" }),
        ]);
    });

    it("keeps the target base first and removes duplicate related URLs", () => {
        const shared = { id: "target-ref", url: "/api/reference-assets/shared.png", source: "generated" as const, label: "基准图", createdAt: "2026-01-01T00:00:00.000Z" };
        const project = {
            characters: [{ id: "hero", name: "王生", description: "", references: [{ ...shared, id: "hero-ref" }], primaryReferenceId: "hero-ref" }],
            props: [{ id: "bag", name: "华丽行囊", description: "", references: [shared], primaryReferenceId: "target-ref" }],
            episodes: [{ shots: [{ characterIds: ["hero"], propIds: ["bag"] }] }],
        } as DramaProject;

        expect(dramaAssetGenerationReferences(project, project.props[0], "props")).toEqual([
            expect.objectContaining({ id: "target-bag", name: "目标基准-华丽行囊.png", url: "/api/reference-assets/shared.png" }),
        ]);
    });

    it("sends only the target base when regenerating a character with related props", () => {
        const project = {
            characters: [{ id: "hero", name: "王生", description: "", references: [{ id: "hero-ref", url: "/api/reference-assets/hero.png", source: "generated", label: "基准图", createdAt: "2026-01-01T00:00:00.000Z" }], primaryReferenceId: "hero-ref" }],
            props: [{ id: "bag", name: "行囊", description: "", references: [{ id: "bag-ref", url: "/api/reference-assets/bag.png", source: "generated", label: "基准图", createdAt: "2026-01-01T00:00:00.000Z" }], primaryReferenceId: "bag-ref" }],
            episodes: [{ shots: [{ characterIds: ["hero"], propIds: ["bag"] }] }],
        } as DramaProject;

        expect(dramaAssetGenerationReferences(project, project.characters[0], "characters")).toEqual([
            expect.objectContaining({ id: "target-hero", url: "/api/reference-assets/hero.png" }),
        ]);
    });
});
