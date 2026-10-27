"use client";

import { App, Button, Input, Select } from "antd";
import { Settings2 } from "lucide-react";
import { useEffect, useState } from "react";

import type { DramaEpisode, DramaProject, DramaPromptTemplateKind } from "../types";
import { DRAMA_PROMPT_TEMPLATE_KINDS, dramaPromptTemplateCategory } from "@/lib/drama-style-presets";
import { listMyPrompts } from "@/services/api/my-prompts";
import type { Prompt } from "@/services/api/prompts";
import { useDramaStore } from "../stores/use-drama-store";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { dramaImageModelOptions, selectDramaStoryboardImageModel } from "./drama-shot-generation-utils";

const FOLLOW_CHARACTER_MODEL = "__follow_character_model__";

export function DramaEpisodeSettings({ project, episode, embedded = false }: { project: DramaProject; episode: DramaEpisode; embedded?: boolean }) {
    const { message } = App.useApp();
    const updateProject = useDramaStore((state) => state.updateProject);
    const updateEpisode = useDramaStore((state) => state.updateEpisode);
    const config = useEffectiveConfig();
    const [templates, setTemplates] = useState<Prompt[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const paragraphCount = episode.script.trim() ? episode.script.split(/\n+/).filter(Boolean).length : 0;
    const characterCount = new Set(episode.shots.flatMap((shot) => shot.characterIds)).size;
    const duration = episode.shots.reduce((total, shot) => total + (Number.isFinite(shot.duration) ? shot.duration : 0), 0);
    const imageModels = dramaImageModelOptions(config).filter((model) => model.supportsReference);
    const inheritedImageModel = project.assetImageModels?.character || selectDramaStoryboardImageModel(config, project);
    const inheritedImageModelName = imageModels.find((model) => model.id === inheritedImageModel)?.name || "后台默认模型";

    useEffect(() => {
        setTemplatesLoading(true);
        void Promise.all(DRAMA_PROMPT_TEMPLATE_KINDS.map((item) => listMyPrompts({ page: 1, pageSize: 100, category: dramaPromptTemplateCategory(item.value), includeFacets: false })))
            .then((results) => setTemplates(results.flatMap((result) => result.items)))
            .catch((error) => message.error(error instanceof Error ? error.message : "提示词模板加载失败"))
            .finally(() => setTemplatesLoading(false));
    }, [message]);

    const selectTemplate = (kind: DramaPromptTemplateKind, id?: string) => {
        const template = templates.find((item) => item.id === id);
        const promptTemplates = { ...project.promptTemplates };
        if (template) promptTemplates[kind] = { id: template.id, title: template.title, prompt: template.prompt };
        else delete promptTemplates[kind];
        updateProject(project.id, { promptTemplates });
    };
    return (
        <aside className={`hide-scrollbar min-h-0 min-w-0 overflow-y-auto bg-card ${embedded ? "max-h-[min(620px,calc(100vh-150px))] p-1" : "border-l border-border p-3"}`} data-drama-episode-settings>
            {!embedded ? (
                <>
                    <h3 className="text-sm font-semibold">本集设置</h3>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">设置会自动保存到当前项目</p>
                </>
            ) : null}
            <div className={`${embedded ? "space-y-3" : "mt-4 space-y-4"}`}>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">本集名称</span>
                    <Input className="!h-8" value={episode.title} onChange={(event) => updateEpisode(project.id, episode.id, { title: event.target.value })} />
                </label>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">故事简介</span>
                    <Input.TextArea value={project.summary} onChange={(event) => updateProject(project.id, { summary: event.target.value })} autoSize={{ minRows: 3, maxRows: 6 }} />
                </label>
                <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-foreground">视觉风格</span>
                    <Input className="!h-8" value={project.style} placeholder="例如：电影感国漫" onChange={(event) => updateProject(project.id, { style: event.target.value })} />
                </label>
                <div className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">视频生产模式</span>
                    <div className="min-w-0">
                        <Select
                            className="w-full"
                            value={project.defaultVideoMode}
                            options={[
                                { label: "分镜驱动", value: "storyboard" },
                                { label: "直接生成", value: "direct" },
                                { label: "参考图", value: "reference" },
                            ]}
                            onChange={(value) => updateProject(project.id, { defaultVideoMode: value as DramaProject["defaultVideoMode"] })}
                        />
                    </div>
                </div>
                <div className="space-y-1.5">
                    <span className="text-xs font-medium text-foreground">分镜生图模型</span>
                    <Select
                        className="w-full"
                        value={project.storyboardImageModel || FOLLOW_CHARACTER_MODEL}
                        options={[
                            { label: `跟随人物资产模型 · ${inheritedImageModelName}`, value: FOLLOW_CHARACTER_MODEL },
                            ...imageModels.map((model) => ({ label: model.name, value: model.id })),
                        ]}
                        onChange={(value) => updateProject(project.id, { storyboardImageModel: value === FOLLOW_CHARACTER_MODEL ? undefined : value })}
                    />
                    <p className="text-[11px] leading-4 text-muted-foreground">用于分镜起始帧和尾帧，列表仅显示支持参考图的模型。</p>
                </div>
                <div className="space-y-2 border-t border-border pt-3">
                    <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-foreground">项目提示词模板</span>
                        <Button type="text" size="small" href="/settings?section=dramaStyles" icon={<Settings2 className="size-3.5" />} aria-label="管理短剧提示词模板" />
                    </div>
                    {DRAMA_PROMPT_TEMPLATE_KINDS.map((item) => (
                        <label key={item.value} className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
                            <span className="text-xs text-muted-foreground">{item.label}</span>
                            <Select
                                allowClear
                                size="small"
                                loading={templatesLoading}
                                value={project.promptTemplates?.[item.value]?.id}
                                placeholder="默认约束"
                                options={templates.filter((template) => template.category === dramaPromptTemplateCategory(item.value)).map((template) => ({ label: template.title, value: template.id }))}
                                onChange={(id) => selectTemplate(item.value, id)}
                            />
                        </label>
                    ))}
                </div>
            </div>
            <div className="mt-4 border-t border-border pt-3" data-drama-episode-overview>
                <div className="flex items-center justify-between">
                    <h4 className="text-xs font-semibold">本集概况</h4>
                    <span className="text-[10px] text-muted-foreground">当前数据</span>
                </div>
                <dl className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                    <Stat label="字数" value={episode.script.length} />
                    <Stat label="段落" value={paragraphCount} />
                    <Stat label="场景 / 镜头" value={episode.shots.length} />
                    <Stat label="角色" value={characterCount} />
                    {duration > 0 ? <Stat label="预估时长" value={`${duration} 秒`} /> : null}
                </dl>
            </div>
        </aside>
    );
}

function Stat({ label, value }: { label: string; value: string | number }) {
    return (
        <div>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-foreground">{value}</dd>
        </div>
    );
}
