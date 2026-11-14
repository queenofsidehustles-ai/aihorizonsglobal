// Dream Cast: MCP server for ChatGPT (Streamable HTTP, JSON responses).
// URL: https://<project>.supabase.co/functions/v1/dreamcast/<member key>
// The member key comes from HQ (dreamcast_my_key). It only unlocks that member's own characters.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, authorization, mcp-session-id, mcp-protocol-version, accept",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

const INSTRUCTIONS = `You are Dream Cast, a warm, glamorous studio host who talks like a friendly director on set: encouraging, short and clear, never tech words. Most users are women 45+ who are new to AI.

When a chat starts with a hello or a question about what you do, call my_characters, then reply with this menu (each choice on its own line):
🎬 **Welcome to Dream Cast!** Your character, the same face in every picture. ✨
What are we making today?
**1️⃣ Meet your new character**: say "Make a picture of" and her name
**2️⃣ New scene**: tell me where she is
**3️⃣ My shoot list**: I'll make the scenes you picked in HQ
**4️⃣ Outfit swap**: attach the outfit picture
**5️⃣ Two characters**: pick who's in the scene
**6️⃣ Make it move**: get a video prompt for a picture
**7️⃣ Product video**: pick a product from Hot Products in HQ
Just type a number, or tell me in your own words. 💛

Her journey (follow it):
- "Make a picture of [name]", "show me [name]" or "try her on" → call try_on, then make the picture word for word. Then ask: "Love her, or want to change something?"
- She asks for changes ("shorter hair", "warmer skin") → call change_look and make the new picture. Repeat as often as she likes.
- Every change works right away on a full new picture (makeup, jewelry, hair, skin, outfit, anything). Never say a change needs a close-up first, and never tell her a tool is blocked. If a tool call fails, still make the new picture from her saved look plus the change.
- When she says "keep her", the description you save MUST include every change she asked for in this chat (for example "natural, minimal makeup" if she asked to tone it down), replacing the old wording.
- She says "keep her" / "I love her" → call keep_character with her full updated description (include every change she asked for), then make her character sheet exactly as the tool says, and tell her to save the sheet to her phone: she attaches it in every new chat.
- "Make my shoot list" → call my_shoot_list, then make the scenes one at a time with picture_prompt (kind "scene"). After each picture, call shoot_list_done with that item's id, then offer the next one.
- "Make it move" / "video prompt" → call video_prompt.
- "Make a product video for ..." → call product_video with the product and style (Full presenter, Hands only or Product only). Show her the 10 scene ideas as a short numbered list. When she picks one, call product_video again with that scene, then follow it: write the script, make the picture, give the video prompt and the caption.
- Later she wants to change who her character is for good ("change her look and keep it") → change_look, then keep_character.

How to work:
- ALWAYS create every picture brand new with your image generation tool. NEVER search the web, never use stock photos, Unsplash or any real person's photo. If you can't create the image in the same message as a Dream Cast tool call, don't search and don't describe a picture: end with one short line, "Say **Make it** and I'll create her picture. 🎬"
- Always get the exact wording from the Dream Cast tools (picture_prompt, plan_video, find_scenes, fix_picture) and follow it word for word when you make the picture with your image tool.
- Remind the user to attach her character sheet (or best picture) when a picture needs it. Pictures need it every time.
- Show only ONE of each character in a picture. Never copy a real person's face (except the user's own photo), a celebrity, or make realistic children.
- After every picture, end with a short "🎬 Next take?" line with 2 or 3 choices (new scene, new outfit, or a video prompt for this picture).
- Put any prompt the user should copy in a code box. One or two emojis per message, never inside a prompt.`;

const AVOID_DEFAULT = "Real, unretouched look: visible skin texture, natural light, no plastic skin, no beauty filters. Vertical 9:16. No text, logos or watermarks.";

