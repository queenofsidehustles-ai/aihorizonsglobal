// Team report: a member's AI agents tell their HQ Live Office what they did.
// URL: https://<project>.supabase.co/functions/v1/team-report?k=<member report code>&agent=Aria&status=done&task=...&note=...&link=...
// Works as a plain GET link (so an agent can just "open" it) or as a POST with JSON or form fields.
// The report code comes from HQ (my_report_key). It can only add runs to that member's own Live Office.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const STATUSES = new Set(["working", "done", "needs_you", "failed"]);
const DAILY_LIMIT = 300;

const reply = (status: number, text: string) =>
  new Response(text, { status, headers: { ...CORS, "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

const clean = (v: unknown, max: number) => {
  if (v == null) return null;
  const s = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  return s ? s.slice(0, max) : null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return reply(204, "");
  if (req.method !== "GET" && req.method !== "POST") return reply(405, "Use GET or POST.");

  const params: Record<string, unknown> = Object.fromEntries(new URL(req.url).searchParams);
  if (req.method === "POST") {
    const type = req.headers.get("content-type") || "";
    try {
      if (type.includes("application/json")) Object.assign(params, await req.json());
      else if (type.includes("form")) Object.assign(params, Object.fromEntries(await req.formData()));
    } catch (_) { return reply(400, "Could not read the report."); }
  }

  const key = clean(params.k ?? params.key, 64);
  if (!key || !/^[a-f0-9]{24}$/.test(key)) return reply(401, "Report code missing or wrong. Copy it again from your HQ (My AI Team page).");

  const { data: owner } = await db.from("member_report_keys").select("user_id").eq("key", key).maybeSingle();
  if (!owner) return reply(401, "Report code not found. Copy it again from your HQ (My AI Team page).");

  const agent = clean(params.agent, 40);
  if (!agent) return reply(400, "Add agent=YourAgentName to the link.");

  let status = (clean(params.status, 20) || "done").toLowerCase().replace(/[\s-]+/g, "_");
  if (status === "needs_your_ok" || status === "needs_you_now") status = "needs_you";
  if (!STATUSES.has(status)) status = "done";

  let link = clean(params.link, 500);
  if (link && !/^https?:\/\//i.test(link)) link = null;

  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { count } = await db.from("member_agent_runs").select("id", { count: "exact", head: true })
    .eq("user_id", owner.user_id).gte("created_at", since);
  if ((count ?? 0) >= DAILY_LIMIT) return reply(429, "Daily report limit reached. Try again tomorrow.");

  const { error } = await db.from("member_agent_runs").insert({
    user_id: owner.user_id,
    agent,
    task: clean(params.task, 200),
    status,
    note: clean(params.note, 1000),
    link,
  });
  if (error) return reply(500, "Could not save the report. Try again in a minute.");
  return reply(200, `Saved. ${agent}'s report is on the Live Office now.`);
});
