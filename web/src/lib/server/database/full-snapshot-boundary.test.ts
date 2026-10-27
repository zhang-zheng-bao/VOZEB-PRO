import { afterEach, describe, expect, it } from "vitest";

import { readAuthDb } from "@/lib/auth/store-repository";
import { readPromptBackup } from "@/lib/prompts/store";
import { readGenerationLogDb } from "@/lib/server/generation-log-repository";
import { getDatabaseProvider } from "@/lib/server/database";

const originalProvider = process.env.VOZEB_PRO_DATABASE_PROVIDER;
const originalPersonalMode = process.env.VOZEB_PRO_PERSONAL_MODE;

afterEach(() => {
    if (originalProvider === undefined) delete process.env.VOZEB_PRO_DATABASE_PROVIDER;
    else process.env.VOZEB_PRO_DATABASE_PROVIDER = originalProvider;
    if (originalPersonalMode === undefined) delete process.env.VOZEB_PRO_PERSONAL_MODE;
    else process.env.VOZEB_PRO_PERSONAL_MODE = originalPersonalMode;
});

describe("PostgreSQL full snapshot boundaries", () => {
    it("lets local personal mode force file storage even when postgres env remains present", () => {
        process.env.VOZEB_PRO_PERSONAL_MODE = "true";
        process.env.VOZEB_PRO_DATABASE_PROVIDER = "postgres";

        expect(getDatabaseProvider()).toBe("file");
    });

    it("rejects ordinary full-snapshot readers", async () => {
        process.env.VOZEB_PRO_DATABASE_PROVIDER = "postgres";
        delete process.env.VOZEB_PRO_PERSONAL_MODE;

        await expect(readAuthDb()).rejects.toThrow("entity repositories");
        await expect(readPromptBackup()).rejects.toThrow("scoped repositories");
        await expect(readGenerationLogDb()).rejects.toThrow("scoped repositories");
    });
});