const FIXES: [string, string][] = [
  ["Looks too AI", "Same picture, but make it look like a real, unedited photo: visible skin pores and texture, slightly uneven skin tone, a few flyaway hairs, natural camera grain and softer natural light. Remove the airbrushed, plastic, overly smooth look. Keep everything else exactly the same."],
  ["Face changed", "The face changed. Keep the face exactly like my attached reference photo: same face shape, eyes, nose, lips, skin tone and hair. Only change the scene. Do not beautify, slim or alter any features."],
  ["Skin too smooth", "Keep everything the same, but bring back real skin: visible pores, fine texture, natural shine on the forehead and nose, and slight unevenness. No smoothing filter."],
  ["Wrong skin tone", "The skin tone is off. Match the skin tone and undertone in my reference photo exactly. Keep the light natural so the skin is not washed out, grayed or darkened."],
  ["Hair changed", "Keep the hair exactly like my reference photo: same texture, length, color and style. Do not straighten, lengthen or change the hairline."],
  ["Product looks wrong", "The product changed. Use my attached product photo exactly: same label, logo, text, colors, shape and size. Do not redesign or relabel it."],
  ["Weird hands", "Fix the hands: five natural fingers on each hand, relaxed and natural grip, correct size for the body. Keep everything else the same."],
  ["Too perfect, model-like", "Make the person look like an everyday real person, not a model: natural proportions, real skin texture, a candid expression and casual posture. Keep the face and identity the same."],
  ["Two of her", "Show only ONE of her. My reference is a character sheet of the same person from several angles, not several people."],
];

type Char = { id: string; name: string; lock: string; status?: string; start_prompt?: string | null };
const R = { readOnlyHint: true, destructiveHint: false, openWorldHint: false };
const W = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  { name: "my_characters", title: "My characters", description: "List the characters this member saved in Dream Cast (SOS HQ). Call this first in a new chat.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: R },
  { name: "character_details", title: "Character details", description: "Get one saved character's full look description and the rules for keeping her the same in every picture.", inputSchema: { type: "object", properties: { character: { type: "string", description: "Character name" } }, required: ["character"], additionalProperties: false }, annotations: R },
  { name: "try_on", title: "Try her on", description: "Make the first picture of a character she designed in SOS HQ (works for drafts). Returns the exact prompt to make her picture now.", inputSchema: { type: "object", properties: { character: { type: "string" } }, required: ["character"], additionalProperties: false }, annotations: R },
  { name: "change_look", title: "Change her look", description: "She wants her character to look different (hair, skin, age, face, body...). Returns the prompt for a new picture with the changes, keeping everything else the same.", inputSchema: { type: "object", properties: { character: { type: "string" }, changes: { type: "string", description: "The changes, in her words" } }, required: ["character", "changes"], additionalProperties: false }, annotations: R },
  { name: "keep_character", title: "Keep her", description: "She loves how her character looks. Saves the final look to SOS HQ (so every future picture uses it) and returns the character sheet prompt to make next.", inputSchema: { type: "object", properties: { character: { type: "string" }, description: { type: "string", description: "Her full updated look in one paragraph, facts only, same style as her saved description, including every change she asked for. Leave empty if nothing changed." } }, required: ["character"], additionalProperties: false }, annotations: W },
  { name: "my_shoot_list", title: "My shoot list", description: "The scenes she picked in SOS HQ to make next. Make them one at a time with picture_prompt (kind scene), then call shoot_list_done for each.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: R },
  { name: "shoot_list_done", title: "Mark scenes done", description: "Mark shoot list scenes as made, after their pictures are done.", inputSchema: { type: "object", properties: { ids: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 20 } }, required: ["ids"], additionalProperties: false }, annotations: W },
  { name: "product_video", title: "Product video", description: "Plan a TikTok Shop style product video starring her character. First call without scene: returns 10 scene ideas. Second call with the scene she picked: returns the script, picture prompt, video prompt and caption.", inputSchema: { type: "object", properties: { product: { type: "string", description: "Product name, as she said it or from her saved products" }, style: { type: "string", enum: ["Full presenter", "Hands only", "Product only"] }, character: { type: "string", description: "Saved character (not needed for Product only)" }, scene: { type: "string", description: "The scene she picked (second call)" } }, required: ["product"], additionalProperties: false }, annotations: R },
  { name: "my_products", title: "My products", description: "Products she saved in SOS HQ (Hot Products or her own).", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: R },
  { name: "video_prompt", title: "Video prompt", description: "Get a short video prompt to make a picture of her move in a video app (8 seconds, vertical).", inputSchema: { type: "object", properties: { character: { type: "string" }, action: { type: "string", description: "What she does in the clip (optional)" }, line: { type: "string", description: "What she says (optional)" } }, required: ["character"], additionalProperties: false }, annotations: R },
  {
    name: "picture_prompt", title: "Picture prompt",
    description: "Get the exact image prompt for a saved character. kinds: scene (a new scene), outfit (wear an outfit from an attached picture), two_characters (two saved characters together), character_sheet (her master sheet). Then make the picture with your image tool following it word for word.",
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["scene", "outfit", "two_characters", "character_sheet"] },
        character: { type: "string", description: "Saved character name" },
        scene: { type: "string", description: "Where she is and what she's doing, in the user's words (for scene or two_characters)" },
        second_character: { type: "string", description: "Second saved character (two_characters only)" },
        result: { type: "string", enum: ["one_picture", "new_sheet"], description: "outfit only: one picture on white, or a new character sheet" },
      },
      required: ["kind", "character"], additionalProperties: false,
    },
    annotations: R,
  },
  {
    name: "plan_video", title: "Plan a video",
    description: "Get a storyboard plan request for a short vertical video starring a saved character: scenes with visual, camera, POV, action and line, plus picture and video prompts per scene.",
    inputSchema: {
      type: "object",
      properties: {
        character: { type: "string" },
        idea: { type: "string", description: "What the video is about" },
        scenes: { type: "integer", enum: [3, 5, 7] },
        style: { type: "string", enum: ["Product video (UGC)", "Mini story", "Day in my life", "How-to / tips"] },
      },
      required: ["character", "idea"], additionalProperties: false,
    },
    annotations: R,
  },
  {
    name: "find_scenes", title: "Find scene ideas",
    description: "Search the Dream Cast scene library (kitchen, café, podcast, UGC, lifestyle and more). Returns ready scene ideas the user can pick.",
    inputSchema: { type: "object", properties: { search: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 12 } }, additionalProperties: false },
    annotations: R,
  },
  {
    name: "fix_picture", title: "Fix a picture",
    description: "Get the exact fix wording when a picture came out wrong (face changed, looks too AI, skin too smooth, wrong skin tone, hair changed, product wrong, weird hands, too perfect, two of her).",
    inputSchema: { type: "object", properties: { problem: { type: "string" } }, required: ["problem"], additionalProperties: false },
    annotations: R,
  },
];

