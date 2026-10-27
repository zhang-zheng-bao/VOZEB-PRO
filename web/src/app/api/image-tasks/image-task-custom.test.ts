import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/server/safe-outbound-fetch", () => ({ fetchSafeOutbound: (url: string | URL, init?: RequestInit) => fetch(url, init) }));

import { emptyAdvancedConfig } from "@/lib/channel-protocol-registry";
import { clearRunningHubImageUploadCache, pollCustomImageTask, resolveDeclarativeImageSize, runCustomImageTask } from "./image-task-custom";

afterEach(() => {
    vi.restoreAllMocks();
    clearRunningHubImageUploadCache();
});

describe("declarative image request size", () => {
    it("uses a concrete square size for Stable Diffusion auto requests", () => {
        expect(resolveDeclarativeImageSize({ quality: "auto", size: "auto", advancedConfig: { ...emptyAdvancedConfig(), protocol: "stable-diffusion" } })).toBe("1024x1024");
    });

    it("preserves explicit dimensions and does not invent custom protocol defaults", () => {
        expect(resolveDeclarativeImageSize({ quality: "high", size: "1536x1024", advancedConfig: { ...emptyAdvancedConfig(), protocol: "stable-diffusion" } })).toBe("1536x1024");
        expect(resolveDeclarativeImageSize({ quality: "auto", size: "auto", advancedConfig: { ...emptyAdvancedConfig(), protocol: "custom" } })).toBe("");
    });
});

