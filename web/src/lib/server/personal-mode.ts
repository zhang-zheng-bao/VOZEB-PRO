import { ALL_ADMIN_PERMISSIONS } from "@/lib/admin-permissions";
import { DEFAULT_ENTITLEMENT_PLAN_ID, type PublicUser } from "@/lib/auth/store";

export function isPersonalMode() {
    return ["1", "true", "yes", "on"].includes(process.env.VOZEB_PRO_PERSONAL_MODE?.trim().toLowerCase() || "");
}

export function personalModeUser(): PublicUser {
    const now = new Date().toISOString();
    return {
        id: "local-personal-user",
        accountId: "LOCAL-0001",
        username: "local",
        email: "local@vozeb.local",
        displayName: "本地个人用户",
        bio: "本地单人模式",
        role: "admin",
        adminPermissions: [...ALL_ADMIN_PERMISSIONS],
        status: "active",
        planId: DEFAULT_ENTITLEMENT_PLAN_ID,
        planName: "本地个人版",
        hasActivePlan: true,
        pointsBalance: 999999,
        permanentPointsBalance: 999999,
        dailyPointsBalance: 0,
        dailyPointsExpiresAt: now,
        mfaEnabled: false,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
    };
}
