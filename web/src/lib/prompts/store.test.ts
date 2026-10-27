import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    list: vi.fn(),
    facets: vi.fn(),
    hasSeedSource: vi.fn(),
    getById: vi.fn(),
    upsert: vi.fn(),
}));

vi.mock("@/lib/server/database", () => ({
    createPostgresRepositories: () => ({ prompts: mocks }),
    ensurePostgresSchema: vi.fn(),
    isPostgresDatabaseEnabled: () => true,
    withPostgresTransaction: vi.fn(),
}));

vi.mock("@/lib/server/data-adapter", () => ({
    readJsonDataFile: vi.fn(),
    writeJsonDataFile: vi.fn(),
}));

import { listPrompts, updatePrompt } from "./store";

describe("prompt store pagination", () => {
    beforeEach(() => {
        mocks.list.mockReset().mockResolvedValue({ items: [], total: 40, page: 2, pageSize: 20 });
        mocks.facets.mockReset().mockResolvedValue({ tags: ["海报"], categories: ["设计"], scopeTotal: 963 });
        mocks.hasSeedSource.mockReset().mockResolvedValue(true);
        mocks.getById.mockReset();
        mocks.upsert.mockReset();
    });

    it("runs only the bounded page query when later pages omit facets", async () => {
        await expect(listPrompts({ scope: "library", keyword: "产品", category: "设计", page: 2, pageSize: 20, includeFacets: false })).resolves.toEqual({
            items: [],
            tags: [],
            categories: [],
            total: 40,
        });

        expect(mocks.list).toHaveBeenCalledWith(expect.objectContaining({ scope: "library", keyword: "产品", category: "设计", page: 2, pageSize: 20 }));
        expect(mocks.facets).not.toHaveBeenCalled();
    });

    it("loads facets together with the first page", async () => {
        const result = await listPrompts({ scope: "library", page: 1, pageSize: 20 });

        expect(result).toMatchObject({ tags: ["海报"], categories: ["设计"], scopeTotal: 963 });
        expect(mocks.facets).toHaveBeenCalledTimes(1);
    });

    it("detaches an edited built-in prompt from seed management", async () => {
        const prompt = {
            id: "seed-one",
            scope: "library",
            title: "原提示词",
            coverUrl: "",
            prompt: "原内容",
            tags: [],
            category: "默认",
            preview: "",
            source: "tigerowo/awesome-gpt-image-2-prompts:version",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
        };
        mocks.getById.mockResolvedValue(prompt);
        mocks.upsert.mockImplementation(async (value) => value);

        await updatePrompt(prompt.id, { title: "已编辑", prompt: "新内容" }, { scope: "library" });

        expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ id: prompt.id, title: "已编辑", prompt: "新内容", source: undefined }));
    });
});
