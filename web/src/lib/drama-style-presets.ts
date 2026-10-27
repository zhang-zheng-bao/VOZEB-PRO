import type { DramaPromptTemplateKind } from "@/lib/drama-project-contract";

export type DramaPromptTemplateDraft = {
    title: string;
    prompt: string;
    kind: DramaPromptTemplateKind;
};

export const DRAMA_PROMPT_TEMPLATE_KINDS: Array<{ value: DramaPromptTemplateKind; label: string; description: string }> = [
    { value: "character", label: "人物建模", description: "人物外观、服装、身份一致性与设定图规范" },
    { value: "scene", label: "场景建模", description: "空间结构、环境材质、光影与场景一致性" },
    { value: "prop", label: "道具建模", description: "道具结构、材质、比例与可识别特征" },
    { value: "storyboard", label: "分镜图片", description: "构图、景别、镜头连续性与静态画面规范" },
    { value: "video", label: "视频生成", description: "动作、运镜、物理连续性与动态画面规范" },
];

export const RECOMMENDED_DRAMA_PROMPT_TEMPLATES: DramaPromptTemplateDraft[] = [
    {
        kind: "character",
        title: "真人写实人物四视图",
        prompt: "真人写实摄影风格人物四视图设定板，画面比例固定为 16:9，所有视图置于同一张横向画布。严格采用左大右小构图：左侧约占画面 38%，放置一张正面头肩胸像特写，完整展示发型、五官、妆容、耳饰、颈部配饰和上装细节；右侧约占画面 62%，横向等宽排列三张完整全身视图，从左到右依次为正面全身、90 度侧面全身、背面全身。三张全身视图必须从头顶到鞋底完整入画，采用自然中立站姿，双臂与身体适度分开。根据输入的人物信息准确呈现年龄感、面部特征、肤色、体型、发型、服装、鞋履、配饰与标志性细节。四个视图必须是同一人物，脸型、五官、妆容、发色、发长、身材比例、服装结构、纹理、颜色、配饰和鞋履完全一致，只改变景别或观察角度。真实皮肤纹理，真实布料与材质，柔和均匀的影棚布光，纯浅灰无缝背景，高清细节。禁止生成四张等大的全身图，禁止增加另一张侧面，禁止裁切右侧全身人物，禁止卡通、动漫、3D 渲染、夸张美化、文字、标注、分隔线、水印、边框、额外人物和无关道具。",
    },
    {
        kind: "scene",
        title: "通用场景设定图",
        prompt: "根据场景信息生成环境建模设定图。明确空间结构、出入口、主要陈设、材质、光源方向与时间氛围；使用便于后续镜头复用的广角全景构图，保持尺度和空间关系可信，不添加人物、文字、水印或边框。",
    },
    {
        kind: "prop",
        title: "通用道具设定图",
        prompt: "根据道具信息生成清晰的建模设定图。突出轮廓、结构、材质、比例、磨损和关键识别细节；主体居中，角度便于理解形态，背景干净，不添加手持人物、文字、水印或边框。",
    },
    {
        kind: "storyboard",
        title: "通用分镜画面",
        prompt: "根据镜头事实与资产信息生成可直接用于视频参考的分镜画面。严格遵循景别、机位、构图、人物站位、视线和轴线，保持人物身份、服装、道具形态、场景空间及相邻镜头连续，不增加设定外主体，不添加文字、水印或边框。",
    },
    {
        kind: "video",
        title: "通用视频镜头",
        prompt: "根据镜头事实、起止状态和参考画面生成连续视频。动作自然完整，运镜平稳明确，人物身份、服装、表情、视线、轴线、道具和场景保持稳定；遵守真实物理与时间连续性，避免闪烁、形变、漂移、额外肢体和无关主体。",
    },
];

const categoryByKind: Record<DramaPromptTemplateKind, string> = {
    character: "短剧提示词/人物建模",
    scene: "短剧提示词/场景建模",
    prop: "短剧提示词/道具建模",
    storyboard: "短剧提示词/分镜图片",
    video: "短剧提示词/视频生成",
};

export function dramaPromptTemplateCategory(kind: DramaPromptTemplateKind) {
    return categoryByKind[kind];
}

export function dramaPromptTemplateKind(category: string): DramaPromptTemplateKind | undefined {
    return DRAMA_PROMPT_TEMPLATE_KINDS.find((item) => categoryByKind[item.value] === category)?.value;
}

export function parseDramaPromptTemplateFile(fileName: string, content: string, fallbackKind: DramaPromptTemplateKind): DramaPromptTemplateDraft[] {
    const text = content.trim();
    if (!text) return [];
    if (fileName.toLowerCase().endsWith(".json")) return parseJsonPrompts(JSON.parse(text), fallbackKind);
    return [{ title: fileName.replace(/\.(?:txt|md)$/i, "").trim() || "导入模板", prompt: text, kind: fallbackKind }];
}

export function dramaPromptTemplateKey(value: string) {
    return value.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function parseJsonPrompts(value: unknown, fallbackKind: DramaPromptTemplateKind): DramaPromptTemplateDraft[] {
    const items = Array.isArray(value) ? value : typeof value === "object" && value && Array.isArray((value as { templates?: unknown[] }).templates) ? (value as { templates: unknown[] }).templates : [value];
    return items.flatMap((item, index) => {
        if (typeof item === "string") return item.trim() ? [{ title: `导入模板 ${index + 1}`, prompt: item.trim(), kind: fallbackKind }] : [];
        if (!item || typeof item !== "object") return [];
        const record = item as Record<string, unknown>;
        const prompt = String(record.prompt || record.content || "").trim();
        if (!prompt) return [];
        const rawKind = String(record.kind || "");
        const kind = DRAMA_PROMPT_TEMPLATE_KINDS.some((entry) => entry.value === rawKind) ? (rawKind as DramaPromptTemplateKind) : dramaPromptTemplateKind(String(record.category || "")) || fallbackKind;
        return [{ title: String(record.title || record.name || `导入模板 ${index + 1}`).trim(), prompt, kind }];
    });
}
