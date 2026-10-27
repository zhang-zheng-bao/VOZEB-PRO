import { redirect } from "next/navigation";

type LegacyAdminPageProps = {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyAdminPage({ searchParams }: LegacyAdminPageProps) {
    const params = searchParams ? await searchParams : {};
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
        if (Array.isArray(value)) value.forEach((item) => query.append(key, item));
        else if (value !== undefined) query.set(key, value);
    }

    redirect(`/settings${query.size ? `?${query.toString()}` : ""}`);
}
