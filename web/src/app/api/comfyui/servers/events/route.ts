import { getCurrentUser } from "@/lib/auth/session";
import { isPersonalMode } from "@/lib/server/personal-mode";
import { comfyUiTunnelState, subscribeComfyUiTunnel } from "@/lib/server/comfyui-ssh-tunnel";

export const runtime = "nodejs";

export async function GET(request: Request) {
    const user = await getCurrentUser(request);
    if (!user || user.role !== "admin" || !isPersonalMode()) return new Response(null, { status: 403 });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
        start(controller) {
            const send = () => controller.enqueue(encoder.encode(`data: ${JSON.stringify(comfyUiTunnelState())}\n\n`));
            const unsubscribe = subscribeComfyUiTunnel(send);
            request.signal.addEventListener("abort", () => {
                unsubscribe();
                try { controller.close(); } catch { /* Already closed. */ }
            }, { once: true });
            send();
        },
    });
    return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
