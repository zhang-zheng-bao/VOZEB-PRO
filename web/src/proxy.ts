import { NextResponse, type NextRequest } from "next/server";
import { getTrustedProxyHops } from "@/lib/server/trusted-proxy";

export function proxy(request: NextRequest) {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const contentSecurityPolicy = buildContentSecurityPolicy(nonce);
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("content-security-policy", contentSecurityPolicy);

    if (!request.nextUrl.pathname.startsWith("/api/") || request.nextUrl.pathname.startsWith("/api/billing/webhooks/") || ["GET", "HEAD", "OPTIONS"].includes(request.method)) {
        return securedNextResponse(requestHeaders, contentSecurityPolicy);
    }

    const requestOrigin = publicRequestOrigin(request);
    const browserSameOrigin = personalModeEnabled() && request.headers.get("sec-fetch-site") === "same-origin";
    const origin = request.headers.get("origin");
    if (origin && !browserSameOrigin && !isAllowedRequestOrigin(origin, requestOrigin)) return blockedOriginResponse(request, origin, requestOrigin, contentSecurityPolicy);

    const referer = request.headers.get("referer");
    if (referer && !browserSameOrigin) {
        try {
            const refererOrigin = new URL(referer).origin;
            if (!isAllowedRequestOrigin(refererOrigin, requestOrigin)) return blockedOriginResponse(request, refererOrigin, requestOrigin, contentSecurityPolicy);
        } catch {
            return securedJsonResponse({ error: "请求来源无效" }, 403, contentSecurityPolicy);
        }
    }

    return securedNextResponse(requestHeaders, contentSecurityPolicy);
}

export const config = {
    matcher: "/((?!_next/static|_next/image|favicon.ico).*)",
};

function securedNextResponse(requestHeaders: Headers, contentSecurityPolicy: string) {
    const response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
}

function securedJsonResponse(body: unknown, status: number, contentSecurityPolicy: string) {
    const response = NextResponse.json(body, { status });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
    return response;
}

function blockedOriginResponse(request: NextRequest, source: string, target: string, contentSecurityPolicy: string) {
    if (personalModeEnabled()) console.warn("[request-origin] blocked", { source, target, secFetchSite: request.headers.get("sec-fetch-site") });
    return securedJsonResponse({ error: "跨站请求已被拦截" }, 403, contentSecurityPolicy);
}

function buildContentSecurityPolicy(nonce: string) {
    const isDev = process.env.NODE_ENV !== "production";
    return [
        "default-src 'self'",
        `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: https:",
        "media-src 'self' data: blob: https:",
        "font-src 'self' data: https:",
        `connect-src 'self' https:${isDev ? " http: ws: wss:" : ""}`,
        "worker-src 'self' blob:",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        ...(isDev ? [] : ["upgrade-insecure-requests"]),
    ].join("; ");
}

function publicRequestOrigin(request: NextRequest) {
    const trustForwarded = getTrustedProxyHops() > 0;
    const forwardedProto = trustForwarded ? request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() : "";
    const forwardedHost = trustForwarded ? request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() : "";
    const protocol = forwardedProto || request.nextUrl.protocol.replace(/:$/, "");
    const host = forwardedHost || request.headers.get("host") || request.nextUrl.host;
    try {
        const origin = new URL(`${protocol}://${host}`);
        return origin.protocol === "http:" || origin.protocol === "https:" ? origin.origin : request.nextUrl.origin;
    } catch {
        return request.nextUrl.origin;
    }
}

function isAllowedRequestOrigin(source: string, target: string) {
    if (source === target) return true;
    if (!personalModeEnabled()) return false;
    try {
        const sourceUrl = new URL(source);
        const targetUrl = new URL(target);
        const configuredUrl = configuredPersonalOrigin();
        if (configuredUrl && sourceUrl.origin === configuredUrl.origin) return true;
        return sourceUrl.protocol === targetUrl.protocol && sourceUrl.port === targetUrl.port && isLoopbackHost(sourceUrl.hostname) && isLoopbackHost(targetUrl.hostname);
    } catch {
        return false;
    }
}

function configuredPersonalOrigin() {
    try {
        const url = new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || "");
        return isLoopbackHost(url.hostname) ? url : null;
    } catch {
        return null;
    }
}

function personalModeEnabled() {
    return ["1", "true", "yes", "on"].includes(process.env.VOZEB_PRO_PERSONAL_MODE?.trim().toLowerCase() || "");
}

function isLoopbackHost(hostname: string) {
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}
