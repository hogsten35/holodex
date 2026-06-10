// HoloDex news proxy
// Tries PokéBeach RSS first. If that feed is blocked/unavailable from Netlify,
// falls back to scraping PokeGuardian's public homepage and converting it to RSS.

const HEADERS = {
  'Content-Type': 'application/xml; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=900'
};

const USER_AGENT = 'Mozilla/5.0 (compatible; HoloDex/1.0; +https://holodex.app)';

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function stripHtml(value = '') {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#8217;/g, '’')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#038;/g, '&')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function toRss({ title, siteUrl, sourceName, items }) {
  const rssItems = items.slice(0, 8).map(item => `
  <item>
    <title>${escapeXml(item.title)}</title>
    <link>${escapeXml(item.link)}</link>
    <source>${escapeXml(item.source || sourceName)}</source>
    <pubDate>${escapeXml(item.pubDate || new Date().toUTCString())}</pubDate>
    <description>${escapeXml(item.description || '')}</description>
  </item>`).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>${escapeXml(title)}</title>
  <link>${escapeXml(siteUrl)}</link>
  <description>Pokémon TCG headlines for HoloDex</description>
  ${rssItems}
</channel>
</rss>`;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8'
    }
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  const text = await res.text();
  if (!text || text.length < 100) throw new Error(`${url} returned an empty response`);
  return text;
}

function rssLooksValid(text) {
  return /<rss[\s>]/i.test(text) && /<item[\s>]/i.test(text);
}

function parsePokeGuardianHome(html) {
  const items = [];
  const seen = new Set();

  // Handles common article card layouts: title link, then date nearby.
  const titleRegex = /<h2[^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>[\s\S]*?<\/h2>/gi;
  let match;

  while ((match = titleRegex.exec(html)) && items.length < 8) {
    let link = match[1];
    const title = stripHtml(match[2]);
    if (!title || seen.has(title.toLowerCase())) continue;
    if (link.startsWith('/')) link = 'https://www.pokeguardian.com' + link;
    if (!/^https?:\/\//i.test(link)) continue;

    const after = html.slice(match.index, match.index + 900);
    const dateText =
      (after.match(/<time[^>]*datetime=["']([^"']+)["']/i) || [])[1] ||
      (after.match(/(\d{1,2}\s+[A-Z][a-z]{2}\s+\d{4})/) || [])[1] ||
      '';

    const pubDate = dateText ? new Date(dateText).toUTCString() : new Date().toUTCString();

    // Small text snippet after the date/title area when available.
    const description = stripHtml(after)
      .replace(title, '')
      .replace(dateText, '')
      .replace(/Read more\s*»?/i, '')
      .trim()
      .slice(0, 180);

    seen.add(title.toLowerCase());
    items.push({ title, link, pubDate, description, source: 'PokeGuardian' });
  }

  // Backup parser for simpler static HTML exports.
  if (!items.length) {
    const simpleRegex = /href=["']([^"']+)["'][^>]*>\s*([^<]{20,120}?(?:Revealed|Set List|Promo|Cards|Pokemon TCG)[^<]{0,80})\s*</gi;
    while ((match = simpleRegex.exec(html)) && items.length < 8) {
      let link = match[1];
      const title = stripHtml(match[2]);
      if (!title || seen.has(title.toLowerCase())) continue;
      if (link.startsWith('/')) link = 'https://www.pokeguardian.com' + link;
      if (!/^https?:\/\//i.test(link)) continue;
      seen.add(title.toLowerCase());
      items.push({ title, link, pubDate: new Date().toUTCString(), source: 'PokeGuardian' });
    }
  }

  return items;
}

exports.handler = async () => {
  // 1) Preferred source: PokéBeach RSS feed.
  try {
    const rss = await fetchText('https://www.pokebeach.com/feed');
    if (rssLooksValid(rss)) {
      return { statusCode: 200, headers: HEADERS, body: rss };
    }
    throw new Error('PokéBeach RSS response did not include RSS items');
  } catch (err) {
    console.warn('PokéBeach feed failed:', err.message);
  }

  // 2) Fallback source: PokeGuardian homepage converted to RSS.
  try {
    const html = await fetchText('https://www.pokeguardian.com/');
    const items = parsePokeGuardianHome(html);
    if (!items.length) throw new Error('No PokeGuardian articles parsed');

    const rss = toRss({
      title: 'PokeGuardian',
      siteUrl: 'https://www.pokeguardian.com/',
      sourceName: 'PokeGuardian',
      items
    });

    return { statusCode: 200, headers: HEADERS, body: rss };
  } catch (err) {
    console.warn('PokeGuardian fallback failed:', err.message);
  }

  // 3) Last-resort placeholder: 200 response so the app never throws a red console error.
  const fallback = toRss({
    title: 'HoloDex News',
    siteUrl: 'https://www.pokebeach.com/',
    sourceName: 'HoloDex',
    items: [{
      title: 'Pokémon TCG news temporarily unavailable',
      link: 'https://www.pokebeach.com/',
      pubDate: new Date().toUTCString(),
      description: 'The upstream news sources could not be reached from Netlify.'
    }]
  });

  return { statusCode: 200, headers: HEADERS, body: fallback };
};
