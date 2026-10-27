"use client";

import { useEffect, useState } from "react";
import { App, Button, Input } from "antd";
import { Save, UserRound } from "lucide-react";

import { ProfileAvatarUploader } from "@/components/profile/profile-avatar-uploader";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";

export default function ProfilePage() {
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const setUser = useUserStore((state) => state.setUser);
    const [displayName, setDisplayName] = useState("");
    const [bio, setBio] = useState("");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!user) return;
        setDisplayName(user.displayName || user.username);
        setBio(user.bio || "");
    }, [user]);

    const saveProfile = async () => {
        if (saving) return;
        setSaving(true);
        try {
            const response = await fetch("/api/auth/profile", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ displayName, bio }),
            });
            const payload = (await response.json()) as { user?: LocalUser; error?: string };
            if (!response.ok || !payload.user) throw new Error(payload.error || "保存个人资料失败");
            setUser(payload.user);
            message.success("个人资料已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存个人资料失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <main className="profile-page-scroll h-full min-h-0 overflow-y-auto bg-background px-3 py-4 text-foreground sm:px-6 sm:py-6">
            <div className="mx-auto w-full max-w-3xl pb-[calc(2rem+env(safe-area-inset-bottom))]">
                <header className="mb-5">
                    <h1 className="text-xl font-semibold text-stone-950 sm:text-2xl dark:text-white">个人中心</h1>
                    <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">管理本机账户头像、昵称与个人资料。</p>
                </header>

                <section className="border-y border-border bg-card py-5 sm:rounded-lg sm:border sm:p-6">
                    <div className="flex items-center gap-4 border-b border-border pb-5">
                        <ProfileAvatarUploader />
                        <div className="min-w-0">
                            <div className="truncate text-base font-semibold text-stone-950 dark:text-white">{user?.displayName || user?.username || "本地用户"}</div>
                            <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">账号 ID：{user?.accountId || "--"}</div>
                        </div>
                    </div>

                    <div className="mt-5 grid gap-5 sm:grid-cols-2">
                        <label className="block space-y-2">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">显示昵称</span>
                            <Input value={displayName} maxLength={48} onChange={(event) => setDisplayName(event.target.value)} placeholder="请输入昵称" />
                        </label>
                        <div className="space-y-2">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">登录账号</span>
                            <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-stone-50 px-3 text-sm text-stone-600 dark:bg-stone-900 dark:text-stone-300">
                                <UserRound className="size-4 shrink-0" />
                                <span className="truncate">{user?.username || "本地用户"}</span>
                            </div>
                        </div>
                        <label className="block space-y-2 sm:col-span-2">
                            <span className="text-sm font-medium text-stone-700 dark:text-stone-200">个人简介</span>
                            <Input.TextArea value={bio} maxLength={240} showCount autoSize={{ minRows: 3, maxRows: 6 }} onChange={(event) => setBio(event.target.value)} placeholder="简单介绍一下自己" />
                        </label>
                    </div>

                    <div className="mt-6 flex justify-end">
                        <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={!displayName.trim()} onClick={() => void saveProfile()}>
                            保存资料
                        </Button>
                    </div>
                </section>
            </div>
        </main>
    );
}
