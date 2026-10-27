import type { ImageTask, ImageTaskReference } from "@/lib/server/image-task-store";
import { GenerationSubmissionSafeFailure, GenerationSubmissionUncertainError } from "@/lib/server/generation-submission-error";
import { buildProviderRequest, isProviderBusinessError, readProviderError, readProviderString } from "@/lib/server/provider-task-config";
import { normalizeRunningHubImagePayload, runningHubOpenApiCreatePathAlias } from "@/lib/runninghub-openapi-alias";
import { buildYumengImageRequest, resolveYumengImageResolution } from "@/lib/yumeng-model-center";

import { isExternalPublicMediaUrl, rawReferenceRequestUrlCandidates } from "./image-task-reference-urls";
import { publicImageReferenceRequestUrl } from "./image-task-openai";
import { IMAGE_TASK_POLL_INTERVAL_MS, type ImageApiResponse, type ImageTaskResult } from "./image-task-types";
import {
    findImageResult,
    imagePointsIdempotencyKey,
    imageSubmissionFetch,
    imageSubmissionResponseError,
    imageReferenceToFile,
    imageReferenceToDataUrl,
    imageTaskPollAttempts,
    imageTaskPollUrls,
    isPendingImageStatus,
    parseChargedImageResponse,
    readFetchError,
    readImageTaskId,
    parseImageSubmissionJson,
    imageRequestAspectRatio,
    resolveRequestSize,
    taskFetch,
    taskHeaders,
    taskUrl,
    withSystemPrompt,
    ImageUpstreamTerminalError,
} from "./image-task-support";

const RUNNINGHUB_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const runningHubUploadCache = new Map<string, { url: string; expiresAt: number }>();
const runningHubUploads = new Map<string, Promise<string>>();

export async function runCustomImageTask(task: ImageTask, origin: string, publicOrigin: string, cookie: string, singleStep = false) {
    const config = task.config;
    const advanced = config.advancedConfig;
    if (!advanced?.createPath || !advanced.requestTemplate || !advanced.resultField) throw new GenerationSubmissionSafeFailure("自定义图片协议缺少创建路径、请求模板或结果字段");
    const size = resolveDeclarativeImageSize(config);
    const [width, height] = /^\d+x\d+$/.test(size) ? size.split("x").map(Number) : [undefined, undefined];
    const context = { ownerUserId: task.userId, taskId: task.id };
    const inlineReferences = advanced.protocol === "stable-diffusion" || /\bbase64\b|data:image|\binline\b/i.test(advanced.referenceRule || "");
    const images = (
        await Promise.all(
            task.references.map((reference, index) =>
                advanced.protocol === "runninghub"
                    ? runningHubImageReferenceUrl(task, reference, reference.name || `reference-${index + 1}.png`, origin, cookie)
                    : inlineReferences
                      ? imageReferenceToDataUrl(reference, reference.name || `reference-${index + 1}.png`, origin, cookie)
                      : publicImageReferenceRequestUrl(reference, origin, publicOrigin, context),
            ),
        )
    ).filter(Boolean);
    const values = {
        model: config.model,
        prompt: withSystemPrompt(config, task.prompt),
        size,
        aspect_ratio: imageRequestAspectRatio(config.size || "auto"),
        resolution: advanced.protocol === "yumeng" ? resolveYumengImageResolution(config.model, config.quality) : config.quality || "auto",
        width,
        height,
        quality: config.quality || "auto",
        n: 1,
        image: images[0] || "",
        images,
    };
    const builtPayload =
        advanced.protocol === "yumeng"
            ? buildYumengImageRequest({ model: config.model, prompt: values.prompt, images, aspectRatio: values.aspect_ratio, resolution: values.resolution, size })
            : buildProviderRequest(advanced.requestTemplate, values, values);
    const payload = advanced.protocol === "runninghub" ? normalizeRunningHubImagePayload(builtPayload, config.model) : builtPayload;
    const createPath = task.kind === "edit" ? advanced.editPath || advanced.createPath : advanced.createPath;
    const url = taskUrl(config, advanced.protocol === "runninghub" ? runningHubOpenApiCreatePathAlias(config.model) || createPath : createPath, origin);
    const headers = taskHeaders(config, cookie, imagePointsIdempotencyKey(task));
    headers.set("content-type", "application/json");
    const response = await imageSubmissionFetch(config, url, { method: "POST", headers, body: JSON.stringify(payload), cache: "no-store" });
    if (!response.ok) throw imageSubmissionResponseError(response.status, await readFetchError(response, "自定义图片接口调用失败"));
    const data = await parseImageSubmissionJson<ImageApiResponse>(response);
    return parseChargedImageResponse(task, response, async () => {
        if (isProviderBusinessError(data)) throw new GenerationSubmissionSafeFailure(readProviderError(data) || "自定义图片接口返回失败");
        const baseUrl = response.headers.get("x-vozeb-pro-upstream-url") || url;
        const direct = configuredImageResult(data, baseUrl, task);
        if (direct) return direct;
        const taskId = readImageTaskId(data);
        if (!taskId || !advanced.queryPath) throw new GenerationSubmissionUncertainError("自定义图片接口没有返回图片或任务 ID，创建结果待确认");
        if (singleStep) return { dataUrl: "", pending: { id: taskId, mediaBaseUrl: baseUrl, pollBaseUrl: url } };
        return pollCustomImageTask(task, taskId, baseUrl, cookie);
    });
}

