import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchSafeOutbound = vi.hoisted(() => vi.fn());
vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound }));

import { ensureComfyUiReference } from "./comfyui-reference-upload";

const input = { baseUrl: "http://127.0.0.1:18189", bytes: Buffer.from("reference image"), mimeType: "image/png", extension: ".png" };

describe("ComfyUI reference upload", () => {
    beforeEach(() => fetchSafeOutbound.mockReset());

    it("uploads only when the content-named file is absent", async () => {
        fetchSafeOutbound.mockResolvedValueOnce({ ok: false, status: 404 });
        fetchSafeOutbound.mockImplementationOnce(async (_url, init) => ({ ok: true, json: async () => ({ name: (init.body as FormData).get("image") instanceof File ? ((init.body as FormData).get("image") as File).name : "" }) }));
        const name = await ensureComfyUiReference(input);
        expect(name).toMatch(/^vozeb-[a-f0-9]{64}\.png$/);
        expect(fetchSafeOutbound.mock.calls[0][0]).toContain(`/view?filename=${name}&type=input`);
        expect(fetchSafeOutbound.mock.calls[1][0]).toContain("/upload/image");

        fetchSafeOutbound.mockResolvedValueOnce({ ok: true, status: 200 });
        expect(await ensureComfyUiReference(input)).toBe(name);
        expect(fetchSafeOutbound).toHaveBeenCalledTimes(3);
    });

    it("does not upload when the existence check fails", async () => {
        fetchSafeOutbound.mockResolvedValueOnce({ ok: false, status: 500 });
        await expect(ensureComfyUiReference(input)).rejects.toThrow("素材检查失败：500");
        expect(fetchSafeOutbound).toHaveBeenCalledTimes(1);
    });

    it("shares an in-flight check for the same content", async () => {
        fetchSafeOutbound.mockResolvedValue({ ok: true, status: 200 });
        await Promise.all([ensureComfyUiReference(input), ensureComfyUiReference(input)]);
        expect(fetchSafeOutbound).toHaveBeenCalledTimes(1);
    });
});
