import { createHash } from "node:crypto";

import { fetchSafeOutbound } from "@/lib/server/safe-outbound-fetch";

const inFlight = new Map<string, Promise<string>>();

export async function ensureComfyUiReference(input: { baseUrl: string; bytes: ArrayBuffer | Buffer; mimeType: string; extension: string }) {
    const bytes = new Uint8Array(input.bytes.byteLength);
    bytes.set(input.bytes instanceof ArrayBuffer ? new Uint8Array(input.bytes) : input.bytes);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const name = `vozeb-${hash}${input.extension}`;
    const key = `${input.baseUrl}|${name}`;
    const current = inFlight.get(key);
    if (current) return current;
    const pending = checkAndUpload({ ...input, bytes }, name);
    inFlight.set(key, pending);
    try {
        return await pending;
    } finally {
        if (inFlight.get(key) === pending) inFlight.delete(key);
    }
}

async function checkAndUpload(input: { baseUrl: string; bytes: Uint8Array<ArrayBuffer>; mimeType: string }, name: string) {
    const probe = await fetchSafeOutbound(`${input.baseUrl}/view?${new URLSearchParams({ filename: name, type: "input" })}`, {
        method: "HEAD", cache: "no-store", signal: AbortSignal.timeout(30_000),
    });
    if (probe.ok) return name;
    if (probe.status !== 404) throw new Error(`ComfyUI 素材检查失败：${probe.status}`);

    const form = new FormData();
    form.append("image", new Blob([input.bytes], { type: input.mimeType }), name);
    form.append("overwrite", "true");
    const response = await fetchSafeOutbound(`${input.baseUrl}/upload/image`, { method: "POST", body: form, signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`ComfyUI 上传失败：${response.status}`);
    const result = (await response.json()) as { name?: string };
    if (result.name !== name) throw new Error("ComfyUI 上传文件名不匹配");
    return name;
}