export async function runningHubImageReferenceUrl(task: ImageTask, reference: ImageTaskReference, name: string, origin: string, cookie: string) {
    const directUrl = rawReferenceRequestUrlCandidates(reference).find((value) => isExternalPublicMediaUrl(value));
    if (directUrl) return directUrl;
    const source = rawReferenceRequestUrlCandidates(reference)[0] || reference.id || name;
    const cacheKey = `${task.config.channelId || task.config.baseUrl}\0${source}`;
    const cached = runningHubUploadCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.url;
    const active = runningHubUploads.get(cacheKey);
    if (active) return active;
    const upload = uploadRunningHubImage(task, reference, name, origin, cookie).then((url) => {
        runningHubUploadCache.set(cacheKey, { url, expiresAt: runningHubUploadExpiry(url) });
        return url;
    });
    runningHubUploads.set(cacheKey, upload);
    try {
        return await upload;
    } finally {
        runningHubUploads.delete(cacheKey);
    }
}

async function uploadRunningHubImage(task: ImageTask, reference: ImageTaskReference, name: string, origin: string, cookie: string) {
    const form = new FormData();
    form.set("file", await imageReferenceToFile(reference, name, origin, cookie));
    const response = await taskFetch(task.config, taskUrl(task.config, "/openapi/v2/media/upload/binary", origin), {
        method: "POST",
        headers: taskHeaders(task.config, cookie),
        body: form,
        cache: "no-store",
    });
    if (!response.ok) throw new GenerationSubmissionSafeFailure(await readFetchError(response, "RunningHub 参考图上传失败"));
    const payload = (await response.json().catch(() => null)) as { message?: string; msg?: string; data?: { download_url?: string; downloadUrl?: string } } | null;
    const downloadUrl = payload?.data?.download_url || payload?.data?.downloadUrl || "";
    if (!isExternalPublicMediaUrl(downloadUrl)) throw new GenerationSubmissionSafeFailure(payload?.message || payload?.msg || "RunningHub 参考图上传未返回可用地址");
    return downloadUrl;
}

function runningHubUploadExpiry(url: string) {
    try {
        const value = new URL(url).searchParams.get("q-key-time")?.split(";")[1];
        const expiresAt = Number(value) * 1000;
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) return expiresAt;
    } catch {
        // The official upload URL remains valid for one day when no signed expiry is exposed.
    }
    return Date.now() + RUNNINGHUB_UPLOAD_TTL_MS;
}

export function clearRunningHubImageUploadCache() {
    runningHubUploadCache.clear();
    runningHubUploads.clear();
}

export function resolveDeclarativeImageSize(config: Pick<ImageTask["config"], "quality" | "size" | "advancedConfig">) {
    const size = resolveRequestSize(config.quality, config.size || "auto") || config.size || "";
    return !size || size.toLowerCase() === "auto" ? (config.advancedConfig?.protocol === "stable-diffusion" ? "1024x1024" : "") : size;
}

export async function pollCustomImageTask(task: ImageTask, taskId: string, requestUrl: string, cookie: string, singleStep = false) {
    const config = task.config;
    let lastError = "";
    for (let attempt = 0; attempt < (singleStep ? 1 : imageTaskPollAttempts(config)); attempt += 1) {
        for (const url of imageTaskPollUrls(config, requestUrl, taskId)) {
            const response = await taskFetch(config, url, { headers: taskHeaders(config, cookie), cache: "no-store" });
            if (!response.ok) {
                lastError = await readFetchError(response, "自定义图片任务查询失败");
                continue;
            }
            const data = (await response.json().catch(() => null)) as ImageApiResponse | null;
            if (!data) throw new ImageUpstreamTerminalError("自定义图片任务查询失败");
            if (isProviderBusinessError(data)) {
                const error = readProviderError(data) || "自定义图片任务查询失败";
                if (isTransientRunningHubQueryError(config.advancedConfig?.protocol, error)) {
                    lastError = "";
                    break;
                }
                throw new ImageUpstreamTerminalError(error);
            }
            const result = configuredImageResult(data, response.headers.get("x-vozeb-pro-upstream-url") || url, task);
            if (result) return result;
            const status = readProviderString(data, config.advancedConfig?.statusField, STATUS_KEYS).toLowerCase();
            if (!isPendingImageStatus(status)) throw new ImageUpstreamTerminalError(readProviderError(data) || "自定义图片任务完成但没有返回图片");
            lastError = "";
            break;
        }
        if (lastError) throw new Error(lastError);
        if (!singleStep) await new Promise((resolve) => setTimeout(resolve, IMAGE_TASK_POLL_INTERVAL_MS));
    }
    if (singleStep) return { dataUrl: "", pending: { id: taskId, mediaBaseUrl: requestUrl, pollBaseUrl: requestUrl } };
    throw new Error("自定义图片任务生成超时");
}

function isTransientRunningHubQueryError(protocol: string | undefined, message: string) {
    return protocol === "runninghub" && /TOKEN_INVALID/i.test(message);
}

function configuredImageResult(data: ImageApiResponse, baseUrl: string, task: ImageTask): ImageTaskResult | null {
    const value = readProviderString(data, task.config.advancedConfig?.resultField, []);
    return (value ? findImageResult(value, baseUrl, task.config) : null) || findImageResult(data, baseUrl, task.config);
}

const STATUS_KEYS = ["status", "state", "task_status", "taskStatus"];
