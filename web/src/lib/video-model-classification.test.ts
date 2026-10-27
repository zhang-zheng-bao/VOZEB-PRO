import { describe, expect, it } from "vitest";

import { inferVideoModelFeatures } from "./video-model-classification";

describe("inferVideoModelFeatures", () => {
    it("keeps explicit video kinds in the expected categories", () => {
        expect(inferVideoModelFeatures({ model: "Seedance2.0 Fast Text to Video" }).mode).toBe("text");
        expect(inferVideoModelFeatures({ model: "Seedance2.0 Fast Image to Video", supportsReferenceImage: true }).mode).toBe("first_frame");
        expect(inferVideoModelFeatures({ model: "Seedance2.0 Fast Multimodal Video", supportsReferenceImage: true, supportsReferenceVideo: true, supportsReferenceAudio: true }).mode).toBe("reference");
        expect(inferVideoModelFeatures({ model: "Vidu-start-end-to-video-q3-pro" }).mode).toBe("first_last");
        expect(inferVideoModelFeatures({ model: "google/veo3.1-pro/reference-to-video-official-stable", supportsReferenceImage: true, supportsReferenceVideo: true, supportsReferenceAudio: true }).mode).toBe("reference");
        expect(inferVideoModelFeatures({ model: "Vidu-image-to-video-q3-pro", supportsReferenceImage: true }).mode).toBe("first_frame");
        expect(inferVideoModelFeatures({ model: "xai/grok-imagine-video/image-to-video-official-stable", supportsReferenceImage: true }).mode).toBe("first_frame");
    });

    it("does not treat a plain brand name as a capability", () => {
        expect(inferVideoModelFeatures({ model: "Seedance2.0 Special" }).mode).toBe("");
        expect(inferVideoModelFeatures({ model: "Kling motion-control" }).mode).toBe("");
    });

    it("uses explicit first and last frame template fields as first-last support", () => {
        expect(
            inferVideoModelFeatures({
                model: "custom-video",
                template: JSON.stringify({ prompt: "{{prompt}}", first_frame_url: "{{first_frame_url}}", last_frame_url: "{{last_frame_url}}" }),
            }).mode,
        ).toBe("first_last");
    });
});