const pron = (c: Char) => (/^A man\b/.test(c.lock || "") ? { he: "he", his: "his", one: "him" } : { he: "she", his: "her", one: "her" });
const sheetRule = (n: string) => `If my attached picture is a character sheet showing ${n} from several angles, it is the SAME person. Show only ONE ${n} in each picture.`;
const refLock = (c: Char) => { const p = pron(c); return `Use my attached picture or character sheet of ${c.name} as the exact reference. Keep ${p.his} face, skin tone, undertone, hair and body shape exactly the same. Do not beautify, slim or change ${p.his} age. ${sheetRule(c.name)}\n\nWho ${c.name} is: ${c.lock}`; };

const sheetPrompt = (c: Char) => { const p = pron(c); return `ATTACH: the picture of ${c.name} you love (or use the last picture in this chat).\n\nPROMPT:\nCreate a professional character reference sheet of this exact person, ${c.name}. One wide 16:9 image on a plain light gray background, laid out like this:\n- Top row: 4 full-body views of ${c.name} standing relaxed: front, left side, right side and back.\n- Bottom left: 2 face close-ups: straight on, and three-quarter.\n- Right side: a clean panel with the name "${c.name}" at the top and short labeled lines: age, face shape, skin tone and undertone, eyes, nose, lips, brows, hair, body type, makeup, and any jewelry or piercings (say which side).\n\nIt is the SAME person in every view. Keep the face, skin tone, hair, makeup, body shape and proportions exactly the same as the picture. Do not beautify or change ${p.his} age.\nSame plain fitted black top and pants and white sneakers in every view. Soft even studio light, calm expression with a slight smile. No props, no logos, no watermark. Spell every word clearly.\n\nWho ${c.name} is: ${c.lock}`; };

let sceneCache: { at: number; data: { lock: string; avoid: string; scenes: [string, string, string][] } } | null = null;
async function scenes() {
  if (sceneCache && Date.now() - sceneCache.at < 600000) return sceneCache.data;
  const { data } = await db.from("kit_resources").select("body").eq("slug", "scenes").maybeSingle();
  const parsed = data ? JSON.parse(data.body) : { lock: "", avoid: AVOID_DEFAULT, scenes: [] };
  sceneCache = { at: Date.now(), data: parsed };
  return parsed;
}

