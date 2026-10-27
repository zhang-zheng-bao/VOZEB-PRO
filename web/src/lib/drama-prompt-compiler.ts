import type { DramaEpisode, DramaNamedAsset, DramaProject, DramaShot, DramaShotContinuity } from "@/lib/drama-project-contract";
import { dramaAssetConsistencySources, type DramaVisualAssetKind } from "@/lib/drama-asset-consistency";
import { extractImageSizeFromPrompt } from "@/lib/image-size";

export type CompiledDramaPrompts = {
    imagePrompt: string;
    startFramePrompt: string;
    endFramePrompt: string;
    videoPrompt: string;
};

export function compileDramaShotPrompts(project: DramaProject, episode: DramaEpisode, shot: DramaShot): CompiledDramaPrompts {
    const scene = project.scenes.find((item) => item.id === shot.sceneId);
    const characters = project.characters.filter((item) => shot.characterIds.includes(item.id));
    const props = project.props.filter((item) => shot.propIds.includes(item.id));
    const clues = project.clues.filter((item) => shot.clueIds.includes(item.id));
    const continuity = continuityLines(shot.continuity);
    const shared = compact([
        `项目：${project.title} / ${episode.title}`,
        dramaVisualStyleLine(project),
        `画幅：${project.ratio}`,
        scene ? `场景设定：${assetText(scene)}` : "",
        characters.length ? `角色设定：${characters.map(assetText).join("；")}` : "",
        props.length ? `道具设定：${props.map(assetText).join("；")}` : "",
        clues.length ? `叙事线索：${clues.map((item) => `${assetText(item)}；回收：${item.payoff}`).join("；")}` : "",
        continuity.length ? `连续性约束：${continuity.join("；")}` : "",
        shot.negativePrompt ? `避免：${shot.negativePrompt}` : "",
    ]);
    const imagePrompt = compact([
        promptTemplateLine(project, "storyboard", "分镜图片模板"),
        ...shared,
        `镜头事实：${shot.description || shot.sourceText}`,
        shot.imagePrompt ? `视觉方案：${shot.imagePrompt}` : "",
        shot.startFramePrompt ? `起始画面：${shot.startFramePrompt}` : "",
        "保持角色身份、服装、道具形态、场景空间关系与相邻镜头一致，不添加未在设定中出现的主体或文字。",
    ]).join("\n");
    const startFramePrompt = compact([promptTemplateLine(project, "storyboard", "分镜图片模板"), ...shared, `起始动作状态：${shot.continuity?.actionStart || shot.description}`, shot.startFramePrompt || shot.imagePrompt]).join("\n");
    const endFramePrompt = compact([promptTemplateLine(project, "storyboard", "分镜图片模板"), ...shared, `结束动作状态：${shot.continuity?.actionEnd || shot.description}`, shot.endFramePrompt || shot.videoPrompt || shot.imagePrompt]).join("\n");
    const videoPrompt = compact([
        promptTemplateLine(project, "video", "视频生成模板"),
        ...shared,
        `镜头事实：${shot.description || shot.sourceText}`,
        shot.videoPrompt ? `动态方案：${shot.videoPrompt}` : "",
        shot.cameraMotion ? `镜头运动：${shot.cameraMotion}` : "",
        `从“${shot.continuity?.actionStart || "镜头起始状态"}”自然过渡到“${shot.continuity?.actionEnd || "镜头结束状态"}”，时长 ${shot.duration} 秒。`,
        shot.dialogue ? `对白：${shot.dialogue}` : "",
        shot.narration ? `画外音节奏：${shot.narration}` : "",
        "动作连续、物理合理，保持人物身份、服装、视线、轴线和运动方向稳定。",
    ]).join("\n");
    return { imagePrompt, startFramePrompt, endFramePrompt, videoPrompt };
}

