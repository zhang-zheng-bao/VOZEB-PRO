import { describe, expect, it } from "vitest";

import graph from "./comfyui-minimax-h3-workflow.json";
import { buildComfyUiPrompt, inferComfyUiWorkflowConfig } from "./comfyui-workflow";

describe("ComfyUI API workflow import", () => {
    it("maps a cloned H3 graph by node semantics rather than original IDs", () => {
        const ids = Object.keys(graph);
        const mapped = Object.fromEntries(ids.map((id, index) => [id, String(index + 1000)]));
        const clone = Object.fromEntries(Object.entries(graph).map(([id, node]) => [mapped[id], {
            ...node,
            inputs: Object.fromEntries(Object.entries(node.inputs).map(([key, value]) => [key, Array.isArray(value) && mapped[String(value[0])] ? [mapped[String(value[0])], value[1]] : value])),
        }]));
        const config = inferComfyUiWorkflowConfig(clone);
        expect(config.nodes.prompt.node).toBe(mapped["263"]);
        expect(config.nodes.reference).toBe(mapped["265"]);
        expect(config.modes.fast.outputNode).toBe(mapped["264"]);
        const result = buildComfyUiPrompt({ config, mode: "fast", prompt: "测试新工作流", durationSeconds: 5, seed: 7, references: [] });
        expect(result.graph[mapped["263"]].inputs.value).toBe("测试新工作流");
        expect(result.graph[mapped["256"]].inputs.noise_seed).toBe(7);
        expect(result.graph[mapped["214"]]).toBeUndefined();
    });

    it("rejects an export whose output branches cannot be identified", () => {
        const clone = structuredClone(graph) as Record<string, { inputs: Record<string, unknown> }>;
        clone["214"].inputs.filename_prefix = "video";
        expect(() => inferComfyUiWorkflowConfig(clone)).toThrow("无法区分快速与二采");
    });
});