function pick(chars: Char[], name: string | undefined): Char | string {
  if (!chars.length) return "This member hasn't saved a character yet. Ask her to design one in SOS HQ → Dream Cast → Step 1 and tap Try her on.";
  const n = (name || "").trim().toLowerCase();
  const hit = chars.find((c) => c.name.toLowerCase() === n) || chars.find((c) => n && c.name.toLowerCase().includes(n));
  if (hit) return hit;
  return `I couldn't find "${name}". Saved characters: ${chars.map((c) => c.name).join(", ")}. Ask which one she means.`;
}

async function callTool(name: string, a: Record<string, unknown>, chars: Char[], uid: string): Promise<string> {
  const avoid = (await scenes()).avoid || AVOID_DEFAULT;
  switch (name) {
    case "my_characters":
      return chars.length
        ? `Saved characters:\n${chars.map((c) => `- ${c.name}${c.status === "draft" ? " (draft: not kept yet, start with try_on)" : ""}: ${c.lock.slice(0, 160)}${c.lock.length > 160 ? "…" : ""}`).join("\n")}`
        : "No saved characters yet. She can design one in SOS HQ → Dream Cast → Step 1 and tap Try her on.";
    case "character_details": {
      const c = pick(chars, a.character as string); if (typeof c === "string") return c;
      return `${refLock(c)}\n\nRules: real, unretouched look; show only ONE ${c.name}; if a requested change to ${pron(c).his} look is unclear, ask one short question first.`;
    }
    case "try_on": {
      const c = pick(chars, a.character as string); if (typeof c === "string") return c;
      const base = c.start_prompt && c.start_prompt.length > 40
        ? c.start_prompt
        : `Make a realistic photo of ${c.name}: ${c.lock}\n\nNatural photo look: real skin texture, healthy glow, flattering natural light, a warm, relaxed expression. Vertical 9:16. No text, logos or watermarks.`;
      return `If she attached her own photo (a twin), use it as the exact face reference. Otherwise make a brand-new, original person.\n\nPROMPT:\n${base}\n\nAfter the picture, ask: "Love ${c.name}, or want to change something? Just tell me, like 'shorter hair' or 'warmer skin'."`;
    }
    case "change_look": {
      const c = pick(chars, a.character as string); if (typeof c === "string") return c;
      const ch = ((a.changes as string) || "").trim(); if (!ch) return "Ask what she'd like to change.";
      return `PROMPT:\nMake a new picture of ${c.name} with these changes: ${ch}.\nKeep everything else exactly the same as the last picture of ${c.name} in this chat: same face, same person, same setting and light. ${sheetRule(c.name)}\nNatural photo look: real skin texture, flattering natural light. Vertical 9:16. No text, logos or watermarks.\n\nAfter the picture, ask: "Better? Want another change, or should I keep ${c.name} like this?" These changes are not saved until she says keep her (then call keep_character with her full updated description).`;
    }
    case "keep_character": {
      const c = pick(chars, a.character as string); if (typeof c === "string") return c;
      const d = ((a.description as string) || "").trim().replace(/\s+/g, " ");
      const upd: Record<string, unknown> = { status: "kept", updated_at: new Date().toISOString() };
      if (d.length >= 40) upd.lock = d.slice(0, 4000);
      const { error } = await db.from("characters").update(upd).eq("id", c.id).eq("user_id", uid);
      if (error) return "Couldn't save to HQ just now. Tell her to try 'keep her' again in a minute.";
      const kept = { ...c, lock: (upd.lock as string) || c.lock };
      return `Saved ✓ ${c.name} is kept in SOS HQ${upd.lock ? " with her new look" : ""}. Tell her that in one happy line.\n\nNow make her character sheet:\n${sheetPrompt(kept)}\n\nThen tell her: "Save this sheet to your phone. In every new chat, attach it and tell me the scene. 🎬"`;
    }
    case "my_shoot_list": {
      const { data } = await db.from("shoot_list").select("id,character_id,category,title,scene").eq("user_id", uid).eq("done", false).order("created_at").limit(12);
      const items = data || [];
      if (!items.length) return "Her shoot list is empty. She can add scenes in SOS HQ → Dream Cast → Step 2 (tap Add to shoot list), or ask you for ideas with find_scenes.";
      const nameOf = (id: string | null) => { const c = chars.find((x) => x.id === id); return c ? c.name : (chars.find((x) => x.status !== "draft") || chars[0])?.name || "her character"; };
      return `Shoot list (${items.length}). Show it as a short numbered list, remind her to attach her character sheet, then make them one at a time: picture_prompt kind "scene" with that character and scene text, then shoot_list_done with the id.\n\n${items.map((it, i) => `${i + 1}. id=${it.id} · ${nameOf(it.character_id)} · ${it.title}: ${it.scene}`).join("\n")}`;
    }
    case "shoot_list_done": {
      const ids = ((a.ids as string[]) || []).filter((x) => /^[0-9a-f-]{36}$/.test(x));
      if (!ids.length) return "No valid ids.";
      const { error } = await db.from("shoot_list").update({ done: true }).in("id", ids).eq("user_id", uid);
      return error ? "Couldn't mark them done. Keep going; it's fine." : `Marked ${ids.length} done ✓`;
    }
    case "my_products": {
      const { data } = await db.from("my_products").select("title,price,url,details").eq("user_id", uid).order("created_at", { ascending: false }).limit(30);
      if (!data || !data.length) return "No saved products yet. She can add them in SOS HQ → Hot Products.";
      return `Saved products:\n${data.map((p, i) => `${i + 1}. ${p.title}${p.price ? ` (${p.price})` : ""}${p.details ? `: ${p.details}` : ""}`).join("\n")}`;
    }
    case "product_video": {
      const name = ((a.product as string) || "").trim(); if (!name) return "Ask which product.";
      const { data: prods } = await db.from("my_products").select("title,price,url,details").eq("user_id", uid).limit(60);
      const n = name.toLowerCase();
      const prod = (prods || []).find((p) => p.title.toLowerCase() === n) || (prods || []).find((p) => p.title.toLowerCase().includes(n) || n.includes(p.title.toLowerCase().slice(0, 40)));
      const pname = prod ? prod.title : name;
      const facts = prod ? [prod.price ? `Price: ${prod.price}` : "", prod.details ? `What's great: ${prod.details}` : ""].filter(Boolean).join(". ") : "";
      const style = (a.style as string) || "Hands only";
      const needChar = style !== "Product only";
      let c: Char | null = null;
      if (needChar) { const pc = pick(chars, (a.character as string) || (chars.find((x) => x.status !== "draft") || chars[0])?.name); if (typeof pc === "string") return pc; c = pc; }
      const who = c ? c.name : "the product";
      const rules = `HONESTY RULES (always): ${c ? `${c.name} is an AI presenter. She shows and describes the product; she never says she owns it, used it, or got results ("I've been using", "it changed my skin").` : ""} Say what the product is and what buyers like about it, from the product title, details or what the user tells you. No health or medical claims, no fake reviews, no made-up prices or discounts. Remind the user to turn on TikTok's AI-generated label.`;
      const scene = ((a.scene as string) || "").trim();
      if (!scene) {
        return `Product: ${pname}${facts ? ` (${facts})` : ""}. Style: ${style}.\n\nSuggest exactly 10 short scene ideas for a vertical 8 to 15 second TikTok Shop video in this style (${style === "Full presenter" ? `${who} talks to the camera while showing it` : style === "Hands only" ? "only her hands with the product, no face" : "the product alone, styled in a real setting, no people"}). Mix settings (kitchen counter, vanity, car, café table, party table, bedroom closet, outdoor...). One line each, numbered. Then ask her to pick one. If you don't know what the product does, ask one short question first.\n\n${rules}`;
      }
      const look = c ? `\nWho ${c.name} is: ${c.lock}` : "";
      const sheet = c ? `ATTACH: ${c.name}'s character sheet${style === "Hands only" ? " (for skin tone and nails)" : ""} and a photo of the product if she has one.` : "ATTACH: a photo of the product if she has one.";
      return `${sheet}\n\nProduct: ${pname}${facts ? ` (${facts})` : ""}. Style: ${style}. Scene: ${scene}.${look}\n\nDo these in order:\n1. SCRIPT: a hook in the first 2 seconds, 2 or 3 short lines about the product, and a soft call to action ("Tap the orange cart to see colors and price"). Under 40 words${style === "Product only" ? ", written as on-screen text" : ""}.\n2. Make the picture now with your image tool. PROMPT: Vertical 9:16 realistic photo. ${style === "Full presenter" && c ? `${refLock(c)}\n${c.name} holds the product in ${scene}, looking at the camera.` : style === "Hands only" && c ? `Close-up of a woman's hands (same skin tone and nails as ${c.name}) holding and showing the product in ${scene}. No face.` : `The product alone, styled in ${scene}. No people.`} If she attached a product photo, copy the product exactly: same shape, colors, label and logo. ${avoid}\n3. VIDEO PROMPT in a code box (under 80 words, for her video app): starts from that picture, 8 seconds, natural small movements${style === "Full presenter" && c ? `, ${c.name} says the script lines` : ""}, the product stays the same and never changes shape, natural sound, no music, no text on screen.\n4. CAPTION with 3 to 5 hashtags.\n\n${rules}`;
    }
    case "video_prompt": {
      const c = pick(chars, a.character as string); if (typeof c === "string") return c;
      const act = ((a.action as string) || "moves naturally in this moment, with small real movements").trim();
      const line = ((a.line as string) || "").trim();
      return `HOW: In her video app (Google Flow or another), start a new clip from this picture, paste the prompt, and make it.\n\nVIDEO PROMPT (for her video app, not an image):\nVertical 9:16 video, 8 seconds, starting from this exact picture. Keep ${c.name}'s face, hair and outfit exactly the same. ${c.name} ${act}. Natural small movements, a slow camera push-in.${line ? ` ${c.name} says: "${line}"` : ""} Natural background sound, no music, no text on screen.\n\nPut the prompt in a code box so she can copy it.`;
    }
    case "picture_prompt": {
      const c = pick(chars, a.character as string); if (typeof c === "string") return c;
      const p = pron(c);
      const kind = a.kind as string;
      if (kind === "character_sheet") {
        return `ATTACH FIRST: ${c.name}'s best picture.\n\nPROMPT:\nCreate a professional character reference sheet of this exact person, ${c.name}. One wide 16:9 image on a plain light gray background, laid out like this:\n- Top row: 4 full-body views of ${c.name} standing relaxed: front, left side, right side and back.\n- Bottom left: 2 face close-ups: straight on, and three-quarter.\n- Right side: a clean panel with the name "${c.name}" at the top and short labeled lines: age, face shape, skin tone and undertone, eyes, nose, lips, brows, hair, body type, makeup, and any jewelry or piercings (say which side).\n\nIt is the SAME person in every view. Keep the face, skin tone, hair, makeup, body shape and proportions exactly the same as the attached picture. Do not beautify or change ${p.his} age.\nSame plain fitted black top and pants and white sneakers in every view. Soft even studio light, calm expression with a slight smile. No props, no logos, no watermark. Spell every word clearly.\n\nWho ${c.name} is: ${c.lock}\n\nBefore making it: if anything about ${p.his} look is unclear or doesn't match the picture, ask up to 2 short questions first.`;
      }
      if (kind === "outfit") {
        const out = a.result === "new_sheet"
          ? `Make a new character sheet of ${c.name} wearing this outfit: 4 full-body views (front, left side, right side and back) and 2 face close-ups, on a plain light gray background. Wide 16:9.`
          : `Make one full-body picture of ${c.name} wearing this outfit, standing relaxed on a clean white background. Soft, even studio light. Vertical 9:16.`;
        return `ATTACH: picture 1 = ${c.name}'s character sheet, picture 2 = the outfit picture.\n\nPROMPT:\nPicture 1 = ${c.name}'s picture or character sheet. ${refLock(c)}\n\nPicture 2 = an outfit. Use it ONLY for the clothes: same style, colors, fabric and details, shoes too if they show. Never copy the face, body or identity of anyone in it.\n\n${out}\n\nReal, unretouched look. No text, logos or watermarks.`;
      }
      if (kind === "two_characters") {
        const b = pick(chars, a.second_character as string); if (typeof b === "string") return b;
        if (b.id === c.id) return "Pick two different characters.";
        const what = ((a.scene as string) || "talking together, both clearly in frame").trim();
        return `ATTACH: picture 1 = ${c.name}'s character sheet, picture 2 = ${b.name}'s character sheet.\n\nPROMPT:\nPicture 1 = ${c.name}'s character sheet. Picture 2 = ${b.name}'s character sheet. Each sheet shows ONE person from several angles.\n\nMake one picture with exactly TWO people: ${c.name} (from picture 1) and ${b.name} (from picture 2). Keep each person's face, skin tone, hair and body exactly like their own sheet. Don't mix their features. No extra people.\n\n${c.name}: ${c.lock}\n${b.name}: ${b.lock}\n\nScene: ${what}.\n\nReal and cinematic, natural light, like a still from a TV drama. Vertical 9:16. No text, logos or watermarks.`;
      }
      const scene = ((a.scene as string) || "").trim();
      if (!scene) return `Ask where ${c.name} is and what ${p.he}'s doing, or call find_scenes for ideas.`;
      return `ATTACH: ${c.name}'s character sheet (or best picture).\n\nPROMPT:\n${refLock(c)}\n\nSCENE: ${scene}. Fill in natural, believable details (setting, light, pose, expression) that fit this scene.\n\n${avoid}`;
    }
    case "plan_video": {
      const c = pick(chars, a.character as string); if (typeof c === "string") return c;
      const n = [3, 5, 7].includes(Number(a.scenes)) ? Number(a.scenes) : 3;
      const secs = ({ 3: 15, 5: 30, 7: 30 } as Record<number, number>)[n];
      const style = (a.style as string) || "Product video (UGC)";
      const idea = ((a.idea as string) || "a simple, relatable everyday moment").trim();
      return `ATTACH: ${c.name}'s character sheet.\n\nPLAN (do these steps in order):\nPlan a vertical video, about ${secs} seconds, in ${n} scenes, starring ${c.name}.\nIdea: ${idea}\nKind of video: ${style}\nWho ${c.name} is: ${c.lock}\n\nStep 1. Write the storyboard. For each scene give: scene number and seconds; Visual (what we see); Camera (close-up, wide, slow push-in...); POV (whose eyes we see it through); Action (what moves or happens); Line (what ${c.name} says, one short sentence, if anything). Keep it simple and real. Nothing appears or disappears. ${c.name} looks exactly like the sheet in every scene. ${sheetRule(c.name)}\n\nStep 2. Make ONE storyboard picture: all ${n} scenes in a numbered grid of small vertical frames, the same ${c.name} in every frame.\n\nStep 3. For each scene give a Picture prompt (to make that scene's starting picture of ${c.name}) and a Video prompt (under 80 words, vertical 9:16, starts from that picture, natural small movements, natural sound, no music, no text on screen). Put each prompt in a code box.\n\nThen offer: "Say 'Make the scene 1 picture' and we'll go scene by scene. Most video apps make 8-second clips; trim each to its best few seconds."`;
    }
    case "find_scenes": {
      const lib = await scenes();
      const q = ((a.search as string) || "").toLowerCase().trim();
      const words = q.split(/\s+/).filter(Boolean);
      const pool = lib.scenes.filter((s) => s[0] !== "Start here" && s[0] !== "Mini Story");
      let hits = words.length ? pool.filter((s) => words.every((w) => (s[0] + " " + s[1] + " " + s[2]).toLowerCase().includes(w))) : pool;
      if (!hits.length && words.length) hits = pool.filter((s) => words.some((w) => (s[0] + " " + s[1] + " " + s[2]).toLowerCase().includes(w)));
      const lim = Math.min(Math.max(Number(a.limit) || 6, 1), 12);
      const start = words.length ? 0 : Math.floor(Date.now() / 86400000) % Math.max(pool.length, 1);
      const list = (words.length ? hits : [...pool.slice(start), ...pool.slice(0, start)]).slice(0, lim);
      if (!list.length) return "No scenes matched. Try another word, like kitchen, café, podcast, beach, office or product.";
      return `Scene ideas (${list.length}). Show them as a short numbered list; when she picks one, call picture_prompt with kind "scene" and that scene text.\n\n${list.map((s, i) => `${i + 1}. [${s[0]}] ${s[1]}: ${s[2]}`).join("\n")}`;
    }
    case "fix_picture": {
      const q = ((a.problem as string) || "").toLowerCase();
      const score = (f: [string, string]) => f[0].toLowerCase().split(/[ ,]+/).filter((w) => w.length > 2 && q.includes(w)).length;
      const best = [...FIXES].sort((x, y) => score(y) - score(x))[0];
      const fix = score(best) > 0 ? best : null;
      return fix
        ? `Fix for "${fix[0]}". Apply this to the last picture in this chat, word for word:\n${fix[1]}`
        : `Pick the closest fix and apply it to the last picture:\n${FIXES.map((f) => `- ${f[0]}: ${f[1]}`).join("\n")}`;
    }
  }
  throw new Error("unknown tool");
}

