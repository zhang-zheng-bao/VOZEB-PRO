import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("drama source import workspace", () => {
    it("keeps large episode previews bounded and paginated without changing the import pipeline", async () => {
        const source = await readFile(resolve(process.cwd(), "src/app/(user)/drama/[id]/drama-source-import.tsx"), "utf8");

        expect(source).toContain("splitDramaSource(await file.text())");
        expect(source).toContain('createVersion(project, "整本导入前")');
        expect(source).toContain("importEpisodes(project.id, drafts)");
        expect(source).toContain("IMPORT_PAGE_SIZE = 20");
        expect(source).toContain("data-drama-import-preview");
        expect(source).toContain("<Pagination");
        expect(source).toContain("overflow-y-auto");
        expect(source).toContain("max-h-[min(68vh,640px)]");
        expect(source).toContain("onClick={() => setModalOpen(true)}");
        expect(source).toContain('aria-label="拖入剧本文件或点击选择文件"');
        expect(source).toContain("event.dataTransfer.files[0]");
        expect(source).toContain("选择文件");
        expect(source).toContain("isDramaSourceFile(file)");
        expect(source).toContain("重置项目资产");
    });
});
