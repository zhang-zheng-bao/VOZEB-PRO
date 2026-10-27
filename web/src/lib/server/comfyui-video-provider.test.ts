import { describe, expect, it, vi } from "vitest";

import { buildComfyUiVideoRequest } from "./comfyui-video-provider";

vi.mock("@/lib/comfyui-minimax-h3-workflow.json", () => ({
    default: {
        "214": { class_type: "VHS_VideoCombine", inputs: { images: ["283", 0], save_output: false } },
        "252": { class_type: "H3Aspect", inputs: { aspect_ratio: "16:9 (Widescreen)" } },
        "256": { class_type: "RandomNoise", inputs: { noise_seed: 1 } },
        "259": { class_type: "PrimitiveString", inputs: { value: 5 } },
        "263": { class_type: "PrimitiveString", inputs: { value: "" } },
        "264": { class_type: "VHS_VideoCombine", inputs: { images: ["256", 0], prompt: ["263", 0], duration: ["259", 0], refs: ["265", 0], aspect: ["252", 0], save_output: false } },
        "265": { class_type: "H3Reference", inputs: {} },
        "283": { class_type: "PrimitiveFloat", inputs: { value: 1, samples: ["256", 0], refs: ["265", 0], prompt: ["263", 0], duration: ["259", 0], aspect: ["252", 0] } },
    },
}));

describe("buildComfyUiVideoRequest", () => {
    it("uses the MiniMax H3 workflow node fields and namespaced reference inputs", () => {
        const { graph, outputNode } = buildComfyUiVideoRequest({
            config: { protocol: "comfyui" } as never,
            prompt: "海边人物转身",
            raw: { videoSeconds: 8, seed: 42, size: "9:16", comfyuiMode: "quality" },
            references: [
                { type: "image", name: "first.png" },
                { type: "video", name: "motion.mp4" },
                { type: "audio", name: "voice.mp3" },
            ],
        });

        expect(outputNode).toBe("214");
        expect(graph["263"].inputs.value).toBe("海边人物转身");
        expect(graph["259"].inputs.value).toBe(8);
        expect(graph["256"].inputs.noise_seed).toBe(42);
        expect(graph["283"].inputs.value).toBe(1.5);
        expect(graph["252"].inputs.aspect_ratio).toBe("9:16 (Portrait Widescreen)");
        expect(graph["265"].inputs["ref_images.ref_image_0"]).toEqual([expect.any(String), 0]);
        expect(graph["265"].inputs["ref_videos.ref_video_0"]).toEqual([expect.any(String), 0]);
        expect(graph["265"].inputs["ref_audios.ref_audio_0"]).toEqual([expect.any(String), 0]);
        expect(graph["264"]).toBeUndefined();
    });

    it("keeps the one-pass output for fast mode", () => {
        const { graph, outputNode } = buildComfyUiVideoRequest({
            config: { protocol: "comfyui" } as never,
            prompt: "快速预览",
            raw: { comfyuiMode: "fast" },
            references: [],
        });

        expect(outputNode).toBe("264");
        expect(graph["264"]).toBeTruthy();
        expect(graph["214"]).toBeUndefined();
        expect(graph["283"]).toBeUndefined();
    });
});
