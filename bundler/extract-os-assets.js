/**
 * Lifts the desktop's embedded assets out into real files.
 *
 * The published desktop is a self-extracting bundle: 50 assets, gzipped and
 * base64'd into a manifest inside the HTML — 3.7MB of the file's 4MB. On load
 * its runtime walks every asset with atob() and a per-byte copy loop before the
 * page can render, which is a long enough main-thread block to stutter the 3D
 * scene the screen lives in.
 *
 * This runs after the build copies static/ into public/: it decodes each asset
 * once, writes it beside the page, and rewrites the manifest entry to point at
 * the file. The runtime's unpack loop gets a one-line early return for entries
 * that carry a url, so nothing is decoded at runtime — the browser fetches the
 * files normally (cached, decoded off the main thread) and the HTML drops to a
 * fraction of its size.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PAGE = path.join(__dirname, '..', 'public', 'os', 'index.html');
const ASSET_DIR = path.join(__dirname, '..', 'public', 'os', 'a');
/** Where the page refers to them from. */
const ASSET_HREF = 'a/';

const EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'video/mp4': 'mp4',
    'audio/mpeg': 'mp3',
    'application/pdf': 'pdf',
    'font/woff2': 'woff2',
    'font/woff': 'woff',
    'font/ttf': 'ttf',
    'text/plain': 'txt',
    'text/html': 'html',
};

function tagBody(html, type) {
    const open = `<script type="__bundler/${type}">`;
    const start = html.indexOf(open);
    if (start === -1) return null;
    const from = start + open.length;
    const end = html.indexOf('</script>', from);
    return { from, end, text: html.slice(from, end) };
}

function main() {
    let html = fs.readFileSync(PAGE, 'utf8');

    const manifestTag = tagBody(html, 'manifest');
    if (!manifestTag) throw new Error('no bundler manifest in ' + PAGE);
    const manifest = JSON.parse(manifestTag.text);

    // Nested page bundles are text, not files — they must keep their payload.
    const pageTag = tagBody(html, 'page_order');
    const pages = new Set(pageTag ? JSON.parse(pageTag.text) : []);

    fs.rmSync(ASSET_DIR, { recursive: true, force: true });
    fs.mkdirSync(ASSET_DIR, { recursive: true });

    let extracted = 0;
    let bytes = 0;
    for (const uuid of Object.keys(manifest)) {
        const entry = manifest[uuid];
        if (pages.has(uuid) || !entry.data) continue;

        let data = Buffer.from(entry.data, 'base64');
        if (entry.compressed) data = zlib.gunzipSync(data);

        const name = uuid + '.' + (EXTENSIONS[entry.mime] || 'bin');
        fs.writeFileSync(path.join(ASSET_DIR, name), data);
        manifest[uuid] = { mime: entry.mime, url: ASSET_HREF + name };
        extracted += 1;
        bytes += data.length;
    }

    if (!extracted) {
        console.log('[os-assets] nothing to extract');
        return;
    }

    html = html.slice(0, manifestTag.from) + JSON.stringify(manifest) + html.slice(manifestTag.end);

    // Teach the unpack loop to take the file when there is one.
    const anchor = `      const entry = manifest[uuid];\n      try {`;
    if (!html.includes(anchor)) throw new Error('unpack loop not found — did the bundler change?');
    html = html.replace(
        anchor,
        `      const entry = manifest[uuid];\n` +
            `      // Extracted at build time (bundler/extract-os-assets.js): the\n` +
            `      // browser fetches these instead of the page decoding them.\n` +
            `      if (entry.url) { blobUrls[uuid] = entry.url; return; }\n` +
            `      try {`,
    );

    // Substitution was 50 full passes over the template (split/join per asset);
    // with the payloads gone that string churn is a visible share of what is
    // left, so it becomes one pass.
    const subLoop = `    for (const uuid of uuids) {
      if (pageSet.has(uuid)) continue;
      template = template.split(uuid).join(blobUrls[uuid]);
    }`;
    if (html.includes(subLoop)) {
        html = html.replace(
            subLoop,
            `    template = template.replace(\n` +
                `      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,\n` +
                `      (id) => (pageSet.has(id) || blobUrls[id] === undefined ? id : blobUrls[id])\n` +
                `    );`,
        );
    } else {
        console.warn('[os-assets] substitution loop not found; left as is');
    }

    fs.writeFileSync(PAGE, html);
    const mb = (n) => (n / 1024 / 1024).toFixed(2) + 'MB';
    console.log(
        `[os-assets] extracted ${extracted} assets (${mb(bytes)}), page is now ${mb(html.length)}`,
    );
}

main();
