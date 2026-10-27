import { after, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { basename, resolve, sep } from "node:path";
import { readJsonBody } from "@/lib/auth/request";
import { getCurrentUser } from "@/lib/auth/session";
import { getAuthSettings, isAuthInputError, refundUserPoints } from "@/lib/auth/store";
import { generationModelId, toSystemGenerationChannel } from "@/lib/server/generation-channel";
import { finishGenerationAttempt, startGenerationAttempt, type GenerationAttempt } from "@/lib/server/generation-attempt";
import { fetchInternalApi, resolveInternalOrigin } from "@/lib/server/internal-origin";
import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";
import { resolveLogicalModelCandidates } from "@/lib/server/logical-model-router";
import { assertReferenceCapabilities, assertReferenceUrls, assertVideoReferenceRoles, buildVideoProviderRequest, isProviderBusinessError, readProviderError, readProviderString, resolvedProviderCreatePaths } from "@/lib/server/provider-task-config";
import { buildGlobalAiOpcVideoRequest, resolveGlobalAiOpcPreset } from "@/lib/globalaiopc-catalog";
import { createVideoTask, transitionVideoTask, updateVideoTask, type VideoTask } from "@/lib/server/video-task-store";
import { toSafeGenerationErrorMessage } from "@/lib/server/generation-errors";
import { getStoredGenerationTaskByRequest, linkStoredGenerationTask, withGenerationConcurrencyLimit, type GenerationTaskContext } from "@/lib/server/generation-task-store";
import { normalizeVideoAspectRatio, resolveUpstreamVideoDuration, resolveVideoDuration, resolveVideoGenerationParameters, withVideoReferenceFidelity } from "@/lib/server/video-task-config";
import { parseImageDimensions } from "@/lib/image-size";
import { signReferenceAssetInputUrl } from "@/lib/server/reference-asset-access";
import { assertCapabilityConstraints } from "@/lib/server/capability-constraints";
import { checkGenerationRateLimit, rateLimitHeaders } from "@/lib/server/security";
import { resolveModelRequestTimeoutMs } from "@/lib/server/model-request-policy";
import { mediaTaskSource } from "@/lib/media-management-contract";
import { runGenerationTaskRecoveryBatch } from "@/lib/server/generation-task-recovery-service";
import { scheduleGenerationTask } from "@/lib/server/generation-task-scheduler";
import { VIDEO_PROVIDER_MEDIA_KEYS, parseVideoProviderJson, readVideoProviderHttpError, readVideoProviderId, readVideoProviderUrl } from "@/lib/server/video-provider-response";
import { buildSeedanceSpecialRequest } from "@/lib/seedance-special";
import { assertVozebRecommendedVideoReferences, buildVozebRecommendedVideoRequest } from "@/lib/vozeb-recommended-video";
import { assertGeminiVideoReferences, buildGeminiVideoRequest, geminiVideoCreatePath, normalizeGeminiVideoDuration, parseGeminiVideoCreateResponse } from "@/lib/server/gemini-video-provider";
import { systemAiBillingHeaders } from "@/lib/server/system-ai-billing";
import { maintenanceWorkerContextHeaders, requestRuntimeCredential } from "@/lib/server/maintenance-auth";
import { resolvePublicRequestOrigin } from "@/lib/server/public-request-origin";
import { writeVideoGenerationLog } from "@/lib/server/video-task-log";
import { GENERATION_MEDIA_ROOT, REFERENCE_MEDIA_ROOT } from "@/lib/server/local-media-storage";
import { getLocalMediaRegistration } from "@/lib/server/local-media-registry";
import { buildOpenAiVideoFormData } from "./video-task-openai";
import { normalizeVideoGenerationReferences, regularVideoReferences, videoFrameReferences, type VideoGenerationReference } from "@/lib/video-reference-contract";
import { assertYumengVideoReferences, buildYumengVideoRequest } from "@/lib/yumeng-model-center";
import { runningHubOpenApiCreatePathAlias } from "@/lib/runninghub-openapi-alias";
import { ensureComfyUiReference } from "@/lib/server/comfyui-reference-upload";

const CREATE_PATHS = ["/video/generations", "/videos/generations", "/videos/videos", "/videos"];
type CreateVideoTaskBody = { config?: Record<string, unknown>; prompt?: string; references?: VideoGenerationReference[]; source?: string; context?: GenerationTaskContext };

export async function POST(request: Request) {
    const user = await getCurrentUser(request);
    if (!user) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const headerRequestId = clean(request.headers.get("x-vozeb-pro-client-request-id"));
    const headerAttemptNo = positiveAttemptNo(request.headers.get("x-vozeb-pro-attempt-no"));
    if (headerRequestId) {
        const existing = await getStoredGenerationTaskByRequest<VideoTask>("video", user.id, headerRequestId, headerAttemptNo);
        if (existing) return NextResponse.json({ task: publicTask(existing) });
    }
    const rate = await checkGenerationRateLimit(user.id, request, "video");
    if (!rate.allowed) return NextResponse.json({ error: "视频生成请求过于频繁，请稍后重试" }, { status: 429, headers: rateLimitHeaders(rate) });
    let body: CreateVideoTaskBody;
    try {
        body = await readJsonBody(request);
    } catch (error) {
        if (isAuthInputError(error)) return NextResponse.json({ error: error.message }, { status: error.status });
        throw error;
    }
    if (!headerRequestId && body.context?.clientRequestId) {
        const existing = await getStoredGenerationTaskByRequest<VideoTask>("video", user.id, body.context.clientRequestId, body.context.attemptNo);
        if (existing) return NextResponse.json({ task: publicTask(existing) });
    }
    if (headerRequestId) body.context = { ...(body.context || {}), clientRequestId: headerRequestId, ...(headerAttemptNo ? { attemptNo: headerAttemptNo } : {}) };
    const settings = await getAuthSettings();
    const response = await withGenerationConcurrencyLimit(user.id, "video", 30 * 60_000, settings.generationConcurrency.video, async () => {
        const requestedModel = typeof body.config?.model === "string" && body.config.model.trim() ? body.config.model : settings.defaultModels.videoModel;
        const unavailableReason = unavailableRunningHubVideoModelReason(requestedModel);
        if (unavailableReason) return NextResponse.json({ error: unavailableReason }, { status: 400 });
        const channels = resolveLogicalModelCandidates(settings, "video", requestedModel).map(toSystemGenerationChannel);
        const prompt = String(body.prompt || "").trim();
        if (!channels.length || !prompt) return NextResponse.json({ error: "视频任务参数不完整或渠道不支持" }, { status: 400 });
        const publicOrigin = requestPublicOrigin(request);
        let references: VideoGenerationReference[];
        try {
            references = normalizeVideoGenerationReferences(body.references).map((reference) => ({ ...reference, url: signReferenceAssetInputUrl(reference.url, publicOrigin) }));
        } catch (error) {
            return NextResponse.json({ error: error instanceof Error ? error.message : "视频参考素材不正确" }, { status: 400 });
        }
        const providerPrompt = withVideoReferenceFidelity(prompt, references);
        const origin = resolveInternalOrigin(new URL(request.url).origin);
        const cookie = requestRuntimeCredential(request, user.id);
        const requestedParameters = resolveVideoGenerationParameters(body.config || {}, settings.generationDefaults);
        const billingRequestId = clean(body.context?.clientRequestId) || clean(request.headers.get("x-vozeb-pro-client-request-id")) || `video-request:${user.id}:${Date.now()}`;
        let lastError: unknown;
        let capabilityError: unknown;
        let attempts: GenerationAttempt[] = [];
        let localTask: VideoTask | undefined;
        for (let index = 0; index < channels.length; index += 1) {
            const channel = channels[index];
            const channelUnavailableReason = unavailableRunningHubVideoModelReason(channel.model);
            if (channelUnavailableReason) {
                capabilityError = new SafeCandidateFailure(channelUnavailableReason);
                continue;
            }
            const geminiVideo = isGeminiVideoChannel(channel);
            const parameters = {
                ...requestedParameters,
                videoSeconds: geminiVideo
                    ? normalizeGeminiVideoDuration(requestedParameters.videoSeconds)
                      : resolveUpstreamVideoDuration(requestedParameters.videoSeconds, settings.generationDefaults.videoSeconds, {
                          durationRange: channel.advancedConfig?.durationRange,
                          minDurationSeconds: Math.max(channel.capabilityProfile?.minDurationSeconds || 0, runningHubGrokMinimumDuration(channel.model)),
                          maxDurationSeconds: runningHubGrokMaximumDuration(channel.model) || channel.capabilityProfile?.maxDurationSeconds,
                      }),
            };
            try {
                assertCapabilityConstraints(channel.capabilityProfile, {
                    capability: "video",
                    referenceCount: references.filter((reference) => reference.type === "image").length,
                    durationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds,
                    aspectRatio: normalizeVideoAspectRatio(parameters.size),
                });
                const globalPreset = globalAiOpcVideoPreset(channel.advancedConfig, channel.model);
                if (geminiVideo) {
                    assertGeminiVideoReferences(references);
                } else {
                    assertReferenceCapabilities(
                        globalPreset
                            ? {
                                  ...channel.advancedConfig!,
                                  supportsReferenceImage: Boolean(globalPreset.supportsReferenceImage),
                                  supportsReferenceVideo: Boolean(globalPreset.supportsReferenceVideo),
                                  supportsReferenceAudio: Boolean(globalPreset.supportsReferenceAudio),
                              }
                            : channel.advancedConfig,
                        references,
                    );
                    if (channel.advancedConfig?.protocol !== "yumeng") assertVideoReferenceRoles(channel.advancedConfig, references, globalPreset?.videoReferenceRoles);
                    if (channel.advancedConfig?.protocol === "vozeb-recommended") assertVozebRecommendedVideoReferences(channel.model, references);
                    if (channel.advancedConfig?.protocol === "yumeng") assertYumengVideoReferences(channel.model, references);
                    assertReferenceUrls(channel.advancedConfig, references, Boolean(globalPreset));
                }
            } catch (error) {
                capabilityError = error;
                continue;
            }
            const started = startGenerationAttempt(attempts, { channelId: channel.channelId, model: generationModelId(channel), capability: "video" });
            attempts = started.attempts;
            const pendingUpstream = {
                id: "",
                provider: "generation" as const,
                model: channel.model,
                pollPath: geminiVideo ? geminiVideoCreatePath(channel.model) : channel.advancedConfig?.createPath || CREATE_PATHS[0],
            };
            if (!localTask) {
                localTask = await createVideoTask({
                    userId: user.id,
                    username: user.username,
                    displayName: user.displayName,
                    title: prompt.slice(0, 36) || "视频生成",
                    config: channel,
                    upstream: pendingUpstream,
                    requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds,
                    prompt,
                    source: mediaTaskSource(body.source, body.context, "video-task"),
                    attempts,
                    ...(body.context || {}),
                });
                await linkStoredGenerationTask("video", localTask.id, body.context || {});
            } else {
                await updateVideoTask(localTask.id, {
                    config: channel,
                    upstream: pendingUpstream,
                    requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds,
                    attempts,
                });
                localTask = { ...localTask, config: channel, upstream: pendingUpstream, requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds, attempts };
            }
            const submissionStartedAt = Date.now();
            await scheduleGenerationTask("video", localTask.id, {
                executionPhase: "submitting",
                channelId: channel.channelId,
                provider: channel.advancedConfig?.protocol || channel.apiFormat,
                queryPath: channel.advancedConfig?.queryPath,
                nextPollAt: submissionStartedAt + resolveModelRequestTimeoutMs(channel, "video"),
                lastUpstreamStatus: "submitting",
            });
            try {
                const upstream = await createUpstream(user.id, origin, cookie, channel, providerPrompt, parameters, references, settings.generationPointMultipliers, billingRequestId);
                await updateVideoTask(localTask.id, { config: channel, upstream, requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds, attempts });
                const task = { ...localTask, config: channel, upstream, requestedDurationSeconds: parameters.videoSeconds === -1 ? undefined : parameters.videoSeconds, attempts };
                const submittedAt = Date.now();
                await scheduleGenerationTask("video", task.id, {
                    executionPhase: "submitted",
                    upstreamTaskId: task.upstream.id,
                    channelId: channel.channelId,
                    provider: task.upstream.provider,
                    queryPath: task.upstream.queryPath || task.config.advancedConfig?.queryPath || task.upstream.pollPath,
                    submittedAt,
                    nextPollAt: submittedAt,
                    lastUpstreamStatus: "submitted",
                });
                after(() => runGenerationTaskRecoveryBatch({ origin, cookie, limit: 1, taskIds: [task.id] }));
                return NextResponse.json({ task: publicTask(task) });
            } catch (error) {
                lastError = error;
                attempts = finishGenerationAttempt(attempts, started.attempt.attemptNo, { status: "failed", error: toSafeGenerationErrorMessage(error, "视频任务创建失败") });
                await updateVideoTask(localTask.id, { attempts });
                if (error instanceof SafeCandidateFailure && index < channels.length - 1) continue;
                const message = toSafeGenerationErrorMessage(error, "视频任务创建失败");
                if (!(error instanceof SafeCandidateFailure)) {
                    await scheduleGenerationTask("video", localTask.id, { executionPhase: "needs_review", nextPollAt: undefined, lastUpstreamStatus: "submission_outcome_unknown" });
                    return NextResponse.json({ task: { ...publicTask({ ...localTask, attempts }), needsReview: true }, warning: `${message}；上游创建结果待确认，系统不会自动重复创建。` }, { status: 202 });
                }
                break;
            }
        }
        if (!lastError && capabilityError) return NextResponse.json({ error: capabilityError instanceof Error ? capabilityError.message : "当前渠道不支持参考素材" }, { status: 400 });
        if (localTask && lastError) {
            const message = toSafeGenerationErrorMessage(lastError, "视频任务创建失败");
            await writeVideoGenerationLog({ ...localTask, attempts }, "failed", message, lastError instanceof SafeCandidateFailure);
            await transitionVideoTask(localTask, { status: "error", error: message, retryable: lastError instanceof SafeCandidateFailure });
            await scheduleGenerationTask("video", localTask.id, { executionPhase: "completed", nextPollAt: undefined, lastUpstreamStatus: "create_failed" });
        }
        return NextResponse.json({ error: toSafeGenerationErrorMessage(lastError, "视频任务创建失败"), canRetry: lastError instanceof SafeCandidateFailure }, { status: 502 });
    });
    return response || NextResponse.json({ error: "当前用户视频任务已达到并发上限" }, { status: 429 });
}

export async function createUpstream(
    userId: string,
    origin: string,
    cookie: string,
    channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>,
    prompt: string,
    raw: Record<string, unknown>,
    references: VideoGenerationReference[],
    multipliers: Awaited<ReturnType<typeof getAuthSettings>>["generationPointMultipliers"],
    billingRequestId: string,
) {
    if (channel.advancedConfig?.protocol === "comfyui") {
        const localReferences = [];
        for (const reference of references) {
            const local = await localProviderReferenceFile(clean(reference.url));
            localReferences.push(local ? { type: reference.type, ...local } : { type: reference.type, url: clean(reference.url) });
        }
        return createComfyUiVideoUpstream({ channel, prompt, raw, references: localReferences });
    }
    let lastError = "";
    const providerReferences = await prepareProviderVideoReferences(channel, references);
    const providerRegularReferences = regularVideoReferences(providerReferences);
    const { firstFrame, lastFrame } = videoFrameReferences(references);
    const providerFrames = videoFrameReferences(providerReferences);
    const images = referenceUrls(providerRegularReferences, "image");
    const videos = referenceUrls(providerRegularReferences, "video");
    const audios = referenceUrls(providerRegularReferences, "audio");
    const firstFrameUrl = providerFrames.firstFrame?.url || firstFrame?.url || "";
    const lastFrameUrl = providerFrames.lastFrame?.url || lastFrame?.url || "";
    const requestImage = images[0] || firstFrameUrl || "";
    const requestImages = images.length ? images : firstFrameUrl ? [firstFrameUrl] : [];
    if (channel.advancedConfig?.protocol === "runninghub" && /image-to-video|i2v/i.test(channel.model) && !requestImage) {
        throw new SafeCandidateFailure("当前图生视频模型需要连接一张参考图片");
    }
    const dimensions = videoDimensions(raw.size, raw.vquality);
    const generateAudio = raw.videoGenerateAudio !== false && raw.videoGenerateAudio !== "false";
    if (isGeminiVideoChannel(channel)) {
        return createGeminiVideoUpstream({ userId, origin, cookie, channel, prompt, raw, references, generateAudio, multipliers, billingRequestId });
    }
    const values = {
        model: channel.model,
        prompt,
        duration: duration(raw.videoSeconds),
        seconds: duration(raw.videoSeconds),
        ratio: ratio(raw.size),
        aspect_ratio: ratio(raw.size),
        size: sizeValue(raw.size),
        resolution: resolution(raw.vquality),
        quality: resolution(raw.vquality),
        width: dimensions.width,
        height: dimensions.height,
        generate_audio: generateAudio,
        images: requestImages,
        videos,
        audios,
        image: requestImage,
        video: videos[0] || "",
        audio: audios[0] || "",
        references: providerReferences,
        content: videoReferenceContent(prompt, providerReferences),
        first_frame: firstFrameUrl,
        first_frame_url: firstFrameUrl,
        last_frame: lastFrameUrl,
        last_frame_url: lastFrameUrl,
    };
    const defaults = {
        model: channel.model,
        prompt,
        duration: values.duration,
        seconds: values.seconds,
        ratio: values.ratio,
        aspect_ratio: values.aspect_ratio,
        resolution: values.resolution,
        quality: values.quality,
        generate_audio: generateAudio,
        watermark: raw.videoWatermark === "true",
        ...(requestImage ? { image: requestImage } : {}),
        ...(requestImages.length ? { images: requestImages, image_urls: requestImages, reference_images: requestImages } : {}),
        ...(videos.length ? { video: videos[0], videos, reference_videos: videos } : {}),
        ...(audios.length ? { audio: audios[0], audios, reference_audios: audios } : {}),
        ...(providerReferences.length ? { ref_assets: providerReferences.map((item) => ({ type: item.type, url: item.url, role: item.role || "reference" })) } : {}),
        ...(firstFrameUrl ? { first_frame: firstFrameUrl, first_frame_url: firstFrameUrl } : {}),
        ...(lastFrameUrl ? { last_frame: lastFrameUrl, last_frame_url: lastFrameUrl } : {}),
    };
    const globalPreset = globalAiOpcVideoPreset(channel.advancedConfig, channel.model);
    const multipart = channel.advancedConfig?.requestTemplate?.trim().toLowerCase().startsWith("multipart/form-data") === true;
    const payload = multipart
        ? undefined
        : channel.advancedConfig?.protocol === "vozeb-recommended"
          ? buildVozebRecommendedVideoRequest({
                model: channel.model,
                prompt,
                duration: values.duration as number,
                aspectRatio: values.aspect_ratio as string,
                resolution: values.resolution as string,
                generateAudio,
                images,
                videos,
                audios,
            })
          : channel.advancedConfig?.protocol === "seedance-special"
            ? buildSeedanceSpecialRequest({
                  model: channel.model,
                  prompt,
                  duration: values.duration === -1 ? 5 : (values.duration as number),
                  ratio: values.ratio as string,
                  generateAudio,
                  references: providerReferences,
              })
            : channel.advancedConfig?.protocol === "yumeng"
              ? buildYumengVideoRequest({
                    model: channel.model,
                    prompt,
                    duration: values.duration as number,
                    aspectRatio: values.aspect_ratio as string,
                    resolution: values.resolution as string,
                    generateAudio,
                    watermark: raw.videoWatermark === "true",
                    images: requestImages,
                    videos,
                    audios,
                    firstFrame: firstFrameUrl || undefined,
                    lastFrame: lastFrameUrl || undefined,
                })
              : globalPreset
                ? buildGlobalAiOpcVideoRequest(globalPreset, {
                      model: channel.model,
                      prompt,
                      duration: values.duration as number,
                      ratio: values.ratio as string,
                      resolution: values.resolution as string,
                      images: requestImages.length ? requestImages : requestImage ? [requestImage] : [],
                      videos,
                      audios,
                      generateAudio,
                      firstFrame: firstFrameUrl || undefined,
                      lastFrame: lastFrameUrl || undefined,
                  })
                : buildVideoProviderRequest(channel.advancedConfig?.requestTemplate, defaults, values);
    const providerPayload = channel.advancedConfig?.protocol === "runninghub" ? normalizeRunningHubVideoPayload(payload, channel.model, generateAudio) : payload;
    const requestBody = multipart
        ? await buildOpenAiVideoFormData({ model: channel.model, prompt, seconds: values.seconds as number, width: dimensions.width, height: dimensions.height, imageUrls: firstFrameUrl ? [firstFrameUrl] : images, origin, cookie })
        : JSON.stringify(providerPayload);
    const imageToVideoPath = images.length || firstFrameUrl ? channel.advancedConfig?.imageToVideoPath?.trim() : "";
    const createPaths = (globalPreset ? [globalPreset.createPath] : imageToVideoPath ? [imageToVideoPath] : resolvedProviderCreatePaths(channel.advancedConfig, "video", CREATE_PATHS)).map((path) => normalizeRunningHubCreatePath(channel, path));
    for (const path of createPaths) {
        const response = await proxyFetch(origin, channel.baseUrl, path, cookie, {
            method: "POST",
            headers: {
                ...(multipart ? {} : { "Content-Type": "application/json" }),
                "Idempotency-Key": billingRequestId,
                "X-Client-Request-Id": billingRequestId,
                ...systemAiBillingHeaders(generationModelId(channel), `video-request:${billingRequestId}`, channel.model),
            },
            body: requestBody,
            signal: AbortSignal.timeout(resolveModelRequestTimeoutMs(channel, "video")),
        });
        const text = await response.text();
        if (!response.ok) {
            lastError = readVideoProviderHttpError(text, response.status);
            if (!SAFE_CREATE_FAILURE_STATUSES.has(response.status)) throw new Error(lastError);
            continue;
        }
        let data: unknown;
        try {
            data = parseVideoProviderJson(text);
        } catch (error) {
            const pointsCost = billedPointsCost(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost !== undefined && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw error instanceof Error ? error : new Error("视频接口返回了无效 JSON");
        }
        const providerError = readProviderError(data);
        if (isProviderBusinessError(data)) {
            const pointsCost = billedPointsCost(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost !== undefined && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            throw new SafeCandidateFailure(providerError || "视频接口请求失败");
        }
        const resultUrl = readVideoProviderUrl(data, channel.advancedConfig?.resultField);
        const id = readVideoProviderId(data) || (resultUrl ? `direct:${Date.now()}` : "");
        if (!id) {
            const pointsCost = billedPointsCost(response.headers.get("x-vozeb-pro-points-cost"));
            const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
            if (pointsCost !== undefined && pointsRecordId) await refundUserPoints(userId, generationModelId(channel), pointsCost, "video", videoUnits(raw, multipliers), undefined, pointsRecordId);
            if (providerError) throw new SafeCandidateFailure(providerError);
            throw new Error("视频接口没有返回任务 ID");
        }
        return {
            id,
            provider: "generation" as const,
            model: channel.model,
            pollPath: path,
            queryPath: undefined,
            resultUrl: resultUrl || undefined,
            pointsCost: billedPointsCost(response.headers.get("x-vozeb-pro-points-cost")),
            pointsUnits: videoUnits(raw, multipliers),
            pointsRecordId: response.headers.get("x-vozeb-pro-points-record-id") || undefined,
        };
    }
    throw new SafeCandidateFailure(lastError || "没有可用的视频创建接口");
}

async function createGeminiVideoUpstream(input: {
    userId: string;
    origin: string;
    cookie: string;
    channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>;
    prompt: string;
    raw: Record<string, unknown>;
    references: VideoGenerationReference[];
    generateAudio: boolean;
    multipliers: Awaited<ReturnType<typeof getAuthSettings>>["generationPointMultipliers"];
    billingRequestId: string;
}) {
    const payload = await buildGeminiVideoRequest({
        prompt: input.prompt,
        durationSeconds: input.raw.videoSeconds,
        aspectRatio: input.raw.size,
        resolution: input.raw.vquality,
        generateAudio: input.generateAudio,
        references: input.references,
        origin: input.origin,
        cookie: input.cookie,
    });
    const path = geminiVideoCreatePath(input.channel.model);
    const response = await proxyFetch(input.origin, input.channel.baseUrl, path, input.cookie, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": input.billingRequestId,
            "X-Client-Request-Id": input.billingRequestId,
            ...systemAiBillingHeaders(generationModelId(input.channel), `video-request:${input.billingRequestId}`, input.channel.model),
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(resolveModelRequestTimeoutMs(input.channel, "video")),
    });
    const text = await response.text();
    if (!response.ok) {
        const message = readVideoProviderHttpError(text, response.status);
        if (SAFE_CREATE_FAILURE_STATUSES.has(response.status)) throw new SafeCandidateFailure(message);
        throw new Error(message);
    }
    let data: unknown;
    try {
        data = parseVideoProviderJson(text);
    } catch (error) {
        throw error instanceof Error ? error : new Error("Gemini Veo 返回了无效 JSON");
    }
    const created = parseGeminiVideoCreateResponse(data, input.channel.model);
    const pointsCost = billedPointsCost(response.headers.get("x-vozeb-pro-points-cost"));
    const pointsRecordId = response.headers.get("x-vozeb-pro-points-record-id") || undefined;
    if (created.error) {
        if (pointsCost !== undefined && pointsRecordId) {
            await refundUserPoints(input.userId, generationModelId(input.channel), pointsCost, "video", videoUnits(input.raw, input.multipliers), undefined, pointsRecordId);
        }
        throw new SafeCandidateFailure(created.error);
    }
    if (!created.id) throw new Error("Gemini Veo 没有返回 operation ID");
    return {
        id: created.id,
        provider: "generation" as const,
        model: input.channel.model,
        pollPath: path,
        queryPath: created.queryPath || undefined,
        resultUrl: created.resultUrl || undefined,
        pointsCost,
        pointsUnits: videoUnits(input.raw, input.multipliers),
        pointsRecordId,
    };
}

function globalAiOpcVideoPreset(config: NonNullable<ReturnType<typeof toSystemGenerationChannel>>["advancedConfig"], model: string) {
    const preset = resolveGlobalAiOpcPreset(config, model);
    return preset?.capability === "video" ? preset : undefined;
}

function isGeminiVideoChannel(channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>) {
    return channel.apiFormat === "gemini" && channel.advancedConfig?.protocol !== "globalaiopc";
}

async function createComfyUiVideoUpstream(input: {
    channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>;
    prompt: string;
    raw: Record<string, unknown>;
    references: Array<{ type: "image" | "video" | "audio"; filePath?: string; fileName?: string; mimeType?: string; url?: string }>;
}) {
    const { buildComfyUiVideoRequest, comfyUiReferenceMediaType } = await import("@/lib/server/comfyui-video-provider");
    const baseUrl = input.channel.providerBaseUrl || input.channel.baseUrl.replace(/^\/api\/ai\/system\/[^/]+\/?/, "http://127.0.0.1:8188");
    await assertComfyUiReachable(baseUrl);
    const uploaded: Array<{ type: "image" | "video" | "audio"; name: string }> = [];
    for (let index = 0; index < input.references.length; index += 1) {
        const reference = input.references[index];
        const media = await comfyUiUploadMedia(reference, index);
        const mediaType = comfyUiReferenceMediaType(media.mimeType);
        if (!mediaType) throw new Error(`ComfyUI 不支持 ${media.mimeType} 类型的参考素材`);
        if (mediaType !== reference.type) throw new Error(`参考素材类型不匹配：${reference.type} vs ${mediaType}`);
        const name = await ensureComfyUiReference({ baseUrl, bytes: media.bytes, mimeType: media.mimeType, extension: mediaExtension(media.mimeType, mediaType) });
        uploaded.push({ type: mediaType, name });
    }
    const { graph } = buildComfyUiVideoRequest({ config: input.channel.advancedConfig, prompt: input.prompt, raw: input.raw, references: uploaded });
    const response = await fetchSafeOutbound(`${baseUrl}/prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: graph }),
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`ComfyUI 提交失败：${response.status}`);
    const result = (await response.json()) as { prompt_id?: string };
    if (!result.prompt_id) throw new Error("ComfyUI 未返回任务 ID");
    return { id: `prompt:${result.prompt_id}`, provider: "generation" as const, model: input.channel.model, pollPath: "/prompt", queryPath: `/history/${result.prompt_id}` };
}

async function assertComfyUiReachable(baseUrl: string) {
    try {
        const response = await fetchSafeOutbound(`${baseUrl}/system_stats`, { cache: "no-store", signal: AbortSignal.timeout(5_000) });
        if (!response.ok) throw new SafeCandidateFailure(`ComfyUI 服务器不可用（${response.status}）`);
    } catch (error) {
        if (error instanceof SafeCandidateFailure) throw error;
        throw new SafeCandidateFailure("ComfyUI 服务器离线，请启动服务器或恢复连接后重试。");
    }
}

async function comfyUiUploadMedia(reference: { type: "image" | "video" | "audio"; filePath?: string; fileName?: string; mimeType?: string; url?: string }, index: number) {
    if (reference.filePath) {
        const bytes = await readFile(reference.filePath);
        return { bytes, mimeType: reference.mimeType || mediaMimeType(reference.filePath), fileName: reference.fileName || basename(reference.filePath) };
    }
    const url = clean(reference.url);
    if (!url) throw new SafeCandidateFailure("ComfyUI 参考素材地址无效");
    const response = await fetchSafeOutbound(url, { cache: "no-store", signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`ComfyUI 参考素材读取失败：${response.status}`);
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() || fallbackComfyUiMimeType(reference.type);
    return { bytes: await response.arrayBuffer(), mimeType, fileName: reference.fileName || `reference-${index + 1}${mediaExtension(mimeType, reference.type)}` };
}

function proxyFetch(origin: string, baseUrl: string, path: string, cookie: string, init: RequestInit) {
    const headers = new Headers(init.headers);
    const workerHeaders = maintenanceWorkerContextHeaders(cookie);
    if (workerHeaders) Object.entries(workerHeaders).forEach(([key, value]) => headers.set(key, value));
    else if (cookie) headers.set("cookie", cookie);
    return fetchInternalApi(`${origin}${baseUrl.replace(/\/+$/, "")}${path.startsWith("/") ? path : `/${path}`}`, { ...init, headers });
}
function publicTask(task: VideoTask) {
    return { id: task.id, status: task.status, model: generationModelId(task.config), upstreamId: task.upstream.id || undefined, durationSeconds: task.requestedDurationSeconds, canRetry: task.retryable === true };
}
function duration(value: unknown) {
    return resolveVideoDuration(value, 5);
}
function ratio(value: unknown) {
    return normalizeVideoAspectRatio(value);
}
function resolution(value: unknown) {
    const text = clean(value).replace(/p$/i, "");
    return text === "480" || text === "1080" ? `${text}p` : "720p";
}
function videoDimensions(size: unknown, quality: unknown) {
    const exact = parseImageDimensions(String(size || ""));
    if (exact) return exact;
    const [x, y] = ratio(size).split(":").map(Number);
    const edge = Number(resolution(quality).replace("p", "")) || 720;
    if (!x || !y) return { width: 1280, height: 720 };
    return x >= y ? { width: Math.round((edge * x) / y), height: edge } : { width: edge, height: Math.round((edge * y) / x) };
}
function sizeValue(value: unknown) {
    const text = clean(value);
    return parseImageDimensions(text) ? text.replace(/\s+/g, "") : ratio(value);
}
function billedPointsCost(value: unknown) {
    if (value === null || value === undefined || value === "") return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function videoUnits(raw: Record<string, unknown>, multipliers: Awaited<ReturnType<typeof getAuthSettings>>["generationPointMultipliers"]) {
    const quality = clean(raw.vquality).replace(/p$/i, "") || "720";
    const seconds = String(duration(raw.videoSeconds));
    return (multipliers.videoQuality[quality] || 1) * (multipliers.videoSeconds[seconds] || 1);
}
function clean(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}
function positiveAttemptNo(value: unknown) {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function unique(values: string[]) {
    return Array.from(new Set(values.filter(Boolean)));
}
function referenceUrls(items: readonly VideoGenerationReference[], type: VideoGenerationReference["type"]) {
    return unique(items.filter((item) => item.type === type).map((item) => clean(item.url)));
}

function videoReferenceContent(prompt: string, references: readonly VideoGenerationReference[]) {
    return [
        { type: "text", text: prompt },
        ...references.map((reference) =>
            reference.type === "image"
                ? { type: "image_url", role: reference.role === "first_frame" || reference.role === "last_frame" ? reference.role : "reference_image", image_url: { url: reference.url } }
                : reference.type === "video"
                  ? { type: "video_url", role: "reference_video", video_url: { url: reference.url } }
                  : { type: "audio_url", role: "reference_audio", audio_url: { url: reference.url } },
        ),
    ];
}
function requestPublicOrigin(request: Request) {
    return resolvePublicRequestOrigin(request);
}

function normalizeRunningHubVideoPayload(payload: Record<string, unknown> | undefined, model: string, generateAudio: boolean) {
    if (!payload) return payload;
    const next = { ...payload };
    if (/^vidu[-/]image[-/]to[-/]video[-/]q\d/i.test(model) && typeof next.imageUrl === "string" && next.imageUrl.trim()) {
        return {
            prompt: next.prompt,
            imageUrl: next.imageUrl,
            duration: String(next.duration || next.seconds || "5"),
            resolution: next.resolution || "720p",
            movementAmplitude: next.movementAmplitude || "auto",
            bgm: generateAudio,
        };
    }
    if (/image-to-video|i2v/i.test(model) && typeof next.imageUrl === "string" && next.imageUrl.trim()) {
        delete next.imageUrls;
        delete next.images;
        delete next.image_urls;
        delete next.reference_images;
    }
    return next;
}

function normalizeRunningHubCreatePath(channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>, path: string) {
    if (channel.advancedConfig?.protocol !== "runninghub") return path;
    const model = channel.model.toLowerCase();
    const aliased = runningHubOpenApiCreatePathAlias(model);
    if (aliased) return aliased;
    const veo = model.match(/^google\/(veo3\.1-(?:fast|lite|pro))\/(image-to-video|text-to-video|reference-to-video|start-end-to-video|video-extend)-(?:official-stable|channel-low-price)$/);
    if (veo) return `/openapi/v2/google/${veo[1]}/${veo[2]}`;
    const seedance = model.match(/^seedance-2\.5\/(image-to-video|text-to-video|multimodal-video)\s+token$/);
    if (seedance) return `/openapi/v2/bytedance/seedance-2.5-token/${seedance[1]}`;
    const globalSeedance = model.match(/^seedance-2\.0-global\/(image-to-video|text-to-video|multimodal-video)$/);
    if (globalSeedance) return `/openapi/v2/bytedance/seedance-2.0-global/${globalSeedance[1]}`;
    const miniSeedance = model.match(/^seedance-2\.0-mini\/(image-to-video|text-to-video|multimodal-video)$/);
    if (miniSeedance) return `/openapi/v2/rhart-video/sparkvideo-2.0-mini/${miniSeedance[1]}`;
    const seedanceFast = model.match(/^seedance2\.0 fast (image to video|text to video|multimodal video)$/);
    if (seedanceFast) return `/openapi/v2/rhart-video/sparkvideo-2.0-fast/${seedanceFast[1].replaceAll(" ", "-")}`;
    const seedanceStandard = model.match(/^seedance2\.0 (image to video|text to video|multimodal video)$/);
    if (seedanceStandard) return `/openapi/v2/rhart-video/sparkvideo-2.0/${seedanceStandard[1].replaceAll(" ", "-")}`;
    const klingDashed = model.match(/^(kling-(?:v2\.6|v3\.0)-(?:pro|std)|kling-v3-turbo-(?:pro|std)|kling-video-o3-4k|kling-video-o3-(?:pro|std)|kling-v3-4k)-(image-to-video|text-to-video|motion-control|reference-to-video|video-edit)$/);
    if (klingDashed) return `/openapi/v2/${klingDashed[1]}/${klingDashed[2]}`;
    if (model === "xai/grok-imagine-video-v1.5/reference-to-video-official-stable") return "/openapi/v2/rhart-video-g-official/reference-to-video-v1.5";
    if (model === "xai/grok-imagine-video/reference-to-video-official-stable") return "/openapi/v2/rhart-video-g-official/reference-to-video";
    if (model === "xai/grok-imagine-video-v1.5/image-to-video-official-stable") return "/openapi/v2/rhart-video-g-official/image-to-video-v1.5";
    if (model === "xai/grok-imagine/image-to-video-official-stable") return "/openapi/v2/rhart-video-g-official/image-to-video";
    if (model === "xai / grok-imagine-video-v1.5 / text-to-video-official-stable") return "/openapi/v2/rhart-video-g-official/text-to-video-v1.5";
    if (model === "xai/grok-imagine/text-to-video-official-stable") return "/openapi/v2/rhart-video-g-official/text-to-video";
    if (model === "xai/grok-imagine/text-to-video-channel-low-price-v1.5") return "/openapi/v2/rhart-video-g/text-to-video";
    if (model === "xai/grok-imagine/image-to-video-channel-low-price-v1.5") return "/openapi/v2/rhart-video-g/image-to-video";
    if (model === "xai/grok-imagine-video/video-extend-official-stable") return "/openapi/v2/rhart-video-g-official/video-extend";
    if (model === "xai/grok-imagine/edit-video-official-stable") return "/openapi/v2/rhart-video-g-official/edit-video";
    if (/^vidu-image-to-video-q\d/.test(model)) return `/openapi/v2/vidu/image-to-video-${model.match(/q\d-(?:turbo|pro(?:-fast)?)/)?.[0] || model.replace(/^vidu-image-to-video-/, "")}`;
    if (/^vidu-start-end-to-video-q\d/.test(model)) return `/openapi/v2/vidu/start-end-to-video-${model.match(/q\d-(?:turbo|pro(?:-fast)?)/)?.[0] || model.replace(/^vidu-start-end-to-video-/, "")}`;
    if (/^vidu-text-to-video-q\d/.test(model)) return `/openapi/v2/vidu/text-to-video-${model.match(/q\d-(?:turbo|pro(?:-fast)?)/)?.[0] || model.replace(/^vidu-text-to-video-/, "")}`;
    if (/^vidu-reference-to-video-q\d/.test(model)) return `/openapi/v2/vidu/reference-to-video-${model.match(/q\d(?:-[a-z]+)?/)?.[0] || model.replace(/^vidu-reference-to-video-/, "")}`;
    return path;
}

function runningHubGrokMinimumDuration(model: string) {
    const name = model.toLowerCase();
    return name.includes("grok-imagine-video") ? 6 : 0;
}

function runningHubGrokMaximumDuration(model: string) {
    const name = model.toLowerCase();
    return name.includes("grok-imagine-video") ? 15 : 0;
}

function unavailableRunningHubVideoModelReason(model: string) {
    const name = clean(model).toLowerCase();
    if (name === "xai/grok-imagine-video/reference-to-video-official-stable" || name === "rh-video-xai-grok-imagine-video-reference-to-video-official-stable-d29de666") {
        return "这个旧 Grok 全能参考模型已在 RunningHub CN 节点下线，请改用 Grok v1.5 全能参考。";
    }
    if (name === "vidu-image-to-video-q2-turbo" || name === "rh-video-vidu-image-to-video-q2-turbo-1f3cb21b") {
        return "Vidu Q2 Turbo 图生视频接口当前在 RunningHub 返回链接无效，请改用 Vidu Q2 Pro、Seedance 或 Kling 首帧模型。";
    }
    return "";
}

async function prepareProviderVideoReferences(channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>, references: VideoGenerationReference[]) {
    if (channel.advancedConfig?.protocol !== "runninghub" || !references.length) return references;
    const uploaded = new Map<string, string>();
    const next: VideoGenerationReference[] = [];
    for (const reference of references) {
        const source = clean(reference.url);
        const local = await localProviderReferenceFile(source);
        if (!local) {
            next.push(reference);
            continue;
        }
        const cacheKey = `${local.filePath}\0${local.mimeType}`;
        const uploadedUrl = uploaded.get(cacheKey) || (await uploadRunningHubReference(channel, local));
        uploaded.set(cacheKey, uploadedUrl);
        next.push({ ...reference, url: uploadedUrl });
    }
    return next;
}

async function localProviderReferenceFile(value: string): Promise<{ filePath: string; fileName: string; mimeType: string } | null> {
    const token = localReferenceToken(value);
    if (!token) return null;
    const candidates = [
        { scope: "reference" as const, root: REFERENCE_MEDIA_ROOT },
        { scope: "generation" as const, root: GENERATION_MEDIA_ROOT },
    ];
    for (const candidate of candidates) {
        const filePath = safeLocalMediaPath(candidate.root, token);
        if (!filePath) continue;
        const info = await stat(/*turbopackIgnore: true*/ filePath).catch(() => null);
        if (!info?.isFile() || info.size <= 0) continue;
        const registration = await getLocalMediaRegistration(token);
        const mimeType = registration?.scope === candidate.scope && registration.mimeType ? registration.mimeType : mediaMimeType(filePath);
        return { filePath, fileName: registration?.originalName || basename(filePath), mimeType };
    }
    return null;
}

function localReferenceToken(value: string) {
    const raw = clean(value);
    if (!raw) return "";
    try {
        const url = new URL(raw, "http://vozeb.local");
        const prefixes = ["/api/reference-assets/", "/api/generation-log-assets/"];
        for (const prefix of prefixes) {
            if (!url.pathname.startsWith(prefix)) continue;
            return url.pathname
                .slice(prefix.length)
                .split("/")
                .map((part) => decodeURIComponent(part))
                .join("/");
        }
    } catch {
        // Fall through to storage-key handling.
    }
    return /^(?:temporary|permanent)\//i.test(raw) ? raw.replace(/\\/g, "/").replace(/^\/+/, "") : "";
}

function safeLocalMediaPath(root: string, token: string) {
    if (!token || token.includes("\0")) return "";
    const normalizedRoot = resolve(root);
    const filePath = resolve(normalizedRoot, token);
    return filePath !== normalizedRoot && filePath.startsWith(`${normalizedRoot}${sep}`) ? filePath : "";
}

async function uploadRunningHubReference(channel: NonNullable<ReturnType<typeof toSystemGenerationChannel>>, local: { filePath: string; fileName: string; mimeType: string }) {
    const apiKey = clean(channel.providerApiKey);
    if (!apiKey) throw new Error("RunningHub 参考素材上传失败：系统通道缺少 API Key");
    const endpoint = runningHubOpenApiUrl(channel.providerBaseUrl || "https://www.runninghub.ai", "media/upload/binary");
    const bytes = await readFile(/*turbopackIgnore: true*/ local.filePath);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: local.mimeType || "application/octet-stream" }), local.fileName || basename(local.filePath));
    const response = await fetchSafeOutbound(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
        body: form,
        signal: AbortSignal.timeout(120_000),
    });
    const text = await response.text();
    let payload: unknown = {};
    try {
        payload = text ? parseVideoProviderJson(text) : {};
    } catch {
        payload = {};
    }
    if (!response.ok) throw new Error(readVideoProviderHttpError(text, response.status));
    const url = readRunningHubUploadUrl(payload);
    if (!url) throw new Error("RunningHub 上传参考素材后没有返回可用 URL");
    return url;
}

function runningHubOpenApiUrl(baseUrl: string, path: string) {
    const base = clean(baseUrl).replace(/\/+$/, "") || "https://www.runninghub.ai";
    const openApiBase = base.endsWith("/openapi/v2") ? base : `${base}/openapi/v2`;
    return `${openApiBase}/${path.replace(/^\/+/, "")}`;
}

function readRunningHubUploadUrl(payload: unknown): string {
    if (!payload || typeof payload !== "object") return "";
    const candidates = [payload, (payload as Record<string, unknown>).data].filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
    for (const item of candidates) {
        for (const key of ["download_url", "downloadUrl", "url", "fileUrl", "file_url"]) {
            const value = item[key];
            if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) return value.trim();
        }
    }
    return "";
}

function mediaMimeType(filePath: string) {
    const lower = filePath.toLowerCase();
    if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
    if (lower.endsWith(".webp")) return "image/webp";
    if (lower.endsWith(".gif")) return "image/gif";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".webm")) return "video/webm";
    if (lower.endsWith(".mov")) return "video/quicktime";
    if (lower.endsWith(".wav")) return "audio/wav";
    if (lower.endsWith(".ogg")) return "audio/ogg";
    if (lower.endsWith(".aac")) return "audio/aac";
    if (lower.endsWith(".flac")) return "audio/flac";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    return "application/octet-stream";
}

function fallbackComfyUiMimeType(type: "image" | "video" | "audio") {
    return type === "image" ? "image/png" : type === "video" ? "video/mp4" : "audio/mpeg";
}

function mediaExtension(mimeType: string, type: "image" | "video" | "audio") {
    const lower = mimeType.toLowerCase();
    if (lower.includes("jpeg")) return ".jpg";
    if (lower.includes("png")) return ".png";
    if (lower.includes("webp")) return ".webp";
    if (lower.includes("mp4")) return ".mp4";
    if (lower.includes("webm")) return ".webm";
    if (lower.includes("mpeg")) return type === "audio" ? ".mp3" : ".mpeg";
    if (lower.includes("wav")) return ".wav";
    return type === "image" ? ".png" : type === "video" ? ".mp4" : ".mp3";
}

function normalizePublicOrigin(value: string) {
    try {
        const url = new URL(value.trim());
        return url.protocol === "http:" || url.protocol === "https:" ? url.origin : "";
    } catch {
        return "";
    }
}
const MEDIA_KEYS = VIDEO_PROVIDER_MEDIA_KEYS;
const SAFE_CREATE_FAILURE_STATUSES = new Set([400, 401, 403, 404, 405, 413, 415, 422, 429]);

class SafeCandidateFailure extends Error {}
