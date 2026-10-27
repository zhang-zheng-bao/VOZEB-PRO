"use client";

import { App, Button, Empty, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Upload } from "antd";
import type { TableColumnsType } from "antd";
import { FileUp, Pencil, Plus, Sparkles, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Panel, PanelHeader } from "@/components/admin/admin-panel";
import type { DramaPromptTemplateKind } from "@/lib/drama-project-contract";
import { DRAMA_PROMPT_TEMPLATE_KINDS, RECOMMENDED_DRAMA_PROMPT_TEMPLATES, dramaPromptTemplateCategory, dramaPromptTemplateKey, parseDramaPromptTemplateFile } from "@/lib/drama-style-presets";
import { createMyPrompt, deleteMyPrompt, listMyPrompts, updateMyPrompt } from "@/services/api/my-prompts";
import type { Prompt } from "@/services/api/prompts";

type EditorState = { id?: string; title: string; prompt: string; kind: DramaPromptTemplateKind };

export function AdminDramaStyleSection() {
    const { message } = App.useApp();
    const [activeKind, setActiveKind] = useState<DramaPromptTemplateKind>("character");
    const [prompts, setPrompts] = useState<Prompt[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [deletingId, setDeletingId] = useState("");
    const [editor, setEditor] = useState<EditorState | null>(null);
    const [importKind, setImportKind] = useState<DramaPromptTemplateKind | null>(null);
    const [importing, setImporting] = useState(false);
    const [initializing, setInitializing] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const results = await Promise.all(DRAMA_PROMPT_TEMPLATE_KINDS.map((item) => listMyPrompts({ page: 1, pageSize: 100, category: dramaPromptTemplateCategory(item.value), includeFacets: false })));
            setPrompts(results.flatMap((result) => result.items));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "短剧提示词模板加载失败");
        } finally {
            setLoading(false);
        }
    }, [message]);

    useEffect(() => void load(), [load]);

    const rows = useMemo(() => prompts.filter((item) => item.category === dramaPromptTemplateCategory(activeKind)), [activeKind, prompts]);
    const activeDefinition = DRAMA_PROMPT_TEMPLATE_KINDS.find((item) => item.value === activeKind)!;

    const save = async () => {
        if (!editor?.title.trim() || !editor.prompt.trim()) return message.warning("请填写模板名称和提示词");
        const category = dramaPromptTemplateCategory(editor.kind);
        const duplicate = prompts.find((item) => item.id !== editor.id && item.category === category && dramaPromptTemplateKey(item.prompt) === dramaPromptTemplateKey(editor.prompt));
        if (duplicate) return message.warning("内容与“" + duplicate.title + "”重复");
        setSaving(true);
        try {
            const definition = DRAMA_PROMPT_TEMPLATE_KINDS.find((item) => item.value === editor.kind)!;
            const input = { title: editor.title.trim(), prompt: editor.prompt.trim(), category, tags: ["短剧", definition.label] };
            const saved = editor.id ? await updateMyPrompt(editor.id, input) : await createMyPrompt(input);
            setPrompts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
            setActiveKind(editor.kind);
            setEditor(null);
            message.success(editor.id ? "模板已更新" : "模板已添加");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模板保存失败");
        } finally {
            setSaving(false);
        }
    };

    const remove = async (id: string) => {
        setDeletingId(id);
        try {
            await deleteMyPrompt(id);
            setPrompts((current) => current.filter((item) => item.id !== id));
            message.success("模板已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模板删除失败");
        } finally {
            setDeletingId("");
        }
    };

    const initializeRecommended = async () => {
        setInitializing(true);
        try {
            const known = new Set(prompts.map((item) => item.category + ":" + dramaPromptTemplateKey(item.prompt)));
            const missing = RECOMMENDED_DRAMA_PROMPT_TEMPLATES.filter((item) => !known.has(dramaPromptTemplateCategory(item.kind) + ":" + dramaPromptTemplateKey(item.prompt)));
            const created: Prompt[] = [];
            for (const item of missing) {
                const definition = DRAMA_PROMPT_TEMPLATE_KINDS.find((entry) => entry.value === item.kind)!;
                created.push(await createMyPrompt({ title: item.title, prompt: item.prompt, category: dramaPromptTemplateCategory(item.kind), tags: ["短剧", definition.label] }));
            }
            setPrompts((current) => [...created, ...current]);
            message.success(created.length ? "已添加 " + created.length + " 个推荐模板" : "推荐模板已经存在");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "推荐模板初始化失败");
            await load();
        } finally {
            setInitializing(false);
        }
    };

    const importFile = async (file: File, kind: DramaPromptTemplateKind) => {
        setImporting(true);
        try {
            const incoming = parseDramaPromptTemplateFile(file.name, await file.text(), kind);
            if (!incoming.length) throw new Error("文件中没有可导入的提示词模板");
            const known = new Set(prompts.map((item) => item.category + ":" + dramaPromptTemplateKey(item.prompt)));
            const unique = incoming.filter((item) => {
                const key = dramaPromptTemplateCategory(item.kind) + ":" + dramaPromptTemplateKey(item.prompt);
                if (known.has(key)) return false;
                known.add(key);
                return true;
            });
            const created: Prompt[] = [];
            for (const item of unique) {
                const definition = DRAMA_PROMPT_TEMPLATE_KINDS.find((entry) => entry.value === item.kind)!;
                created.push(await createMyPrompt({ title: item.title, prompt: item.prompt, category: dramaPromptTemplateCategory(item.kind), tags: ["短剧", definition.label] }));
            }
            setPrompts((current) => [...created, ...current]);
            setImportKind(null);
            message.success(created.length ? "已导入 " + created.length + " 个模板" : "文件中的模板已经存在");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模板导入失败");
            await load();
        } finally {
            setImporting(false);
        }
        return false;
    };

    const columns: TableColumnsType<Prompt> = [
        { title: "模板名称", dataIndex: "title", width: 220, render: (value: string) => <div className="truncate font-medium text-zinc-950 dark:text-zinc-100">{value}</div> },
        { title: "提示词", dataIndex: "prompt", render: (value: string) => <div className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-zinc-600 dark:text-zinc-300">{value}</div> },
        {
            title: "操作",
            width: 136,
            render: (_, row) => (
                <Space size="small">
                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditor({ id: row.id, title: row.title, prompt: row.prompt, kind: activeKind })}>编辑</Button>
                    <Popconfirm title="删除这个提示词模板？" description="已保存到项目中的模板快照不会受影响。" okText="删除" cancelText="取消" onConfirm={() => void remove(row.id)}>
                        <Button size="small" danger loading={deletingId === row.id} icon={<Trash2 className="size-3.5" />} aria-label={"删除模板：" + row.title} />
                    </Popconfirm>
                </Space>
            ),
        },
    ];

    return (
        <>
            <Panel>
                <PanelHeader
                    title="短剧提示词模板"
                    description="按生成用途分别管理。所有模板都可直接编辑和删除，项目选择后会保存快照。"
                    actions={
                        <div className="flex flex-wrap justify-end gap-2">
                            <Button icon={<Sparkles className="size-4" />} loading={initializing} onClick={() => void initializeRecommended()}>初始化推荐模板</Button>
                            <Button icon={<FileUp className="size-4" />} onClick={() => setImportKind(activeKind)}>导入文件</Button>
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setEditor({ title: "", prompt: "", kind: activeKind })}>新增模板</Button>
                        </div>
                    }
                />
                <div className="p-4 sm:p-5">
                    <Segmented block value={activeKind} options={DRAMA_PROMPT_TEMPLATE_KINDS.map((item) => ({ label: item.label, value: item.value }))} onChange={(value) => setActiveKind(value as DramaPromptTemplateKind)} />
                    <p className="mb-4 mt-3 text-sm text-muted-foreground">{activeDefinition.description}</p>
                    <Table rowKey="id" columns={columns} dataSource={rows} loading={loading} pagination={false} tableLayout="fixed" scroll={{ x: 680 }} locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这一类还没有模板" /> }} />
                </div>
            </Panel>

            <Modal title={editor?.id ? "编辑提示词模板" : "新增提示词模板"} open={Boolean(editor)} centered width={680} confirmLoading={saving} okText="保存" cancelText="取消" onOk={() => void save()} onCancel={() => setEditor(null)}>
                <div className="grid gap-4 pt-3">
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">用途分类</span>
                        <Select value={editor?.kind} options={DRAMA_PROMPT_TEMPLATE_KINDS.map((item) => ({ value: item.value, label: item.label }))} onChange={(kind) => setEditor((current) => (current ? { ...current, kind } : current))} />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">模板名称</span>
                        <Input value={editor?.title || ""} onChange={(event) => setEditor((current) => (current ? { ...current, title: event.target.value } : current))} placeholder="例如：国漫人物三视图" />
                    </label>
                    <label className="grid gap-1.5 text-sm">
                        <span className="font-medium">提示词模板</span>
                        <Input.TextArea value={editor?.prompt || ""} onChange={(event) => setEditor((current) => (current ? { ...current, prompt: event.target.value } : current))} rows={9} placeholder="只写这一类任务的固定约束；人物、剧情和镜头等动态信息会在生成时自动追加。" />
                    </label>
                </div>
            </Modal>

            <Modal title="导入提示词模板" open={Boolean(importKind)} centered width={640} footer={null} onCancel={() => setImportKind(null)}>
                <div className="mt-3 grid gap-3">
                    <Select value={importKind} options={DRAMA_PROMPT_TEMPLATE_KINDS.map((item) => ({ value: item.value, label: item.label }))} onChange={setImportKind} />
                    <Upload.Dragger accept=".txt,.md,.json,text/plain,text/markdown,application/json" showUploadList={false} disabled={importing || !importKind} beforeUpload={(file) => { if (importKind) void importFile(file as File, importKind); return false; }}>
                        <FileUp className="mx-auto mb-2 size-7 text-zinc-400" />
                        <div className="text-sm font-medium">拖入 TXT、MD 或 JSON 文件</div>
                        <div className="mt-1 text-xs text-zinc-500">TXT、MD 使用上方分类；JSON 可为每项提供 kind 字段。</div>
                        {importing ? <div className="mt-3 text-xs text-zinc-500">正在导入...</div> : null}
                    </Upload.Dragger>
                </div>
            </Modal>
        </>
    );
}
