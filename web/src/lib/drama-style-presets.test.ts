import { describe, expect, it } from "vitest";

import { dramaPromptTemplateKey, parseDramaPromptTemplateFile } from "./drama-style-presets";

describe("drama prompt templates", () => {
    it("imports plain text into the selected purpose", () => {
        expect(parseDramaPromptTemplateFile("水墨.md", " 水墨动画，留白构图 ", "storyboard")).toEqual([{ title: "水墨", prompt: "水墨动画，留白构图", kind: "storyboard" }]);
    });

    it("imports JSON arrays with explicit and fallback purposes", () => {
        expect(parseDramaPromptTemplateFile("templates.json", JSON.stringify([{ name: "漫画", content: "粗线漫画", kind: "character" }, "连续运镜"]), "video")).toEqual([
            { title: "漫画", prompt: "粗线漫画", kind: "character" },
            { title: "导入模板 2", prompt: "连续运镜", kind: "video" },
        ]);
    });

    it("normalizes whitespace for duplicate detection", () => {
        expect(dramaPromptTemplateKey(" 电影感\n  国漫 ")).toBe(dramaPromptTemplateKey("电影感 国漫"));
    });
});