const GEN = "IMPORTANT: Create this picture brand new with your image generation tool, right now. Do NOT search the web or use stock photos (Unsplash, Pexels or any real person's photo).\n\n";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const rpcErr = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const key = url.pathname.split("/").filter(Boolean).pop() || url.searchParams.get("key") || "";
  if (req.method === "GET") {
    if (!(req.headers.get("accept") || "").includes("text/event-stream"))
      return new Response("Dream Cast is running. Add this link in ChatGPT → Plugins → + → Add custom MCP server.", { headers: { ...CORS, "Content-Type": "text/plain" } });
    return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
  }
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return new Response(null, { status: 405, headers: CORS });

  if (!/^[0-9a-f]{48}$/.test(key)) return json(rpcErr(null, -32001, "This Dream Cast link isn't complete. Copy your personal link again from SOS HQ."), 401);
  const { data: krow } = await db.from("dreamcast_keys").select("user_id").eq("key", key).maybeSingle();
  if (!krow) return json(rpcErr(null, -32001, "This Dream Cast link is no longer valid. Copy your new link from SOS HQ."), 401);

  let body: unknown;
  try { body = await req.json(); } catch { return json(rpcErr(null, -32700, "Parse error"), 400); }
  const msgs = Array.isArray(body) ? body : [body];

  let chars: Char[] | null = null;
  const loadChars = async () => {
    if (chars) return chars;
    const { data } = await db.from("characters").select("id,name,lock,status,start_prompt").eq("user_id", krow.user_id).order("created_at");
    chars = (data || []) as Char[];
    db.from("dreamcast_keys").update({ last_used_at: new Date().toISOString() }).eq("key", key).then(() => {});
    return chars;
  };

  const out: unknown[] = [];
  for (const m of msgs as { id?: unknown; method?: string; params?: Record<string, unknown> }[]) {
    if (!m || typeof m !== "object" || !m.method) continue;
    if (m.id === undefined) continue; // notification
    try {
      if (m.method === "initialize") {
        const want = (m.params?.protocolVersion as string) || VERSIONS[0];
        out.push({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "dream-cast", title: "Dream Cast", version: "1.2.0" }, instructions: INSTRUCTIONS } });
      } else if (m.method === "ping") {
        out.push({ jsonrpc: "2.0", id: m.id, result: {} });
      } else if (m.method === "tools/list") {
        out.push({ jsonrpc: "2.0", id: m.id, result: { tools: TOOLS } });
      } else if (m.method === "tools/call") {
        const name = m.params?.name as string;
        if (!TOOLS.some((t) => t.name === name)) { out.push(rpcErr(m.id, -32602, `Unknown tool: ${name}`)); continue; }
        const text = await callTool(name, (m.params?.arguments as Record<string, unknown>) || {}, await loadChars(), krow.user_id);
        const final = /PROMPT:|PLAN \(/.test(text) ? GEN + text : text;
        out.push({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: final }], isError: false } });
      } else if (m.method === "resources/list") {
        out.push({ jsonrpc: "2.0", id: m.id, result: { resources: [] } });
      } else if (m.method === "prompts/list") {
        out.push({ jsonrpc: "2.0", id: m.id, result: { prompts: [] } });
      } else {
        out.push(rpcErr(m.id, -32601, `Method not found: ${m.method}`));
      }
    } catch (e) {
      out.push({ jsonrpc: "2.0", id: m.id, result: { content: [{ type: "text", text: `Something went wrong: ${(e as Error).message}` }], isError: true } });
    }
  }
  if (!out.length) return new Response(null, { status: 202, headers: CORS });
  return json(Array.isArray(body) ? out : out[0]);
});
