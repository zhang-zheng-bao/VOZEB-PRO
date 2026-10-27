import { redirect } from "next/navigation";

import { AdminDashboard } from "@/components/admin/admin-dashboard";
import { AdminReturnButton } from "@/components/admin/admin-return-button";
import { resolveAdminSection, resolveSettingsSection } from "@/components/admin/admin-sections";
import { AuthUserHydrator } from "@/components/auth/auth-user-hydrator";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { getFreshAuthSettings, getPublicUserSummary } from "@/lib/auth/store";
import { serializeAdminSettingsForUser } from "@/lib/server/admin-channel-config";
import { getAuthenticatedPageAccess } from "@/lib/server/page-access";

type SettingsPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function SettingsPage({ searchParams }: SettingsPageProps) {
    const params = searchParams ? await searchParams : {};
    const requestedSection = resolveSettingsSection(params.section);
    const access = await getAuthenticatedPageAccess();
    if (!access.user) {
        if (!access.install.database.healthy || access.install.firstAdminRequired) redirect("/install");
        redirect("/login?next=/settings");
    }
    const currentUser = access.user;
    if (currentUser.role !== "admin") redirect("/");
    const initialSection = resolveAdminSection(currentUser, requestedSection);
    if (!initialSection) redirect("/");

    const [settings, userSummary] = await Promise.all([getFreshAuthSettings(), getPublicUserSummary()]);

    return (
        <AuthUserHydrator
            user={{
                id: currentUser.id,
                accountId: currentUser.accountId,
                username: currentUser.username,
                email: currentUser.email,
                displayName: currentUser.displayName,
                bio: currentUser.bio,
                role: currentUser.role,
                adminPermissions: currentUser.adminPermissions,
                status: currentUser.status,
                planId: currentUser.planId,
                planName: currentUser.planName,
                hasActivePlan: currentUser.hasActivePlan,
                pointsBalance: currentUser.pointsBalance,
                mfaEnabled: currentUser.mfaEnabled,
            }}
        >
            <main className="admin-console-page app-scroll-page relative bg-white text-zinc-950 dark:bg-zinc-950 dark:text-zinc-100">
                <AdminDashboard
                    initialUsers={[]}
                    initialUserSummary={userSummary}
                    initialSettings={serializeAdminSettingsForUser(settings, currentUser)}
                    initialPromptCount={0}
                    currentUser={currentUser}
                    initialSection={initialSection}
                    headerActions={
                        <>
                            <AdminReturnButton />
                            <UserStatusActions initialUser={currentUser} />
                        </>
                    }
                />
            </main>
        </AuthUserHydrator>
    );
}
