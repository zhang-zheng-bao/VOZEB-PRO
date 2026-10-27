import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_URL = "https://www.runninghub.cn/call-api/search-api/standard-model?search=";
const OUT_FILE = path.resolve("src/data/runninghub-model-prices.json");

const html = await fetch(SOURCE_URL, {
    headers: {
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
        accept: "text/html,application/xhtml+xml",
    },
}).then((response) => {
    if (!response.ok) throw new Error(`RunningHub price page failed: ${response.status}`);
    return response.text();
});

const items = [];
for (const match of html.matchAll(/<div class="api-list-item"[\s\S]*?(?=<div class="api-list-item"|<script id="__NUXT_DATA__|$)/g)) {
    const chunk = match[0];
    const name = htmlText(chunk.match(/<h3 class="api-list-item-name" title="([^"]+)"/)?.[1]);
    if (!name) continue;
    const category = htmlText(chunk.match(/api-list-item-cat[^>]*>([^<]+)/)?.[1]);
    const price = htmlText(chunk.match(/¥\s*\d+(?:\.\d+)?/)?.[0]);
    if (!price) continue;
    const unit = htmlText(chunk.match(/api-list-item-price-extra[^>]*>([^<]+)/)?.[1]);
    const channel = htmlText(chunk.match(/channel-tag[^>]*>([^<]+)/)?.[1]);
    const title = htmlText(chunk.match(/api-list-item-price-new"[^>]*(?:title="([^"]+)")?/)?.[1]);
    items.push({ name, category, priceText: `${price}${unit}`, unit, channel, title });
}

const unique = Array.from(new Map(items.map((item) => [`${item.name}|${item.category}|${item.priceText}`, item])).values());
unique.sort((a, b) => a.category.localeCompare(b.category, "zh-CN") || a.name.localeCompare(b.name, "zh-CN"));
await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
await fs.writeFile(OUT_FILE, `${JSON.stringify({ sourceUrl: SOURCE_URL, updatedAt: new Date().toISOString(), items: unique }, null, 2)}\n`, "utf8");
console.log(`Wrote ${unique.length} RunningHub model prices to ${OUT_FILE}`);

function htmlText(value = "") {
    return String(value)
        .replace(/&amp;/g, "&")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .trim();
}
