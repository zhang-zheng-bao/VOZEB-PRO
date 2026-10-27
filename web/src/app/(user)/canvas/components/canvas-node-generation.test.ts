import { describe, expect, it } from "vitest";

import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { buildNodeGenerationContext } from "./canvas-node-generation";

describe("canvas node generation context", () => {
    it("uses connected config resources when composer prompt has no explicit mention tokens", () => {
        const nodes: CanvasNodeData[] = [
            node("config", CanvasNodeType.Config, { composerContent: "生成视频" }),
            node("image-one", CanvasNodeType.Image, { content: "/api/generation-log-assets/permanent/2026/08/16/images/one.png", storageKey: "permanent/2026/08/16/images/one.png", mimeType: "image/png" }),
            node("video-one", CanvasNodeType.Video, { content: "/api/reference-assets/permanent/2026/08/16/videos/one.mp4", storageKey: "permanent/2026/08/16/videos/one.mp4", mimeType: "video/mp4" }),
            node("audio-one", CanvasNodeType.Audio, { content: "/api/reference-assets/permanent/2026/08/16/audios/one.mp3", storageKey: "permanent/2026/08/16/audios/one.mp3", mimeType: "audio/mpeg" }),
        ];
        const connections: CanvasConnection[] = [
            { id: "c1", fromNodeId: "image-one", toNodeId: "config" },
            { id: "c2", fromNodeId: "video-one", toNodeId: "config" },
            { id: "c3", fromNodeId: "audio-one", toNodeId: "config" },
        ];

        const context = buildNodeGenerationContext("config", nodes, connections, "让人物自然说话");

        expect(context.referenceImages).toHaveLength(1);
        expect(context.referenceVideos).toHaveLength(1);
        expect(context.referenceAudios).toHaveLength(1);
    });

    it("uses only explicitly mentioned config resources when mention tokens are present", () => {
        const nodes: CanvasNodeData[] = [
            node("config", CanvasNodeType.Config, { composerContent: "生成视频" }),
            node("image-one", CanvasNodeType.Image, { content: "/api/generation-log-assets/permanent/2026/08/16/images/one.png" }),
            node("image-two", CanvasNodeType.Image, { content: "/api/generation-log-assets/permanent/2026/08/16/images/two.png" }),
        ];
        const connections: CanvasConnection[] = [
            { id: "c1", fromNodeId: "image-one", toNodeId: "config" },
            { id: "c2", fromNodeId: "image-two", toNodeId: "config" },
        ];

        const context = buildNodeGenerationContext("config", nodes, connections, "参考 @[node:image-two] 生成视频");

        expect(context.referenceImages.map((image) => image.id)).toEqual(["image-two"]);
        expect(context.prompt).toContain("图片1");
    });
});

function node(id: string, type: CanvasNodeType, metadata: NonNullable<CanvasNodeData["metadata"]>): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 1280, height: 720, metadata };
}
