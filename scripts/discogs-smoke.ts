/**
 * One-off check against the REAL Discogs API, through the app's own code path (credentials, throttling, cache,
 * normalisation): one search, one release fetch, and one image through the proxy.
 *
 *   npm run discogs:smoke
 *
 * Prints results and the rate-limit numbers Discogs reported. Never prints credentials. Cleans up the cache rows
 * it created, so no real Discogs content stays in the database.
 */
import dns from "node:dns";
import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
// Some Windows/ISP setups have a broken IPv6 route to Discogs' CDN (connect timeouts); prefer IPv4 for this check.
dns.setDefaultResultOrder("ipv4first");

async function main() {
  const { getDb } = await import("../src/server/db");
  const { searchDiscogs, getRelease } = await import("../src/server/discogs/service");
  const { proxyImage } = await import("../src/server/discogs/image");
  const { readBucket } = await import("../src/server/discogs/token-bucket");
  const { apiBase, bucketId, userAgent, cacheTtlSeconds } = await import("../src/server/discogs/config");
  const { resolveDiscogsAuth } = await import("../src/server/discogs/credentials");
  const { discogsCache } = await import("../src/server/db/schema");
  const { like } = await import("drizzle-orm");

  const db = getDb();
  const auth = resolveDiscogsAuth();
  console.log("API base        :", apiBase());
  console.log("Auth mode       :", auth ? auth.mode : "NONE (no credentials)");
  console.log("User-Agent      :", userAgent());
  console.log("Cache TTL (s)   :", cacheTtlSeconds());
  if (!auth || apiBase() !== "https://api.discogs.com") throw new Error("Refusing to run: need real credentials and the real API base.");

  const bucket = async (label: string) => {
    const b = await readBucket(db, bucketId());
    console.log(`  rate headers after ${label}: limit=${b?.observedLimit} remaining=${b?.observedRemaining} (bucket capacity=${b?.capacity}, observed ${b?.observedAt?.toISOString()})`);
  };

  console.log("\n1) search: artist 'Daft Punk' (type master)");
  const t1 = Date.now();
  const search = await searchDiscogs({ db }, { mode: "artist", query: "Daft Punk", page: 1 });
  console.log(`  -> ${search.ok ? "ok" : "FAILED " + JSON.stringify(search)} in ${Date.now() - t1} ms, cached=${search.ok && search.cached}`);
  if (search.ok) {
    const d = search.data;
    console.log(`  page ${d.page}/${d.pages}, ${d.totalItems} total, hasMore=${d.hasMore}, incomplete=${d.incomplete}, groups=${d.groups.length}`);
    for (const g of d.groups.slice(0, 3)) {
      console.log(`  group "${g.artist}": ${g.entries.length} entries`);
      for (const e of g.entries.slice(0, 3)) console.log(`    - [${e.kind}] ${e.title} (${e.year ?? "?"}) merged=${e.mergedHits} thumb=${e.thumb ? "proxied" : "none"} -> ${e.discogsUrl}`);
    }
    const leaked = JSON.stringify(d).match(/lowest_price|num_for_sale|"price"|community/);
    console.log("  marketplace fields in normalised output:", leaked ? "FOUND " + leaked[0] : "none");
  }
  await bucket("search");

  console.log("\n2) release fetch: /releases/249504");
  const t2 = Date.now();
  const rel = await getRelease({ db }, 249504);
  console.log(`  -> ${rel.ok ? "ok" : "FAILED " + JSON.stringify(rel)} in ${Date.now() - t2} ms, cached=${rel.ok && rel.cached}`);
  let imageUrl: string | null = null;
  if (rel.ok) {
    const r = rel.data;
    console.log(`  ${r.artist} - ${r.title} (${r.year}), ${r.country}, ${r.tracklist.length} tracklist rows, labels: ${r.labels.map((l) => l.name).join(", ")}`);
    console.log(`  formats: ${r.formats.map((f) => `${f.qty}x ${f.name} [${f.descriptions.join(", ")}]`).join("; ")}`);
    const leaked = JSON.stringify(r).match(/lowest_price|num_for_sale|estimated_weight|blocked_from_sale|community/);
    console.log("  marketplace fields in normalised output:", leaked ? "FOUND " + leaked[0] : "none");
    imageUrl = r.thumb ? new URL(r.thumb, "http://x").searchParams.get("u") : null;
  }
  await bucket("release");

  console.log("\n3) cache: repeating the release request must not call Discogs");
  const again = await getRelease({ db }, 249504);
  console.log(`  -> cached=${again.ok && again.cached}`);

  console.log("\n4) image through the proxy (one request to the image host)");
  if (imageUrl) {
    const out = await proxyImage(imageUrl, { db });
    if (out.ok) {
      const bytes = (await out.response.arrayBuffer()).byteLength;
      console.log(`  -> 200 ${out.response.headers.get("content-type")} ${bytes} bytes, Cache-Control: ${out.response.headers.get("cache-control")}`);
    } else console.log("  ->", JSON.stringify(out));
  } else console.log("  -> no image URL in the release payload");
  await bucket("image");

  // No permanent copies: remove what this check cached.
  const del = await db.delete(discogsCache).where(like(discogsCache.key, "v1|https://api.discogs.com|%")).returning({ key: discogsCache.key });
  console.log(`\ncleanup: removed ${del.length} cached row(s) created by this check`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("SMOKE TEST ERROR:", String(e?.message ?? e).replace(/postgres(ql)?:\/\/\S+/g, "<redacted>"));
    process.exit(1);
  });
