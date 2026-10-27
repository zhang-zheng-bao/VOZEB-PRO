import { describe, expect, it } from "vitest";

import { adminSectionHref, allowedAdminSections, canAccessAdminSection, parseAdminSection, resolveAdminSection, resolveSettingsSection } from "./admin-sections";

describe("admin sections", () => {
    it("parses a valid section and falls back to overview", () => {
        expect(parseAdminSection("channels")).toBe("channels");
        expect(parseAdminSection(["skills", "channels"])).toBe("skills");
        expect(parseAdminSection("missing")).toBe("overview");
    });

    it("keeps unrelated query parameters while updating the current section", () => {
        expect(adminSectionHref("channels", "https://example.com/settings?from=notice#top")).toBe("/settings?from=notice&section=channels#top");
        expect(adminSectionHref("overview", "https://example.com/settings?section=channels&from=notice#top")).toBe("/settings?from=notice#top");
    });

    it("keeps commercial sections out of the local settings surface", () => {
        expect(resolveSettingsSection("agentPrompts")).toBe("agentPrompts");
        expect(resolveSettingsSection("prompts")).toBe("prompts");
        expect(resolveSettingsSection("dramaStyles")).toBe("dramaStyles");
        expect(resolveSettingsSection("payments")).toBe("channels");
        expect(resolveSettingsSection(undefined)).toBe("channels");
    });

    it("shows only sections allowed by the administrator duties", () => {
        const auditor = { role: "admin", status: "active", adminPermissions: ["audit.read"] };

        expect(canAccessAdminSection(auditor, "backup")).toBe(false);
        expect(allowedAdminSections(auditor)).toEqual(["updates", "adminHelp"]);
        expect(resolveAdminSection(auditor, "backup")).toBe("updates");
    });
});
