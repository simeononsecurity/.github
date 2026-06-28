#!/usr/bin/env node
/**
 * update-readme.js
 *
 * Fetches the latest posts from an RSS feed, extracts each post's cover/meta
 * image, and renders a responsive 4-across grid (image + title) into README.md
 * between the BLOG-POST-LIST markers.
 *
 * Image resolution order per post:
 *   1. <enclosure url="..."> (cover image embedded in the feed)
 *   2. <media:content> / <media:thumbnail>
 *   3. Scrape the post page for <meta property="og:image">
 *   4. Site banner fallback
 *
 * Requires Node 18+ (uses the global `fetch`). No external dependencies.
 */

const fs = require("fs");
const path = require("path");

const FEED_URL = process.env.FEED_URL || "https://simeononsecurity.com/index.xml";
const POST_COUNT = parseInt(process.env.POST_COUNT || "4", 10);
const README_PATH = path.join(__dirname, "..", "README.md");
const START = "<!-- BLOG-POST-LIST:START -->";
const END = "<!-- BLOG-POST-LIST:END -->";
const FALLBACK_IMG = "https://simeononsecurity.com/img/banner.png";
const USER_AGENT = "simeononsecurity-readme-updater";

function decodeEntities(str = "") {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeHtml(str = "") {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Request failed (${res.status}) for ${url}`);
  return res.text();
}

async function getOgImage(url) {
  try {
    const html = await fetchText(url);
    const m =
      html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1] : "";
  } catch {
    return "";
  }
}

function resolveFeedImage(block) {
  const enclosure = block.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]*>/i);
  if (enclosure && /\.(png|jpe?g|webp|gif|avif)(\?|$)/i.test(enclosure[1])) {
    return enclosure[1];
  }
  const media =
    block.match(/<media:content[^>]+url=["']([^"']+)["']/i) ||
    block.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
  if (media) return media[1];
  return "";
}

async function buildPosts() {
  const xml = await fetchText(FEED_URL);
  const itemBlocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)]
    .map((m) => m[1])
    .slice(0, POST_COUNT);

  const posts = [];
  for (const block of itemBlocks) {
    const title = getTag(block, "title");
    const link = getTag(block, "link");
    let image = resolveFeedImage(block);
    if (!image && link) image = await getOgImage(link);
    if (!image) image = FALLBACK_IMG;
    posts.push({ title, link, image });
  }
  return posts;
}

function renderTable(posts) {
  if (!posts.length) return "<!-- No posts found -->";
  const cells = posts
    .map(
      (p) => `<td align="center" width="25%" valign="top">
<a href="${escapeHtml(p.link)}">
<img src="${escapeHtml(p.image)}" width="100%" alt="${escapeHtml(p.title)}" />
</a>
<br/>
<a href="${escapeHtml(p.link)}"><sub><b>${escapeHtml(p.title)}</b></sub></a>
</td>`
    )
    .join("\n");
  return `<table>\n<tr>\n${cells}\n</tr>\n</table>`;
}

function injectIntoReadme(table) {
  const readme = fs.readFileSync(README_PATH, "utf8");
  const startIdx = readme.indexOf(START);
  const endIdx = readme.indexOf(END);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
    throw new Error(
      `Could not find markers "${START}" / "${END}" in README.md`
    );
  }
  const before = readme.slice(0, startIdx + START.length);
  const after = readme.slice(endIdx);
  const updated = `${before}\n${table}\n${after}`;
  if (updated === readme) {
    console.log("README is already up to date.");
    return;
  }
  fs.writeFileSync(README_PATH, updated);
  console.log("README updated.");
}

(async () => {
  const posts = await buildPosts();
  console.log(`Fetched ${posts.length} post(s) from ${FEED_URL}`);
  posts.forEach((p, i) => console.log(`  ${i + 1}. ${p.title}`));
  injectIntoReadme(renderTable(posts));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
