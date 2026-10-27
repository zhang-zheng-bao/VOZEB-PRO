import { describe, expect, it } from "vitest";

import { imageModelFamilyLabel } from "./model-picker";

describe("image model picker", () => {
    it.each([
        ["nano-banana-pro/text-to-image", "Nano Banana"],
        ["seedream-v5-pro/image-to-image", "Seedream"],
        ["gpt-image-2", "GPT Image"],
        ["qwen-image-3.0/image-edit", "Qwen Image"],
        ["flux-kontext-pro", "Flux"],
        ["unknown-image-model", "其他"],
    ])("groups %s under %s", (model, family) => {
        expect(imageModelFamilyLabel(model)).toBe(family);
    });
});
