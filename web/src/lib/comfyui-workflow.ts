import h3Workflow from "@/lib/comfyui-minimax-h3-workflow.json";

export type ComfyUiGenerationMode = "fast" | "balanced" | "quality";
export type ComfyUiGraph = Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: unknown }>;
export type ComfyUiNodeRef = { node: string; input: string };
export type ComfyUiReference = { type: "image" | "video" | "audio"; name: string };

export type ComfyUiWorkflowConfig = {
    workflow: string;
    defaultMode: ComfyUiGenerationMode;
    modes: Record<ComfyUiGenerationMode, { outputNode: string; upscale?: number }>;
    nodes: { prompt: ComfyUiNodeRef; duration: ComfyUiNodeRef; seed: ComfyUiNodeRef; upscale: ComfyUiNodeRef; aspectRatio?: ComfyUiNodeRef; reference: string };
    referenceLimits: { image: number; video: number; audio: number };
};

export const COMFYUI_GENERATION_MODES: ReadonlyArray<{ value: ComfyUiGenerationMode; label: string; description: string }> = [
    { value: "fast", label: "快速", description: "只跑一采" },
    { value: "balanced", label: "均衡", description: "二采 1 倍" },
    { value: "quality", label: "高质量", description: "二采 1.5 倍" },
];

export const COMFYUI_MINIMAX_H3_MODEL = "minimax-h3-multi-reference";

export const DEFAULT_COMFYUI_WORKFLOW_CONFIG: ComfyUiWorkflowConfig = {
    workflow: JSON.stringify(h3Workflow),
    defaultMode: "balanced",
    modes: { fast: { outputNode: "264" }, balanced: { outputNode: "214", upscale: 1 }, quality: { outputNode: "214", upscale: 1.5 } },
    nodes: {
        prompt: { node: "263", input: "value" },
        duration: { node: "259", input: "value" },
        seed: { node: "256", input: "noise_seed" },
        upscale: { node: "283", input: "value" },
        aspectRatio: { node: "252", input: "aspect_ratio" },
        reference: "265",
    },
    referenceLimits: { image: 9, video: 3, audio: 3 },
};

export function inferComfyUiWorkflowConfig(value: unknown): ComfyUiWorkflowConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("请导入 ComfyUI API 格式的工作流 JSON");
    const graph = value as ComfyUiGraph;
    const entries = Object.entries(graph).filter(([, node]) => node && typeof node === "object" && typeof node.class_type === "string" && node.inputs && typeof node.inputs === "object");
    if (!entries.length || entries.length !== Object.keys(graph).length) throw new Error("请在 ComfyUI 中导出 API 格式工作流，不支持普通画布 JSON");
    const findOne = (label: string, predicate: (node: ComfyUiGraph[string]) => boolean) => {
        const found = entries.filter(([, node]) => predicate(node));
        if (found.length !== 1) throw new Error(`无法唯一识别${label}节点，请先检查工作流结构`);
        return found[0][0];
    };
    const prompt = findOne("提示词", (node) => /PrimitiveStringMultiline/i.test(node.class_type) && typeof node.inputs.value === "string");
    const duration = findOne("时长", (node) => /PrimitiveFloat/i.test(node.class_type) && typeof node.inputs.value === "number");
    const seed = findOne("随机种子", (node) => /RandomNoise/i.test(node.class_type) && "noise_seed" in node.inputs);
    const reference = findOne("参考素材", (node) => /ReferenceToVideo/i.test(node.class_type));
    const upscale = findOne("二采倍率", (node) => /easy float/i.test(node.class_type) && typeof node.inputs.value === "number");
    const aspect = entries.filter(([, node]) => /ResolutionSelector/i.test(node.class_type) && "aspect_ratio" in node.inputs);
    if (aspect.length > 1) throw new Error("比例节点不唯一，请先检查工作流结构");
    const outputs = entries.filter(([, node]) => node.class_type === "VHS_VideoCombine");
    const fast = outputs.filter(([, node]) => /一采|first|fast/i.test(String(node.inputs.filename_prefix || "")));
    const final = outputs.filter(([, node]) => /二采|second|final|quality/i.test(String(node.inputs.filename_prefix || "")));
    if (fast.length !== 1 || final.length !== 1 || fast[0][0] === final[0][0]) throw new Error("无法区分快速与二采视频输出，请在输出文件名前缀标明一采/二采");
    return {
        workflow: JSON.stringify(graph),
        defaultMode: "balanced",
        modes: { fast: { outputNode: fast[0][0] }, balanced: { outputNode: final[0][0], upscale: 1 }, quality: { outputNode: final[0][0], upscale: 1.5 } },
        nodes: {
            prompt: { node: prompt, input: "value" }, duration: { node: duration, input: "value" }, seed: { node: seed, input: "noise_seed" },
            upscale: { node: upscale, input: "value" }, ...(aspect[0] ? { aspectRatio: { node: aspect[0][0], input: "aspect_ratio" } } : {}), reference,
        },
        referenceLimits: { ...DEFAULT_COMFYUI_WORKFLOW_CONFIG.referenceLimits },
    };
}

const ASPECT_RATIOS: Record<string, string> = {
    "1:1": "1:1 (Square)",
    "16:9": "16:9 (Widescreen)",
    "9:16": "9:16 (Portrait Widescreen)",
    "4:3": "4:3 (Standard)",
    "3:4": "3:4 (Portrait Standard)",
    "3:2": "3:2 (Photo)",
    "2:3": "2:3 (Portrait Photo)",
    "21:9": "21:9 (Ultrawide)",
};

export function isComfyUiGenerationMode(value: unknown): value is ComfyUiGenerationMode {
    return value === "fast" || value === "balanced" || value === "quality";
}

