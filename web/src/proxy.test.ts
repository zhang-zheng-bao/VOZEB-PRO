import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "./proxy";

describe("application proxy security", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("ignores spoofed forwarded origins unless a trusted proxy is configured", () => {
        const request = writeRequest({
            origin: "https://public.example.com",
            "x-forwarded-host": "public.example.com",
            "x-forwarded-proto": "https",
        });

        expect(proxy(request).status).toBe(403);
        vi.stubEnv("VOZEB_PRO_TRUSTED_PROXY_HOPS", "1");
        expect(proxy(request).status).toBe(200);
    });

    it("accepts equivalent loopback hostnames on the same port in personal mode", () => {
        vi.stubEnv("VOZEB_PRO_PERSONAL_MODE", "true");
        const request = new NextRequest("http://localhost:3001/api/admin/models", {
            method: "POST",
            headers: { origin: "http://127.0.0.1:3001", referer: "http://127.0.0.1:3001/admin?section=channels" },
        });

        expect(proxy(request).status).toBe(200);
    });

    it("trusts the browser's same-origin fetch metadata in personal mode", () => {
        vi.stubEnv("VOZEB_PRO_PERSONAL_MODE", "true");
        const request = new NextRequest("http://app.internal/api/admin/models", {
            method: "POST",
            headers: {
                origin: "http://127.0.0.1:3001",
                referer: "http://127.0.0.1:3001/admin?section=channels",
                "sec-fetch-site": "same-origin",
            },
        });

        expect(proxy(request).status).toBe(200);
    });

    it("does not trust same-origin fetch metadata outside personal mode", () => {
        const request = new NextRequest("http://app.internal/api/admin/models", {
            method: "POST",
            headers: { origin: "http://127.0.0.1:3001", "sec-fetch-site": "same-origin" },
        });

        expect(proxy(request).status).toBe(403);
    });

    it("still rejects loopback requests from a different port", () => {
        vi.stubEnv("VOZEB_PRO_PERSONAL_MODE", "true");
        vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3001");
        const request = new NextRequest("http://localhost:3001/api/admin/models", {
            method: "POST",
            headers: { origin: "http://127.0.0.1:3000" },
        });

        expect(proxy(request).status).toBe(403);
    });

    it("trusts the configured loopback origin when the server derives a different host", () => {
        vi.stubEnv("VOZEB_PRO_PERSONAL_MODE", "true");
        vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://127.0.0.1:3001");
        const request = new NextRequest("http://app.internal/api/admin/models", {
            method: "POST",
            headers: { origin: "http://127.0.0.1:3001", referer: "http://127.0.0.1:3001/admin?section=channels" },
        });

        expect(proxy(request).status).toBe(200);
    });

    it("uses a per-request script nonce and restricts production connections", () => {
        vi.stubEnv("NODE_ENV", "production");

        const policy = proxy(new NextRequest("https://app.example.com/create")).headers.get("content-security-policy") || "";

        expect(policy).toMatch(/script-src 'self' 'nonce-[a-f0-9]+' 'strict-dynamic'/);
        expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
        expect(policy).toContain("connect-src 'self' https:");
        expect(policy).not.toMatch(/connect-src[^;]*http:/);
        expect(policy).toContain("upgrade-insecure-requests");
    });
});

function writeRequest(headers: Record<string, string>) {
    return new NextRequest("http://app.internal/api/auth/login", { method: "POST", headers });
}
