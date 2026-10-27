import { resolve } from "node:path";
import sharp from "sharp";

import { describe, expect, it } from "vitest";

import { DEFAULT_SITE_SETTINGS } from "@/lib/auth/store";

describe("default 万创核心 brand assets", () => {
    it("uses the bundled 万创核心 logo for every default brand entry", () => {
        expect(DEFAULT_SITE_SETTINGS.logoUrl).toBe("/wanchuang-core-logo.png");
        expect(DEFAULT_SITE_SETTINGS.iconUrl).toBe("/wanchuang-core-icon.png");
    });

    it("keeps both raster assets square and transparent", async () => {
        const [logo, icon] = await Promise.all([
            sharp(resolve(process.cwd(), "public/wanchuang-core-logo.png")).metadata(),
            sharp(resolve(process.cwd(), "public/wanchuang-core-icon.png")).metadata(),
        ]);

        expect(logo).toMatchObject({ width: 512, height: 512, hasAlpha: true });
        expect(icon).toMatchObject({ width: 192, height: 192, hasAlpha: true });
    });
});
