import { getCurrentUser } from "@/lib/auth/session";
import { getInstallStatus } from "@/lib/server/install-status";
import { isPersonalMode } from "@/lib/server/personal-mode";

export async function getAuthenticatedPageAccess() {
    try {
        const user = await getCurrentUser();
        if (user) return { user, install: isPersonalMode() ? { database: { healthy: true }, firstAdminRequired: false } : null };
    } catch {}
    const install = await getInstallStatus();
    return { user: null, install };
}
