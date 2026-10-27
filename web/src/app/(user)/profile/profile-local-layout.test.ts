import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("local personal center", () => {
    it("keeps profile editing without loading commercial account data", async () => {
        const page = await readFile(resolve(process.cwd(), "src/app/(user)/profile/page.tsx"), "utf8");

        expect(page).toContain("<ProfileAvatarUploader />");
        expect(page).toContain("body: JSON.stringify({ displayName, bio })");
        expect(page).toContain("账号 ID：");
        expect(page).not.toContain("useProfileData");
        expect(page).not.toMatch(/套餐|积分|订单|优惠券|邀请|充值/);
    });
});