describe("RunningHub image aliases", () => {
    it("uploads a local reference once and submits the returned public URL", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
            const url = String(input);
            if (url.endsWith("/openapi/v2/media/upload/binary")) return Response.json({ code: 200, message: "success", data: { download_url: "https://rh-images.example.com/input/hero.png" } });
            return Response.json({ taskId: "rh-edit-task", status: "queued" });
        });
        const task = {
            id: "image-edit-one",
            userId: "user-one",
            attemptNo: 1,
            kind: "edit",
            prompt: "keep the same hero",
            references: [{ id: "hero", name: "hero.png", type: "image/png", dataUrl: "data:image/png;base64,AQID" }],
            config: {
                baseUrl: "https://www.runninghub.ai",
                apiKey: "secret",
                apiFormat: "openai",
                model: "bytedance/jimeng-4.6/image-to-image",
                quality: "high",
                size: "16:9",
                advancedConfig: {
                    protocol: "runninghub",
                    createPath: "/openapi/v2/bytedance/jimeng-4.6/image-to-image",
                    queryPath: "/openapi/v2/query/:task_id",
                    requestTemplate: '{"prompt":"{{prompt}}","imageUrls":"{{images}}"}',
                    resultField: "data.outputs[0].url",
                },
            },
        } as never;

        await expect(runCustomImageTask(task, "http://localhost", "http://localhost", "", true)).resolves.toMatchObject({ pending: { id: "rh-edit-task" } });

        expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/openapi/v2/media/upload/binary"))).toHaveLength(1);
        const request = fetchMock.mock.calls.find(([url]) => String(url).includes("image-to-image"));
        expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ imageUrls: ["https://rh-images.example.com/input/hero.png"] });
    });

    it("fits long Jimeng prompts to the provider limit while preserving both ends", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ taskId: "rh-jimeng-task", status: "RUNNING" }));
        const prompt = `START-${"a".repeat(850)}-END`;
        const task = {
            id: "image-task-jimeng",
            userId: "user-one",
            attemptNo: 1,
            kind: "edit",
            prompt,
            references: [{ id: "reference-one", name: "hero.png", url: "https://example.com/hero.png" }],
            config: {
                baseUrl: "https://www.runninghub.cn",
                apiKey: "secret",
                apiFormat: "openai",
                model: "bytedance/jimeng-4.6/image-to-image",
                quality: "auto",
                size: "16:9",
                advancedConfig: {
                    protocol: "runninghub",
                    createPath: "/openapi/v2/bytedance/jimeng-4.6/image-to-image",
                    queryPath: "/openapi/v2/query/:task_id",
                    requestTemplate: '{"prompt":"{{prompt}}","imageUrl":"{{image}}","imageUrls":"{{images}}","size":"{{size}}"}',
                    resultField: "results[0].url",
                },
            },
        } as never;

        await expect(runCustomImageTask(task, "http://localhost", "http://localhost", "", true)).resolves.toMatchObject({ pending: { id: "rh-jimeng-task" } });

        const payload = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as { prompt: string; imageUrl?: string; imageUrls: string[] };
        expect(Array.from(payload.prompt)).toHaveLength(800);
        expect(payload.prompt).toMatch(/^START-/);
        expect(payload.prompt).toMatch(/-END$/);
        expect(payload).not.toHaveProperty("imageUrl");
        expect(payload.imageUrls).toEqual(["https://example.com/hero.png"]);
    });

    it("falls back to generic result parsing when RunningHub returns results[0].url", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            Response.json({
                taskId: "rh-task-result",
                status: "SUCCESS",
                results: [{ url: "https://example.com/result.png", outputType: "png" }],
            }),
        );
        const task = {
            id: "image-task-result",
            userId: "user-one",
            attemptNo: 1,
            kind: "generation",
            prompt: "test image",
            references: [],
            config: {
                baseUrl: "https://www.runninghub.cn",
                apiKey: "secret",
                apiFormat: "openai",
                model: "bytedance/jimeng-4.6/text-to-image",
                quality: "low",
                size: "1:1",
                advancedConfig: {
                    protocol: "runninghub",
                    createPath: "/openapi/v2/bytedance/jimeng-4.6/text-to-image",
                    queryPath: "/openapi/v2/query/:task_id",
                    requestTemplate: '{"prompt":"{{prompt}}"}',
                    resultField: "data.outputs[0].url",
                    statusField: "status",
                },
            },
        } as never;

        await expect(pollCustomImageTask(task, "rh-task-result", "https://www.runninghub.cn/openapi/v2/bytedance/jimeng-4.6/text-to-image", "", true)).resolves.toMatchObject({ dataUrl: "https://example.com/result.png" });
    });

    it("submits Grok image generation to the live RH endpoint with a supported resolution", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ taskId: "rh-task-one", status: "queued" }));
        const task = {
            id: "image-task-one",
            userId: "user-one",
            attemptNo: 1,
            kind: "generation",
            prompt: "test image",
            references: [],
            config: {
                baseUrl: "https://www.runninghub.ai",
                apiKey: "secret",
                apiFormat: "openai",
                model: "xai/grok-imagine-image/text-to-image-official-stable",
                quality: "high",
                size: "16:9",
                advancedConfig: {
                    protocol: "runninghub",
                    createPath: "/openapi/v2/xai/grok-imagine-image/text-to-image-official-stable",
                    queryPath: "/openapi/v2/query/:task_id",
                    requestTemplate: '{"prompt":"{{prompt}}","aspectRatio":"{{aspect_ratio}}","size":"{{size}}","quality":"{{quality}}"}',
                    resultField: "data.outputs[0].url",
                },
            },
        } as never;

        await expect(runCustomImageTask(task, "http://localhost", "http://localhost", "", true)).resolves.toMatchObject({ pending: { id: "rh-task-one" } });

        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.runninghub.ai/openapi/v2/rhart-imagine-image-quality/text-to-image");
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ prompt: "test image", resolution: "2k" });
    });

    it("submits the low-price Grok image model through the active RH G endpoint", async () => {
        const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ taskId: "rh-task-two", status: "queued" }));
        const task = {
            id: "image-task-two",
            userId: "user-one",
            attemptNo: 1,
            kind: "generation",
            prompt: "test image",
            references: [],
            config: {
                baseUrl: "https://www.runninghub.ai",
                apiKey: "secret",
                apiFormat: "openai",
                model: "grok-image/text-to-image/channel-low-price",
                quality: "high",
                size: "16:9",
                advancedConfig: {
                    protocol: "runninghub",
                    createPath: "/openapi/v2/grok-image/text-to-image/channel-low-price",
                    queryPath: "/openapi/v2/query/:task_id",
                    requestTemplate: '{"prompt":"{{prompt}}","aspectRatio":"{{aspect_ratio}}","size":"{{size}}","quality":"{{quality}}"}',
                    resultField: "data.outputs[0].url",
                },
            },
        } as never;

        await expect(runCustomImageTask(task, "http://localhost", "http://localhost", "", true)).resolves.toMatchObject({ pending: { id: "rh-task-two" } });

        expect(fetchMock.mock.calls[0]?.[0]).toBe("https://www.runninghub.ai/openapi/v2/rhart-image-g/text-to-image");
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ prompt: "test image", model: "g-4.2" });
    });
});
