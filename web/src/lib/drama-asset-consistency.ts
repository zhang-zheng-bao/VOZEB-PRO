import type { DramaAssetReference, DramaNamedAsset, DramaProject } from "@/lib/drama-project-contract";

export type DramaVisualAssetKind = "characters" | "scenes" | "props";
export type DramaAssetConsistencySource = {
    asset: DramaNamedAsset;
    reference: DramaAssetReference;
    role: "target" | "related-character" | "related-prop";
};

export function primaryDramaAssetReference(asset: DramaNamedAsset): DramaAssetReference | undefined {
    return asset.references?.find((reference) => reference.id === asset.primaryReferenceId) || asset.references?.[0] || legacyReference(asset);
}

export function dramaAssetConsistencySources(project: DramaProject, asset: DramaNamedAsset, kind: DramaVisualAssetKind): DramaAssetConsistencySource[] {
    const related = kind === "props" ? relatedCharacters(project, asset.id) : kind === "characters" ? relatedProps(project, asset.id) : [];
    const sources: DramaAssetConsistencySource[] = [];
    const targetReference = primaryDramaAssetReference(asset);
    if (targetReference) sources.push({ asset, reference: targetReference, role: "target" });
    for (const relatedAsset of related) {
        const reference = primaryDramaAssetReference(relatedAsset);
        if (!reference || sources.some((source) => source.reference.url === reference.url)) continue;
        sources.push({ asset: relatedAsset, reference, role: kind === "props" ? "related-character" : "related-prop" });
    }
    return sources;
}

function relatedCharacters(project: DramaProject, propId: string) {
    const ids = new Set(project.episodes.flatMap((episode) => episode.shots.filter((shot) => shot.propIds.includes(propId)).flatMap((shot) => shot.characterIds)));
    return project.characters.filter((character) => ids.has(character.id));
}

function relatedProps(project: DramaProject, characterId: string) {
    const ids = new Set(project.episodes.flatMap((episode) => episode.shots.filter((shot) => shot.characterIds.includes(characterId)).flatMap((shot) => shot.propIds)));
    return project.props.filter((prop) => ids.has(prop.id));
}

function legacyReference(asset: DramaNamedAsset): DramaAssetReference | undefined {
    return asset.referenceImageUrl
        ? {
              id: `${asset.id}-reference-legacy`,
              url: asset.referenceImageUrl,
              storageKey: asset.referenceStorageKey,
              source: "library",
              label: "原参考图",
              createdAt: new Date(0).toISOString(),
          }
        : undefined;
}
