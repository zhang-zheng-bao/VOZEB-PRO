"use client";

import { useMemo, useRef, useState } from "react";
import { App, Button, Input, Modal, Pagination } from "antd";
import { BookOpenText, FileText, FolderOpen, Search, Upload } from "lucide-react";

import { splitDramaSource, type DramaSourceEpisodeDraft } from "@/lib/drama-source-splitter";
import type { DramaProject } from "../types";
import { useDramaStore } from "../stores/use-drama-store";

const IMPORT_PAGE_SIZE = 20;

export function DramaSourceImport({ project, onImported }: { project: DramaProject; onImported: () => void }) {
    const { message } = App.useApp();
    const importEpisodes = useDramaStore((state) => state.importEpisodes);
    const createVersion = useDramaStore((state) => state.createVersion);
    const inputRef = useRef<HTMLInputElement>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [dragActive, setDragActive] = useState(false);
    const [drafts, setDrafts] = useState<DramaSourceEpisodeDraft[]>([]);
    const [fileName, setFileName] = useState("");
    const [query, setQuery] = useState("");
    const [page, setPage] = useState(1);
    const [importing, setImporting] = useState(false);
    const totalCharacters = useMemo(() => drafts.reduce((total, draft) => total + draft.script.length, 0), [drafts]);
    const filtered = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        if (!keyword) return drafts.map((draft, index) => ({ draft, index }));
        return drafts.flatMap((draft, index) => (`${draft.title} ${draft.sourceRange}`.toLocaleLowerCase().includes(keyword) ? [{ draft, index }] : []));
    }, [drafts, query]);
    const visible = filtered.slice((page - 1) * IMPORT_PAGE_SIZE, page * IMPORT_PAGE_SIZE);

    const close = () => {
        setModalOpen(false);
        setDragActive(false);
        setDrafts([]);
        setFileName("");
        setQuery("");
        setPage(1);
    };

    const readSource = async (file?: File) => {
        if (!file) return;
        if (!isDramaSourceFile(file)) {
            message.warning("请选择 TXT 或 Markdown 剧本文件");
            return;
        }
        try {
            const nextDrafts = splitDramaSource(await file.text());
            if (!nextDrafts.length) return message.warning("导入文件没有可识别的文本内容");
            setDrafts(nextDrafts);
            setFileName(file.name);
            setQuery("");
            setPage(1);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "整本导入失败");
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    const confirmImport = async () => {
        setImporting(true);
        try {
            await createVersion(project, "整本导入前");
            importEpisodes(project.id, drafts);
            close();
            onImported();
            message.success(`已导入 ${drafts.length} 集，请逐集检查并提取内容结构`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "整本导入失败");
        } finally {
            setImporting(false);
        }
    };

    return (
        <>
            <Button className="!h-8 !px-2.5" size="small" icon={<BookOpenText className="size-3.5" />} onClick={() => setModalOpen(true)}>
                导入剧本
            </Button>
            <input ref={inputRef} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => void readSource(event.target.files?.[0])} />
            <Modal
                title="导入整本剧本"
                open={modalOpen}
                width={720}
                centered
                destroyOnHidden
                mask={{ closable: !importing }}
                closable={!importing}
                okText={`确认导入 ${drafts.length} 集`}
                footer={drafts.length ? undefined : null}
                cancelText="取消"
                okButtonProps={{ loading: importing }}
                cancelButtonProps={{ disabled: importing }}
                onOk={() => void confirmImport()}
                onCancel={close}
                styles={{ container: { maxWidth: "calc(100vw - 24px)" }, body: { padding: 0 } }}
            >
                {drafts.length ? <div className="flex max-h-[min(68vh,640px)] min-h-0 flex-col overflow-hidden">
                    <div className="shrink-0 border-b border-border px-5 py-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                            <span className="flex min-w-0 items-center gap-1.5" title={fileName}>
                                <FileText className="size-3.5 shrink-0" />
                                <span className="max-w-60 truncate text-foreground">{fileName}</span>
                            </span>
                            <span>{drafts.length.toLocaleString("zh-CN")} 集</span>
                            <span>{totalCharacters.toLocaleString("zh-CN")} 字</span>
                            <span>将替换当前 {project.episodes.length} 集、重置项目资产，并自动创建恢复版本</span>
                        </div>
                        <Input
                            className="!mt-3 !h-8"
                            allowClear
                            prefix={<Search className="size-3.5 text-muted-foreground" />}
                            value={query}
                            onChange={(event) => {
                                setQuery(event.target.value);
                                setPage(1);
                            }}
                            placeholder="搜索分集标题或来源范围"
                            aria-label="搜索待导入分集"
                        />
                    </div>
                    <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-2" data-drama-import-preview>
                        {visible.length ? (
                            <div className="divide-y divide-border">
                                {visible.map(({ draft, index }) => (
                                    <div key={`${index}-${draft.title}`} className="grid min-w-0 grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2 px-2 py-2.5">
                                        <span className="text-xs font-medium tabular-nums text-muted-foreground">{String(index + 1).padStart(2, "0")}</span>
                                        <span className="min-w-0">
                                            <span className="block truncate text-sm font-medium">{draft.title || `第 ${index + 1} 集`}</span>
                                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{draft.sourceRange || "按正文长度自动划分"}</span>
                                        </span>
                                        <span className="text-xs tabular-nums text-muted-foreground">{draft.script.length.toLocaleString("zh-CN")} 字</span>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="grid min-h-40 place-items-center text-sm text-muted-foreground">没有匹配的分集</div>
                        )}
                    </div>
                    {filtered.length > IMPORT_PAGE_SIZE ? (
                        <div className="flex shrink-0 justify-end border-t border-border px-4 py-2.5">
                            <Pagination size="small" current={page} pageSize={IMPORT_PAGE_SIZE} total={filtered.length} showSizeChanger={false} showLessItems onChange={setPage} />
                        </div>
                    ) : null}
                </div> : (
                    <div className="px-1 pb-1 pt-3">
                        <div
                            role="button"
                            tabIndex={0}
                            aria-label="拖入剧本文件或点击选择文件"
                            className={`grid min-h-64 place-items-center rounded-lg border border-dashed px-5 py-8 text-center transition-colors ${dragActive ? "border-foreground bg-accent" : "border-border bg-muted/20 hover:bg-muted/40"}`}
                            onClick={() => inputRef.current?.click()}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    inputRef.current?.click();
                                }
                            }}
                            onDragEnter={(event) => {
                                event.preventDefault();
                                setDragActive(true);
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "copy";
                                setDragActive(true);
                            }}
                            onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragActive(false);
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                setDragActive(false);
                                void readSource(event.dataTransfer.files[0]);
                            }}
                        >
                            <div>
                                <span className="mx-auto grid size-11 place-items-center rounded-lg border border-border bg-background text-muted-foreground">
                                    <Upload className="size-5" />
                                </span>
                                <h3 className="mt-4 text-base font-semibold text-foreground">拖入剧本文件</h3>
                                <p className="mt-1.5 text-sm text-muted-foreground">支持 TXT、Markdown，导入前可预览自动拆分的分集</p>
                                <Button
                                    className="!mt-5 !h-9"
                                    icon={<FolderOpen className="size-4" />}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        inputRef.current?.click();
                                    }}
                                >
                                    选择文件
                                </Button>
                                <p className="mt-4 text-xs text-muted-foreground">确认导入时才会替换当前 {project.episodes.length} 集、重置项目资产，并自动创建恢复版本</p>
                            </div>
                        </div>
                    </div>
                )}
            </Modal>
        </>
    );
}

function isDramaSourceFile(file: File) {
    const name = file.name.toLowerCase();
    return name.endsWith(".txt") || name.endsWith(".md") || file.type === "text/plain" || file.type === "text/markdown";
}
