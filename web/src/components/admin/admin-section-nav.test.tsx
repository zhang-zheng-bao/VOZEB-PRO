import { describe, expect, it } from "vitest";

import { adminSectionGroups } from "./admin-section-nav";

describe("admin navigation order", () => {
    it("shows only local application settings", () => {
        expect(adminSectionGroups.map((group) => group.title)).toEqual(["AI 与模型", "创作", "应用", "存储与数据", "关于"]);
        expect(adminSectionGroups.find((group) => group.title === "AI 与模型")?.items.map((item) => item.label)).toEqual(["模型与工作流", "Agent 提示词", "Agent Skills"]);
        expect(adminSectionGroups.find((group) => group.title === "创作")?.items.map((item) => item.label)).toEqual(["短剧提示词", "提示词库"]);
        expect(adminSectionGroups.find((group) => group.title === "应用")?.items.map((item) => item.label)).toEqual(["应用外观", "通用设置"]);
        expect(adminSectionGroups.find((group) => group.title === "存储与数据")?.items.map((item) => item.label)).toEqual(["本地媒体", "外部存储", "数据备份"]);
        expect(adminSectionGroups.flatMap((group) => group.items.map((item) => item.key))).not.toContain("payments");
    });
});
