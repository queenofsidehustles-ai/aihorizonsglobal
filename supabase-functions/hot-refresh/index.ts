// Hot Products: pulls TikTok Shop US top sellers from Apify into hot_products.
// action "start"  -> starts one Apify run for all active categories (admin or cron)
// action "collect" -> if the last run finished, saves its rows (admin or cron)
// action "status" -> last log rows (admin)
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_ = Deno.env.get("SUPABASE_URL")!;
const db = createClient(URL_, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const ACTOR = "lergassy~tiktok-shop-top-products-scraper";
const PER_LIST = 25;
const MAX_USD_PER_RUN = 2;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info, x-cron-key", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

async function allowed(req: Request): Promise<string | null> {
  const given = req.headers.get("x-cron-key");
  if (given) {
    const { data: k } = await db.from("hot_private").select("cron_key").eq("id", 1).maybeSingle();
    if (k && given === k.cron_key) return "schedule";
  }
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return null;
  const u = createClient(URL_, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data } = await u.rpc("is_admin");
  return data === true ? "admin" : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const who = await allowed(req);
  if (!who) return out({ error: "Only Monica can refresh Hot Products." }, 403);
  const { action = "start" } = await req.json().catch(() => ({}));
  const token = Deno.env.get("APIFY_TOKEN");

  if (action === "status") {
    const { data } = await db.from("hot_refresh_log").select("*").order("id", { ascending: false }).limit(5);
    return out({ log: data || [], hasKey: !!token });
  }
  if (!token) return out({ error: "The Apify key isn't added yet." }, 400);

  if (action === "start") {
    const { data: cats } = await db.from("hot_categories").select("*").eq("active", true).order("sort");
    const categories = (cats || []).filter((c) => c.apify_category).map((c) => c.apify_category);
    const keywords = (cats || []).flatMap((c) => c.keywords || []);
    const input = { categories, keywords, country: "US", period: "last7Day", sortBy: "unitsSold", maxResultsPerSource: PER_LIST };
    const r = await fetch(`https://api.apify.com/v2/acts/${ACTOR}/runs?maxTotalChargeUsd=${MAX_USD_PER_RUN}`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(input),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      await db.from("hot_refresh_log").insert({ error: JSON.stringify(j).slice(0, 500), triggered_by: who, finished_at: new Date().toISOString() });
      return out({ error: "Apify didn't start the update.", detail: j?.error?.message }, 502);
    }
    await db.from("hot_refresh_log").insert({ cost_note: `run:${j.data.id}`, triggered_by: who });
    return out({ started: true, runId: j.data.id });
  }

  if (action === "collect") {
    const { data: last } = await db.from("hot_refresh_log").select("*").like("cost_note", "run:%").is("finished_at", null).order("id", { ascending: false }).limit(1).maybeSingle();
    if (!last) return out({ done: true, note: "Nothing waiting." });
    const runId = String(last.cost_note).slice(4);
    const rr = await fetch(`https://api.apify.com/v2/actor-runs/${runId}`, { headers: { Authorization: `Bearer ${token}` } });
    const run = (await rr.json()).data;
    if (!run) return out({ error: "Couldn't find the run." }, 502);
    if (["READY", "RUNNING"].includes(run.status)) return out({ done: false, status: run.status });
    const items: Record<string, unknown>[] = [];
    if (run.defaultDatasetId) {
      const ir = await fetch(`https://api.apify.com/v2/datasets/${run.defaultDatasetId}/items?clean=true&limit=2000`, { headers: { Authorization: `Bearer ${token}` } });
      items.push(...(await ir.json()));
    }
    const { data: cats } = await db.from("hot_categories").select("*");
    const map = new Map<string, string>();
    for (const c of cats || []) {
      if (c.apify_category) map.set(c.apify_category.toLowerCase(), c.slug);
      for (const k of c.keywords || []) map.set(k.toLowerCase(), c.slug);
    }
    const slugOf = (it: Record<string, unknown>) => {
      for (const v of [it.sourceInput, it.category]) {
        const s = String(v || "").toLowerCase();
        if (map.has(s)) return map.get(s)!;
        for (const [k, slug] of map) if (s && (s.includes(k) || k.includes(s))) return slug;
      }
      return null;
    };
    const rows = items.filter((it) => it.type === "product" || it.productId).map((it) => {
      const slug = slugOf(it);
      if (!slug) return null;
      return {
        category: slug, rank: Number(it.rank) || null, product_id: String(it.productId || ""), title: String(it.title || "").slice(0, 300),
        url: (it.url as string) || null, image_url: (it.imageUrl as string) || (it.image as string) || null,
        price: Number(it.avgSellingPrice ?? it.minPrice) || null, units_sold: Number(it.unitsSold) || null, revenue: Number(it.revenue) || null,
        growth_pct: it.revenueGrowthPercent == null ? null : Number(it.revenueGrowthPercent), commission_pct: it.commissionRatePercent == null ? null : Number(it.commissionRatePercent),
        period: (it.period as string) || null,
      };
    }).filter(Boolean) as Record<string, unknown>[];
    const got = new Set(rows.map((r) => r.category as string));
    if (got.size) await db.from("hot_products").delete().in("category", [...got]); // only replace lists that came back
    for (let i = 0; i < rows.length; i += 500) await db.from("hot_products").insert(rows.slice(i, i + 500));
    const cost = run.usageTotalUsd != null ? `$${Number(run.usageTotalUsd).toFixed(2)}` : "";
    await db.from("hot_refresh_log").update({ finished_at: new Date().toISOString(), rows: rows.length, cost_note: `run:${runId} ${run.status} ${cost}`.trim(), error: run.status === "SUCCEEDED" ? null : run.status }).eq("id", last.id);
    return out({ done: true, rows: rows.length, lists: got.size, status: run.status, cost });
  }
  return out({ error: "Unknown action" }, 400);
});