export function parseComfyUiWorkflowConfig(value: string | undefined): ComfyUiWorkflowConfig {
    if (!value?.trim()) return DEFAULT_COMFYUI_WORKFLOW_CONFIG;
    let parsed: Partial<ComfyUiWorkflowConfig>;
    try {
        parsed = JSON.parse(value) as Partial<ComfyUiWorkflowConfig>;
    } catch {
        throw new Error("ComfyUI 工作流配置必须是有效 JSON");
    }
    const config = { ...DEFAULT_COMFYUI_WORKFLOW_CONFIG, ...parsed, nodes: { ...DEFAULT_COMFYUI_WORKFLOW_CONFIG.nodes, ...parsed.nodes }, modes: { ...DEFAULT_COMFYUI_WORKFLOW_CONFIG.modes, ...parsed.modes } };
    if (!isComfyUiGenerationMode(config.defaultMode)) config.defaultMode = "balanced";
    return config;
}

export function comfyUiWorkflowConfigSummary(value: string | undefined) {
    try {
        const config = parseComfyUiWorkflowConfig(value);
        return { config, graph: JSON.parse(config.workflow) as ComfyUiGraph, error: "" };
    } catch (error) {
        return { config: DEFAULT_COMFYUI_WORKFLOW_CONFIG, graph: {} as ComfyUiGraph, error: error instanceof Error ? error.message : "ComfyUI 工作流配置无效" };
    }
}

export function buildComfyUiPrompt(input: { config: ComfyUiWorkflowConfig; mode: ComfyUiGenerationMode; prompt: string; durationSeconds: number; seed: number; aspectRatio?: string; references: ComfyUiReference[] }) {
    const { config } = input;
    let source: ComfyUiGraph;
    try {
        source = JSON.parse(config.workflow) as ComfyUiGraph;
    } catch {
        throw new Error("ComfyUI 工作流必须是 API 格式 JSON");
    }
    const graph = structuredClone(source);
    const mode = config.modes[input.mode];
    if (!mode || !graph[mode.outputNode]) throw new Error(`ComfyUI 工作流缺少「${input.mode}」模式的输出节点 ${mode?.outputNode || ""}`);
    for (const id of new Set(Object.values(config.modes).map((item) => item.outputNode))) {
        if (id !== mode.outputNode) delete graph[id];
    }
    // ComfyUI only executes ancestors of output nodes; drop the unused branch so validation does not touch it.
    pruneToOutput(graph, mode.outputNode);
    const output = graph[mode.outputNode];
    if ("save_output" in output.inputs) output.inputs.save_output = true;
    setInput(graph, config.nodes.prompt, input.prompt);
    setInput(graph, config.nodes.duration, input.durationSeconds);
    setInput(graph, config.nodes.seed, input.seed);
    if (mode.upscale !== undefined && graph[config.nodes.upscale.node]) setInput(graph, config.nodes.upscale, mode.upscale);
    const aspect = input.aspectRatio ? ASPECT_RATIOS[input.aspectRatio] : "";
    if (aspect && config.nodes.aspectRatio && graph[config.nodes.aspectRatio.node]) setInput(graph, config.nodes.aspectRatio, aspect);
    attachReferences(graph, config, input.references);
    return { graph, outputNode: mode.outputNode };
}

function attachReferences(graph: ComfyUiGraph, config: ComfyUiWorkflowConfig, references: ComfyUiReference[]) {
    const target = graph[config.nodes.reference];
    if (!target) {
        if (references.length) throw new Error(`ComfyUI 工作流缺少参考素材节点 ${config.nodes.reference}`);
        return;
    }
    const counters = { image: 0, video: 0, audio: 0 };
    let nextId = Math.max(0, ...Object.keys(graph).map(Number).filter(Number.isFinite)) + 1;
    for (const reference of references) {
        const index = counters[reference.type]++;
        if (index >= config.referenceLimits[reference.type]) throw new Error(`ComfyUI 工作流最多支持 ${config.referenceLimits[reference.type]} 个${referenceLabel(reference.type)}`);
        const id = String(nextId++);
        if (reference.type === "image") {
            graph[id] = { class_type: "LoadImage", inputs: { image: reference.name } };
            target.inputs[`ref_images.ref_image_${index}`] = [id, 0];
        } else if (reference.type === "audio") {
            graph[id] = { class_type: "LoadAudio", inputs: { audio: reference.name } };
            target.inputs[`ref_audios.ref_audio_${index}`] = [id, 0];
        } else {
            graph[id] = { class_type: "VHS_LoadVideo", inputs: { video: reference.name, force_rate: 0, custom_width: 0, custom_height: 0, frame_load_cap: 0, skip_first_frames: 0, select_every_nth: 1, format: "H3" } };
            target.inputs[`ref_videos.ref_video_${index}`] = [id, 0];
        }
    }
}

function pruneToOutput(graph: ComfyUiGraph, outputNode: string) {
    const keep = new Set<string>();
    const visit = (id: string) => {
        if (keep.has(id) || !graph[id]) return;
        keep.add(id);
        for (const value of Object.values(graph[id].inputs)) if (Array.isArray(value) && typeof value[0] === "string") visit(value[0]);
    };
    visit(outputNode);
    for (const id of Object.keys(graph)) if (!keep.has(id)) delete graph[id];
}

function setInput(graph: ComfyUiGraph, ref: ComfyUiNodeRef, value: unknown) {
    const node = graph[ref.node];
    if (!node) throw new Error(`ComfyUI 工作流缺少节点 ${ref.node}`);
    node.inputs[ref.input] = value;
}

function referenceLabel(type: ComfyUiReference["type"]) {
    return type === "image" ? "参考图" : type === "video" ? "参考视频" : "参考音频";
}