export function compileDramaAssetReferencePrompt(project: DramaProject, asset: DramaNamedAsset, kind: "角色" | "场景" | "道具") {
    const templateKind = kind === "角色" ? "character" : kind === "场景" ? "scene" : "prop";
    const assetKind: DramaVisualAssetKind = kind === "角色" ? "characters" : kind === "场景" ? "scenes" : "props";
    const consistencySources = dramaAssetConsistencySources(project, asset, assetKind);
    const templatePrompt = project.promptTemplates?.[templateKind]?.prompt.trim() || "";
    const assetRatio = extractImageSizeFromPrompt(templatePrompt) || project.ratio;
    return compact([
        promptTemplateLine(project, templateKind, kind === "角色" ? "人物建模模板" : `${kind}建模模板`),
        `${kind}设定图，画幅 ${assetRatio}`,
        dramaVisualStyleLine(project),
        `名称：${asset.name}`,
        `基础描述：${asset.description}`,
        asset.profile?.visualIdentity ? `视觉识别：${asset.profile.visualIdentity}` : "",
        asset.profile?.styling ? `造型与材质：${asset.profile.styling}` : "",
        asset.profile?.colorPalette ? `固定色彩：${asset.profile.colorPalette}` : "",
        asset.profile?.consistencyRules ? `一致性规则：${asset.profile.consistencyRules}` : "",
        consistencySources.length ? `参考图顺序：${consistencySources.map((source, index) => `第 ${index + 1} 张是${source.role === "target" ? `目标“${source.asset.name}”现有基准` : source.role === "related-character" ? `关联角色“${source.asset.name}”基准` : `关联道具“${source.asset.name}”基准`}`).join("；")}。` : "",
        kind === "道具" && consistencySources.some((source) => source.role === "related-character")
            ? `若关联角色参考图中已经出现“${asset.name}”，必须从人物画面提取并复用该道具的造型、结构、材质、颜色、纹样和比例，不得重新设计；输出只展示道具，不保留人物。`
            : "",
        kind === "角色" && consistencySources.some((source) => source.role === "related-prop")
            ? "角色身上或手持的关联道具必须严格沿用对应道具基准图，不得改色、换款、删减结构或另行设计。"
            : "",
        kind === "角色" ? "严格保持左侧大幅正面头肩胸像特写、右侧正面全身/90 度侧面全身/背面全身的四视图版式；不得改成四张等大全身图，干净中性背景，不添加文字。" : "主体结构清晰，便于后续镜头稳定引用，不添加文字。",
    ]).join("\n");
}

function promptTemplateLine(project: DramaProject, kind: "character" | "scene" | "prop" | "storyboard" | "video", label: string) {
    const prompt = project.promptTemplates?.[kind]?.prompt.trim();
    return prompt ? `${label}：${prompt}` : "";
}

function dramaVisualStyleLine(project: DramaProject) {
    const style = project.visualStylePrompt?.trim() || project.style.trim();
    return style ? `统一视觉风格：${style}` : "";
}

function assetText(asset: DramaNamedAsset) {
    return compact([
        `${asset.name}：${asset.description}`,
        asset.profile?.visualIdentity,
        asset.profile?.styling,
        asset.profile?.colorPalette ? `色彩 ${asset.profile.colorPalette}` : "",
        asset.profile?.consistencyRules ? `固定规则 ${asset.profile.consistencyRules}` : "",
    ]).join("，");
}

function continuityLines(value?: DramaShotContinuity) {
    if (!value) return [];
    return compact([
        value.shotSize ? `景别 ${value.shotSize}` : "",
        value.cameraAngle ? `机位 ${value.cameraAngle}` : "",
        value.composition ? `构图 ${value.composition}` : "",
        value.characterBlocking ? `站位 ${value.characterBlocking}` : "",
        value.gazeDirection ? `视线 ${value.gazeDirection}` : "",
        value.screenDirection ? `运动方向 ${value.screenDirection}` : "",
        value.axisRule ? `轴线 ${value.axisRule}` : "",
        value.continuityNotes,
    ]);
}

function compact(values: Array<string | undefined>) {
    return values.map((value) => value?.trim() || "").filter(Boolean);
}
