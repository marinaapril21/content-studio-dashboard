/**
 * Prompt builders.
 *
 * Every empty-state, every Strategy/Drafts/Performance row that asks the user
 * to "run ChatGPT Work on this" calls a builder from this file. A builder:
 *
 *   1. Fetches the freshest data the prompt needs (vault posts, strategy,
 *      performance snapshot).
 *   2. Composes the full prompt body (system instructions + framework +
 *      output format).
 *   3. Splices the fetched data into a fenced ```DATA``` block.
 *
 * The customer never sees this code. They click a button. We hand them a
 * single text blob to paste into ChatGPT Work.
 *
 * NOTE: Phase 1 ships with placeholder prompt bodies. Phase 2 replaces every
 * `BODY_*` constant with the full 2-3 page "fat" prompt that has the
 * frameworks (viral hooks, buyer psychology, 2-second yes, tone of voice…)
 * baked in. The structure of the builders does not change between phases.
 */

import { fenceData } from "./fenceData";
import type { TriggerTriplet } from "./settings";

type VaultPost = {
  id: string;
  source: "self" | "competitor" | string;
  handle: string;
  type: string;
  caption: string;
  hook?: string;
  pillar?: string;
  hook_type?: string;
  likes: number | null;
  comments: number | null;
  views?: number | null;
  url?: string;
  posted_at?: string;
};

type StrategyRow = {
  pillars?: unknown[];
  voice?: unknown;
  hooks?: unknown[];
  campaigns?: unknown[];
  ica_notes?: string | null;
};

/**
 * Tagged error a builder throws when the vault has no posts. The
 * CopyPromptButton checks the message prefix to render a friendly state
 * ("Vault is empty — scrape your handle first") instead of the generic
 * "Could not copy. Try again". We keep this as a plain Error with a
 * recognizable prefix so the boundary stays a string contract — no need
 * to share a class across the client/server graph.
 */
export const EMPTY_VAULT_PREFIX = "EMPTY_VAULT:";

/**
 * fetchVault — throws EMPTY_VAULT when empty. Use for prompts that strictly
 * need scraped posts to produce anything useful (competitor patterns, hook
 * patterns, pillar extraction, performance analysis).
 */
async function fetchVault(): Promise<{ posts: VaultPost[]; scraped_at: string | null }> {
  const data = await fetchVaultSafe();
  if (!data.posts || data.posts.length === 0) {
    throw new Error(
      `${EMPTY_VAULT_PREFIX} Vault is empty. Open the Vault tab and scrape your handle first.`
    );
  }
  return data;
}

/**
 * fetchVaultSafe — never throws. Returns an empty `{ posts: [], scraped_at: null }`
 * when no scrape has run yet. Use for prompts that can still produce useful
 * output without scraped data (drafting a caption from voice + trigger
 * triplet + topic alone). Avoids the "Vault is empty" wall that blocks the
 * customer from using ChatGPT Work before they've ever scraped.
 */
async function fetchVaultSafe(): Promise<{ posts: VaultPost[]; scraped_at: string | null }> {
  try {
    const r = await fetch("/api/data?tab=vault", { cache: "no-store" });
    const j = await r.json();
    return j?.data ?? { posts: [], scraped_at: null };
  } catch {
    return { posts: [], scraped_at: null };
  }
}

async function fetchStrategy(): Promise<StrategyRow | null> {
  try {
    const r = await fetch("/api/data?tab=strategy", { cache: "no-store" });
    const j = await r.json();
    return j?.data ?? null;
  } catch {
    return null;
  }
}

async function fetchPerformance(): Promise<unknown> {
  try {
    const r = await fetch("/api/data?tab=performance", { cache: "no-store" });
    const j = await r.json();
    return j?.data ?? null;
  } catch {
    return null;
  }
}

/**
 * Pick the top-N rows by engagement for the user's own posts.
 * Engagement = likes + 4 * comments. Cheap-and-effective proxy.
 */
function topSelf(posts: VaultPost[], n = 30): VaultPost[] {
  return posts
    .filter((p) => p.source === "self")
    .sort((a, b) => ((b.likes ?? 0) + 4 * (b.comments ?? 0)) - ((a.likes ?? 0) + 4 * (a.comments ?? 0)))
    .slice(0, n)
    .map((p) => ({
      ...p,
      caption: trimCaption(p.caption ?? ""),
    }));
}

/**
 * Trim a caption to ~1200 chars and add a visible "[…trimmed]" marker.
 *
 * Why mark it: without the marker, ChatGPT Work can't tell the difference between
 * a creator who writes 90-word captions and one who writes 900-word captions
 * — both end at 1200 chars in our prompt. The marker tells ChatGPT Work "there
 * was more here, you're not seeing the whole thing" so it doesn't infer
 * fake patterns from a clean cut.
 */
function trimCaption(caption: string): string {
  if (caption.length <= 1200) return caption;
  return caption.slice(0, 1200).trimEnd() + " […trimmed]";
}

function competitorPosts(posts: VaultPost[]): VaultPost[] {
  return posts.filter((p) => p.source !== "self").slice(0, 50);
}

/* ─────────────────────────────────────────────────────────────────────
 * Prompt bodies.
 *
 * These are the "fat" framework-baked versions. Each body teaches ChatGPT Work
 * exactly what the framework is, what good output looks like, and what
 * common-AI-slop patterns to avoid. The customer pastes the whole thing
 * into ChatGPT Work; the embedded DATA block gives ChatGPT Work their real posts
 * to work from. The output schema is strict so the answer can be pasted
 * straight back into the dashboard.
 *
 * Generic on purpose — these run for any niche, not just one brand.
 * ───────────────────────────────────────────────────────────────────── */

const BODY_PILLARS = `You are a senior content strategist. From the DATA below (a creator's recent Instagram posts), extract 3 to 5 content pillars that genuinely describe what they post about.

## What a pillar is

A pillar is a recurring topic territory the creator visibly owns. Not a category, not a "vibe" — a specific subject they keep returning to with their own angle.

Test for a real pillar:
1. Can you point to 4+ posts that clearly belong to it?
2. Could a stranger guess what kind of post comes next?
3. Does the name sound like something the creator would actually say (not a brand-deck buzzword)?

## How to find them

- Read every caption end-to-end. Note the actual subject, not just the hook.
- Group by subject, not by format. A reel and a carousel about the same thing belong together.
- Merge any two groups that overlap by more than ~60%.
- If you end up with 6+ pillars, you over-split. Collapse the weakest into the others.
- If you end up with 1-2, you under-grouped. Look harder for distinct angles.

## Output rules

- name: 1 to 3 words. Plain English. The creator's own framing if you can spot it.
- description: ONE sentence. Specific. What this pillar covers + what makes the creator's take on it different.
- color: hex. Pick warm, readable tones. Use distinct hues across pillars.
- share: 0..1, sums to roughly 1.0 across all pillars.

## Forbidden

- Generic marketing words: "lifestyle content", "value-driven posts", "educational content", "inspirational posts", "empowerment", "authentic", "raw".
- Buzzword pillars that fit any creator: "Mindset", "Motivation", "Tips" — only allowed if the description proves the creator's specific spin.
- Em dashes. Use commas.

## Output

Return JSON only. No prose before or after. Match this schema exactly:

\`\`\`json
[
  { "name": "Passive income", "description": "...", "color": "#741616", "share": 0.32 }
]
\`\`\``;

const BODY_VOICE = `You are a senior voice coach. From the DATA below (the creator's top-performing captions by engagement), extract the rules of their voice so any caption written using these rules sounds like them.

## What you are looking for

Voice = the patterns a reader would recognize as "this person" even with the handle removed. It shows up in:

- Sentence shape (long flowing vs short staccato; statements vs questions)
- Word choices they keep reusing (signature words, signature openers, signature closers)
- What they NEVER say (forbidden words, patterns, tones)
- The emotional register (warm vs cool, claiming vs hedging, certain vs exploratory)
- How they open (do they hook with a claim, a question, a confession, a callout?)
- How they close (CTA shape, sign-off, last line punch)

## Method

1. Read all captions. Underline every repeated pattern.
2. Distill to: 1 short tone phrase + 4 to 8 do/don't rules + signature phrases (3 to 8) + forbidden patterns (3 to 8).
3. Each rule must be CHECKABLE — "Opens with a claim, never a question" is good; "Authentic" is not.
4. Signature phrases must be VERBATIM things the creator actually wrote. Quote them.
5. Forbidden patterns are things you see them consistently avoid (em dashes, hedging language, hustle-bro talk, therapy speak, false suspense like "but here's the thing", etc.).

## Output rules

- tone: 3 to 6 adjectives separated by commas. Concrete. ("warm, declarative, direct" — not "engaging, valuable, authentic").
- rules: prescriptive imperatives. Each one should be usable as a writing rule by another writer.
- signature_phrases: verbatim quotes (or near-verbatim openers/closers they reuse).
- forbidden: patterns they avoid. Be specific about WHY a writer would feel tempted to break it.

## Forbidden

- Vague rules ("Be authentic", "Be valuable", "Connect with audience").
- Em dashes anywhere in the output.
- Calling their voice "engaging" or "authentic". Show, do not label.

## Output

Return JSON only. No prose before or after.

\`\`\`json
{
  "tone": "warm, declarative, direct",
  "rules": ["Opens with a claim, never a question", "..."],
  "signature_phrases": ["..."],
  "forbidden": ["em dash", "..."]
}
\`\`\``;

const BODY_HOOKS = `You are a viral-hook analyst. From the DATA below (top posts of the creator + their competitors), pull the 10 highest-performing hooks and explain WHY each one works.

A hook = the first line of the caption OR the first 2 seconds of the reel — the thing that stops the scroll.

## Hook type taxonomy

Classify each hook as ONE of these types. Use these exact strings:

- "contrarian": challenges a widely-held belief ("Stop posting every day.")
- "callout": names the reader by situation ("If you sell digital products and you're not posting on Sunday, read this.")
- "promise": specific outcome named upfront ("Here is exactly how I sold out my offer in 4 days.")
- "curiosity-gap": withholds the key info, forces a read ("I changed one thing about my hook and my reach 3x'd.")
- "numbered-list": "5 things…", "3 hooks…"
- "story-open": "I was sitting at my desk at 11pm when…"
- "confession": admits something uncomfortable ("I almost gave up on this offer in May.")
- "stat-shock": opens with a number that disrupts ("$0 to $47k in 8 weeks. Here is how.")
- "question": opens with a real question, not a fake one ("What if your low engagement is actually a signal you are about to break through?")

If a hook genuinely uses 2 patterns, pick the dominant one.

## Selection rules

- Rank by engagement (likes + 4*comments + 0.05*views if available).
- Across the top 10, MIX sources: at least 4 from the creator, at least 3 from competitors.
- Skip any duplicate idea — if two hooks say the same thing differently, keep the better one.

## Output rules

- text: verbatim hook line. Do not paraphrase.
- type: one of the strings above.
- source: "mine" (the creator's own) or the competitor's handle (e.g. "@themeaganhall").
- note: ONE sentence explaining the mechanism. WHY does it stop the scroll for this audience?

## Forbidden

- Made-up hooks. Only what is in the DATA.
- Em dashes.
- Generic notes ("This is engaging because it draws the reader in"). Be specific about the lever pulled.

## Output

Return JSON only. No prose before or after.

\`\`\`json
[
  { "text": "Stop posting every day.", "type": "contrarian", "source": "mine", "note": "Inverts the universal 'post daily' rule, which forces the audience that bought into that rule to read the next line." }
]
\`\`\``;

const BODY_COMPETITORS = `You are a senior competitive analyst. From the DATA below (recent posts of the creator's competitors), surface the patterns each competitor actually wins with.

You are looking for what THIS creator can ethically learn from, not a copy/paste playbook.

## What to extract per handle

For each competitor handle, surface:

1. **Best hook types** — which of these get them outsized engagement? (Use the hook taxonomy: contrarian / callout / promise / curiosity-gap / numbered-list / story-open / confession / stat-shock / question.) Rank top 2 or 3.
2. **Best formats** — reel vs carousel vs image. Which format produces their top-decile posts? Note any specific format twist (e.g. "5-slide carousels with text-only slides on cream").
3. **Recurring topics** — the 3 to 5 subjects they keep returning to. Be specific. "Mindset" is not a topic; "the moment you stop pricing for your nervous system" is.
4. **Trending hooks (verbatim)** — list 3 to 5 of their highest-engagement opening lines, copied exactly.
5. **What is replicable** — ONE sentence: what could a different creator borrow without becoming a copycat?

## Method

- Sort each handle's posts by engagement (likes + 4*comments + 0.05*views if views exist).
- Look at the top 30% of each handle's set.
- Identify what they share. A handle's "best" is whatever they do that consistently outperforms their own average, NOT the absolute biggest post.
- If a handle has fewer than 10 posts in the data, say "insufficient data" and move on.

## Output

Return one JSON object with a competitors array, one report per handle.
Use only real post IDs from DATA. Select the top 10 posts in engagement order and 3 to 5 distinct trending hooks.
The dashboard resolves IDs to original hooks, metrics and links, so do not copy or invent metrics.
Null metrics mean unknown, never zero; label incomplete rankings as provisional.
Describe only captions and known formats, never unseen video scenes or carousel designs.

Schema:
{"competitors":[{"handle":"handle_without_at","best_hook_type":"promise","best_format":"reel","analysis":{"sample_size":30,"best_hook_types":["promise"],"recurring_topics":["specific topic"],"format_notes":"What the known formats show","replicable":"A specific principle the creator can adapt","limitations":"Missing metrics or limited evidence"},"top_posts":[{"id":"actual-post-id","hook_type":"promise"}],"trending_hooks":[{"id":"actual-post-id","hook_type":"promise","note":"Why the original hook works"}]}]}

## Forbidden

- Em dashes.
- Made-up data. If you cannot tell from the DATA, say so.
- Generic recommendations ("post more"). Every line must be specific to this handle.
- Encouraging direct copying. Always frame as "what is the underlying pattern".`;

const BODY_DRAFT_CAPTION = (topic: string, trigger?: TriggerTriplet) => `You are a caption writer trained on the creator's voice (see VOICE DATA below) and their winning hook patterns (see HOOK DATA below). You also have a snapshot of what is currently working for them (see PERFORMANCE SNAPSHOT).

## Topic

${topic || (trigger?.topic ? `${trigger.topic} (linked to the trigger word ${trigger.word})` : "(no topic provided, pick the strongest underused pillar from the creator's strategy and write to it)")}${
  trigger && (trigger.offer || trigger.promise)
    ? `

## Trigger word context (LINKED to this post)

This caption is tagged with the trigger word **${trigger.word}**. The post must stay coherent with the offer it leads to and the promise the reader is told they will receive:

- Offer being teased: ${trigger.offer || "(not set)"}
- Topic the offer covers: ${trigger.topic || "(not set)"}
- Promise to the reader: ${trigger.promise || "(not set)"}

The CTA in every option MUST do two things:
1. Ask the reader to comment the trigger word "${trigger.word}".
2. Restate the promise in the creator's voice, so what the reader is "buying into" by commenting is unmistakable. Example shape: "Comment ${trigger.word} and I'll send you <thing that delivers the promise>."

The Body must stay on the topic listed above; do not drift to an unrelated pillar. The Hook should set up the topic so the CTA's promise lands.`
    : ""
}

## What you are writing

3 distinct caption options for ONE Instagram post on this topic. Each option is a complete caption + a format suggestion. The creator picks one, edits lightly, posts.

## Structure per option

For each of the 3 options, write:

- **Hook** — the first line. Scroll-stopper. In their voice. Uses one of THEIR winning hook patterns from HOOK DATA. Each option uses a DIFFERENT hook pattern (so the 3 options feel genuinely different).
- **Body** — 3 to 6 short paragraphs. Reads at a 7th-grade level. Uses their signature openers/closers. Avoids every pattern in their VOICE DATA's "forbidden" list.
- **CTA** — one specific action. Names what to do AND what the reader gets in return ("Comment WORD and I'll send you X"). Never "link in bio". Never "DM me" without a specific keyword.
- **Format** — carousel (with slide count + slide-by-slide TITLE + 1-line BODY each), or reel (with 4 to 6 beats), or single image (with a one-line visual brief).

## Hard rules

- NO em dashes anywhere. Use commas.
- NO label words ("overwhelmed", "burnout", "spiraling", "anxious", "stuck"). Write the physical scene instead ("you keep checking your phone every 3 minutes while pretending to read").
- NO staccato chains (3+ short sentences in a row). Use commas to make sentences flow.
- NO therapy-speak, no false suspense ("but here's the thing"), no hustle-bro talk, no raise-your-prices messaging unless the creator's voice explicitly uses it.
- NO generic marketing closers ("hope this helps!", "thoughts?").

## Quality bar

Each caption must pass these tests:
1. The first line could be lifted out and posted as a standalone hook — would it stop you?
2. Could a stranger reading 3 captions back to back identify it as the same person?
3. Is there ONE specific takeaway, or a vague gesture at three things?
4. Does the CTA name an action the reader can do in 5 seconds?

If any test fails, rewrite that option before returning.

## Output

Return Markdown with three numbered options. No preface, no apology, no "here are your captions" — just the three options.`;

const BODY_PERFORMANCE = `You are a senior performance analyst. From the DATA below (the creator's own scraped Instagram posts, plus their strategy pillars), produce a single JSON snapshot that the Performance tab will render.

You are NOT writing prose. You are computing aggregates a human could compute from the data, plus two interpretive classifications.

## What to compute

1. **avg_likes** — mean of \`likes\` across all posts where source = "self". Round to integer. If there are fewer than 5 self posts, set to null.
2. **followers** — only set if the DATA includes a \`followers\` field at the top level. Otherwise null.
3. **top_posts** — the 10 highest by engagement = \`likes + 4 * comments\` (comments weigh more because they are scarcer). For each post return:
   - id (verbatim from DATA)
   - caption_preview (first 110 chars of the caption, plain text)
   - hook (the first line of the caption; the scroll-stopper)
   - hook_type (see hook type taxonomy below)
   - pillar (see pillar classification below)
   - type ("carousel" | "reel" | "image" | "story" — copy from DATA if set, else infer from format hints)
   - likes, comments (numbers, verbatim)
   - views (number, only if present in DATA)
   - url (verbatim from DATA if present)
   - posted_at (ISO string, verbatim if present)
4. **best_pillar** — the pillar that appears most often across the top 10. Return the pillar NAME as a string.
5. **best_hook_type** — the hook type that appears most often across the top 10. Return the type string.
6. **pillar_breakdown** — across ALL self posts, the share each pillar holds. Array of \`{ label, share }\` where share is 0..1 and shares sum to ~1.0. Include every pillar that appears at least once.
7. **hook_breakdown** — same shape, across ALL self posts, share per hook type. Array of \`{ label, share }\` summing to ~1.0.

## Pillar classification

Use the pillars listed in STRATEGY DATA as the ONLY valid pillar names. Read each caption and classify it into exactly one of those pillars by topic match (not by tone). If a post genuinely matches none, classify it as "other" (lowercase). Never invent a new pillar name.

If the STRATEGY DATA has no pillars defined yet, classify every post as "uncategorized" and continue. The customer will revisit after running the Pillars prompt.

## Hook type taxonomy

Classify each hook as ONE of these exact strings:

- "contrarian" — challenges a widely-held belief ("Stop posting every day.")
- "callout" — names the reader by situation ("If you sell digital products and you're not posting on Sunday, read this.")
- "promise" — specific outcome named upfront ("Here is exactly how I sold out my offer in 4 days.")
- "curiosity-gap" — withholds the key info, forces a read ("I changed one thing about my hook and my reach 3x'd.")
- "numbered-list" — "5 things…", "3 hooks…"
- "story-open" — "I was sitting at my desk at 11pm when…"
- "confession" — admits something uncomfortable ("I almost gave up on this offer in May.")
- "stat-shock" — opens with a number that disrupts ("$0 to $47k in 8 weeks. Here is how.")
- "question" — opens with a real question, not a fake one ("What if your low engagement is actually a signal you are about to break through?")

If a hook genuinely fits 2, pick the dominant one. Never invent a new type.

## Forbidden

- Em dashes anywhere in the output. Use commas.
- Made-up posts. Only ids that appear in DATA.
- Made-up pillars or hook types outside the taxonomies above.
- Prose before or after the JSON.
- Refusing to answer because data is "limited". Compute with what is there and proceed.

## Output

Return JSON only. No prose, no markdown headers. Match this schema exactly. The \`scraped_at\` field must be copied verbatim from the DATA block's \`scraped_at\` so the dashboard's "last scraped" timestamp reflects when the underlying scrape actually ran, not when this analysis was pasted in:

\`\`\`json
{
  "scraped_at": "2026-05-12T14:00:00Z",
  "followers": null,
  "avg_likes": 1240,
  "best_pillar": "Passive income",
  "best_hook_type": "contrarian",
  "top_posts": [
    {
      "id": "abc123",
      "caption_preview": "First 110 chars of the caption shown to readers...",
      "hook": "Stop posting every day.",
      "hook_type": "contrarian",
      "pillar": "Passive income",
      "type": "reel",
      "likes": 4820,
      "comments": 312,
      "views": 81200,
      "url": "https://instagram.com/p/abc",
      "posted_at": "2026-05-12T14:20:00Z"
    }
  ],
  "pillar_breakdown": [
    { "label": "Passive income", "share": 0.42 },
    { "label": "Sold-out launches", "share": 0.31 },
    { "label": "Pricing", "share": 0.27 }
  ],
  "hook_breakdown": [
    { "label": "contrarian", "share": 0.34 },
    { "label": "promise", "share": 0.26 },
    { "label": "story-open", "share": 0.22 },
    { "label": "callout", "share": 0.18 }
  ]
}
\`\`\``;

/* ─────────────────────────────────────────────────────────────────────
 * Builders. Each returns a single string ready to paste into ChatGPT Work.
 * ───────────────────────────────────────────────────────────────────── */

export async function buildPillarsPrompt(): Promise<string> {
  const { posts, scraped_at } = await fetchVault();
  const recent = topSelf(posts, 30);
  return [
    "# Extract content pillars",
    BODY_PILLARS,
    fenceData("DATA (recent captions, JSON)", { posts: recent, scraped_at }),
    "Return only the JSON pillars array. Nothing else.",
  ].join("\n\n");
}

export async function buildVoicePrompt(): Promise<string> {
  const { posts, scraped_at } = await fetchVault();
  const top = topSelf(posts, 20);
  return [
    "# Extract voice rules",
    BODY_VOICE,
    fenceData("DATA (top captions by engagement)", { posts: top, scraped_at }),
    "Return only the JSON voice object. Nothing else.",
  ].join("\n\n");
}

export async function buildHooksPrompt(): Promise<string> {
  const { posts, scraped_at } = await fetchVault();
  // Normalize the source field to match the JSON schema we ask ChatGPT Work to
  // return ("mine" for the creator's own posts, "@handle" for competitors).
  // The DB stores "self" but ChatGPT Work will mirror whatever shape it sees in
  // the input — so we relabel here and the editor's parser ingests the
  // same vocab on the way back. One word, one meaning, end-to-end.
  const mine = topSelf(posts, 20).map((p) => ({ ...p, source: "mine" }));
  const comps = competitorPosts(posts).slice(0, 30);
  return [
    "# Extract hook library",
    BODY_HOOKS,
    fenceData("DATA (mine + competitors)", { mine, competitors: comps, scraped_at }),
    "Return only the JSON hooks array. Nothing else.",
  ].join("\n\n");
}

export async function buildCompetitorPrompt(): Promise<string> {
  const { posts, scraped_at } = await fetchVault();
  const comps = competitorPosts(posts);
  return [
    "# Competitor patterns",
    BODY_COMPETITORS,
    fenceData("DATA (competitor posts)", { posts: comps, scraped_at }),
  ].join("\n\n");
}

export async function buildPerformanceAnalysisPrompt(): Promise<string> {
  // Performance analysis needs the customer's posts (the thing being analyzed)
  // AND their strategy pillars (so ChatGPT Work classifies posts against the SAME
  // taxonomy the rest of the dashboard uses, not an invented one). We use
  // fetchVault here, not fetchVaultSafe — there is no useful analysis without
  // scraped posts, so the EMPTY_VAULT throw correctly nudges the customer to
  // scrape first.
  const [{ posts, scraped_at }, strategy] = await Promise.all([
    fetchVault(),
    fetchStrategy(),
  ]);
  // Send ALL self posts (not just top 30 like buildPillarsPrompt) because
  // breakdown shares require the full denominator. Trim captions to keep the
  // prompt under model limits.
  const selfPosts = posts
    .filter((p) => p.source === "self")
    .map((p) => ({
      ...p,
      caption: trimCaption(p.caption ?? ""),
    }));
  // Strategy pillars feed the classification — pull just the names so the
  // prompt has the exact valid pillar vocabulary, no extra noise.
  const pillarNames = Array.isArray(strategy?.pillars)
    ? (strategy!.pillars as Array<Record<string, unknown>>)
        .map((p) => (typeof p.name === "string" ? p.name : ""))
        .filter((n): n is string => n.length > 0)
    : [];
  return [
    "# Analyze winners → Performance snapshot",
    BODY_PERFORMANCE,
    fenceData("STRATEGY DATA (valid pillar names)", { pillars: pillarNames }),
    fenceData("DATA (my self posts)", { posts: selfPosts, scraped_at }),
    "Return only the JSON snapshot object. Nothing else.",
  ].join("\n\n");
}

/* ─────────────────────────────────────────────────────────────────────
 * Format-specific drafting prompts (carousel, fresh hooks, story, reel).
 *
 * These mirror buildDraftCaptionPrompt but each one carries the framework
 * for ONE specific Instagram surface, so the customer gets a finished
 * artifact (slide-by-slide carousel, 10 ready hook options, story arc,
 * reel script) instead of a generic caption.
 *
 * All four use fetchVaultSafe so a brand-new install (no scrape yet) is
 * never blocked. Scraped data sweetens the output but isn't required.
 * ───────────────────────────────────────────────────────────────────── */

const BODY_CAROUSEL = (topic: string, trigger?: TriggerTriplet) => `You are a senior carousel writer trained on the creator's voice (see VOICE DATA) and their winning hook patterns (see HOOK DATA). You also have a snapshot of what is currently working for them (see PERFORMANCE SNAPSHOT).

## Topic

${topic || (trigger?.topic ? `${trigger.topic} (linked to the trigger word ${trigger.word})` : "(no topic provided, pick the strongest underused pillar from the creator's strategy and write to it)")}${
  trigger && (trigger.offer || trigger.promise)
    ? `

## Trigger word context (LINKED to this carousel)

This carousel is tagged with the trigger word **${trigger.word}**. The CTA on the final slide MUST do two things:
1. Ask the reader to comment the trigger word "${trigger.word}".
2. Restate the promise so what they're "buying into" by commenting is unmistakable. Example shape: "Comment ${trigger.word} and I'll send you <thing that delivers the promise>."

- Offer being teased: ${trigger.offer || "(not set)"}
- Topic the offer covers: ${trigger.topic || "(not set)"}
- Promise to the reader: ${trigger.promise || "(not set)"}`
    : ""
}

## What you are writing

One complete Instagram carousel on this topic, slide-by-slide, ready to paste into Canva.

## Framework

Pick ONE framework based on topic shape (declare which one you picked):

- **Master Framework** — Hook → Context → 3 to 4 Points → Proof → CTA. Default. Use for teaching, frameworks, lists, perspective-shifts.
- **Comeback Template** — Hook → What Happened → Consequences → Comeback Plan → Results → Takeaway. Use for personal story arcs, "I tried X, then Y" content, transformation reveals.

## Slide structure

- Pick a slide count between 7 and 10. Short personal hooks + tight body per slide outperform 5 long slides.
- Every slide is a TITLE + BODY pair. No slide is just a title.
  - **TITLE** — max 3 lines. The bold statement. The thing they read first.
  - **BODY** — max 5 lines. The reasoning, scene, or detail that lands the title.
- Slide 1 = hook only (title-strong, body sets up the swipe). Personal language ("I", "me", "my"). Add a micro-cliffhanger feel ("but here's the thing…", "one last thing").
- Slides 2 to N-1 = one idea per slide. Show the physical scene, never label it ("you sit down to work, don't know where to start, so you don't start at all" beats "overwhelm").
- Final slide = CTA. Specific action + what they get. Never "link in bio". Never bare "DM me".

## Caption (for the post itself)

After the slides, write a 2 to 4 sentence Instagram caption that complements the carousel (context, why it matters, CTA with the trigger keyword if one is linked).

## Hard rules

- NO em dashes anywhere. Use commas.
- NO label words ("overwhelmed", "burnout", "stuck", "spiraling", "anxious"). Scene-based copy only.
- NO staccato chains. Use commas to make sentences flow.
- NO corporate openers ("In today's market…"). NO false suspense ("but here's the thing…" unless it earns the swipe).
- Personal "I/me/my" language. Avoid "you should…" and "experts say…".
- If the topic doesn't match any pillar in VOICE DATA's pillars, flag it at the top before the slides. Do not invent a pillar.

## Output format

Print this exactly, so the customer can paste each slide into Canva:

\`\`\`
FRAMEWORK USED: [Master / Comeback]
HOOK INSPIRED BY: [winning hook from HOOK DATA, or "none"]

SLIDE 1
TITLE: [max 3 lines]
BODY: [max 5 lines]

SLIDE 2
TITLE: ...
BODY: ...

...

CAPTION:
[2 to 4 sentences for the IG post body]
\`\`\`

Then under **PART 2 · Visual direction**, give one line per slide: background tone, where the eye lands, any italic-emphasis word, photo cue if any.

No preface, no apology, just the slides + caption + visual direction.`;

const BODY_FRESH_HOOKS = (topic: string, format: string) => `You are a viral hook writer trained on the creator's voice (see VOICE DATA) and their winning hook patterns (see HOOK DATA). You also see what hook types they over-rely on in the PERFORMANCE SNAPSHOT.

## Topic

${topic || "(no topic provided, pick the strongest underused pillar from the creator's strategy and write to it)"}

## Format the hooks must fit

${format || "carousel slide 1 (max 2 lines)"}

## What you are writing

10 distinct hook options for this single topic. The customer picks the strongest one, pastes it into the carousel / reel / caption / story they're already writing.

## Frameworks (use at least 6 of the 9; label which one each hook uses)

- **Conversational** — mid-thought entry, like walking in on a friend talking.
- **Process Shift** — what actually changed, not the surface tip.
- **Vulnerability / Confessional** — admits what nobody says.
- **Internal Realization** — the moment a belief shifted.
- **Hard-Learned Lesson** — the time wasted before figuring it out.
- **Transformation** — struggle → current state, without bragging.
- **Real Talk / Truth Bomb** — challenges a commonly accepted excuse.
- **Comment-to-Trigger** — CTA as the opener, "Comment WORD…".
- **Compressed Visual-Carry** — 5 words or fewer, or pure emoji, only when the visual carries the message.

## Method

1. Read the PERFORMANCE SNAPSHOT \`hook_breakdown\`. Note which hook types are over-used (>30% share) and which are under-used.
2. Vary so the 10 options span at least 6 different frameworks. Prefer under-used types when quality is equal.
3. Each hook must:
   - Sound like the writer is texting a friend, not pitching a customer.
   - Create tension (contrast, implication, reversal, confession, or incomplete statement).
   - Match the format constraints above.
   - Use the writer's VOICE DATA tone + signature shapes. Avoid every pattern in VOICE DATA's "forbidden" list.

## Hard rules

- NO em dashes anywhere.
- NO hype openers ("You won't believe…", "Here's how to…", "This one weird trick…"). They scan as marketing.
- NO fake suspense ("but here's the thing…" without an actual thing).
- NEVER "Swipe up". NEVER "Link in bio". NEVER bare "DM me".
- Personal "I / me / my" language wins over "you should…".
- If 2 hooks end up using the same framework, replace one before returning.

## Output

Numbered Markdown list (1 to 10), each entry on 3 lines:

\`\`\`
1. [hook itself, verbatim, ready to copy]
   Framework: [one of the 9]
   Lever: [one sentence on why this stops the scroll for this audience]
\`\`\`

No preface, no apology, no "here are your hooks" — just the 10.`;

const BODY_STORY = (offer: string, trigger?: TriggerTriplet, promise = "", proof = "") => `You are a senior story writer trained on the creator's voice (see VOICE DATA). You are NOT writing a sales pitch, you are writing a friend-sharing-a-secret story sequence designed to drive a single keyword DM reply.

## Offer being teased

${offer || (trigger?.offer ?? "(no offer specified, use the trigger word's linked offer below)")}

## Trigger keyword

${trigger?.word ?? "(no keyword set, use one short distinctive word)"}

## Promise to the reader (what they get when they reply the keyword)

${promise || (trigger?.promise ?? "(no promise set, ask for one and stop)")}

## Real proof number (optional)

${proof || "(no real proof number — if you write a proof-close arc, use a clearly-marked placeholder like [REAL $ AMOUNT IN N DAYS] so the customer plugs it in)"}

## Arc options (pick one based on offer warmth)

- **Arc A · Single-slide proof close** (1 slide). Real number + emotional reaction + CTA in one overlay block. Best when proof is fresh and undeniable.
- **Arc B · Single-slide secret-share** (1 slide). Conversational opener ("Ok I actually have a way to…") + outcome promise (verb + concrete time + audience benefit) + sentence-fragment proof + CTA. Best for soft mid-feed drops.
- **Arc C · 3-slide warm + close**. Slide 1 = personal warm moment + tension. Slide 2 = the value or shift. Slide 3 = offer + CTA with keyword.
- **Arc D · 4-slide tease-bridge-offer-followup**. Slide 1 = hook. Slide 2 = bridge the value to the offer. Slide 3 = clear ask. Slide 4 = catches the hesitation.

Declare which arc you picked + WHY (one short sentence) before the overlays.

## Hard rules

- ENGLISH ONLY. Story copy is in English even if the writer chats in another language elsewhere.
- NO em dashes anywhere. Use commas or full stops.
- NO visual direction. Not in parentheses, not in brackets, not anywhere. The customer knows where to point their camera. Write TEXT ONLY.
- NO labels like "Hook:", "Proof:", "CTA:" inside the overlay text itself. Use "Overlay 1:", "Overlay 2:" as separators only.
- NO victim framing ("I was struggling until…"). Claim the outcome.
- NO hype ("You won't believe…"). Certainty, not excitement.
- Numbers are exact and real ($2,782 beats "over $2,700"). Precision = credibility.
- Product / offer name NEVER appears as the subject of sentence 1 (kills the secret-share frame). It appears in the keyword and optionally once in the proof line.
- Every CTA shape: \`Reply [KEYWORD] and I'll [verb that delivers the promise]\` (e.g. "Reply ${trigger?.word ?? "SUNDAY"} and I'll send you the link"). NEVER bare "DM me". NEVER "link in bio". NEVER "swipe up".
- One emoji max per slide, placed right after the proof number or emotional reaction. One ALL-CAPS word max per slide (the keyword OR the spike word, not both).

## Output

Print exactly this so the customer can copy each slide one at a time:

\`\`\`
ARC: [A / B / C / D] — [one-line why]

Overlay 1:
[exact words on slide]

Overlay 2:
[exact words on slide]

(...as many overlays as the arc has)
\`\`\`

No preface, no apology, no extra explanation.`;

const BODY_REEL = (topic: string, trigger?: TriggerTriplet, format = "") => `You are a senior reel writer trained on the creator's voice (see VOICE DATA) and their winning hook patterns (see HOOK DATA). You also have a snapshot of what is currently working for them (see PERFORMANCE SNAPSHOT).

## Topic

${topic || (trigger?.topic ? `${trigger.topic} (linked to the trigger word ${trigger.word})` : "(no topic provided, pick the strongest underused pillar from the creator's strategy and write to it)")}${
  trigger && (trigger.offer || trigger.promise)
    ? `

## Trigger word context (LINKED to this reel)

This reel is tagged with the trigger word **${trigger.word}**. The CTA MUST do two things:
1. Ask the reader to comment the trigger word "${trigger.word}".
2. Restate the promise. Example shape: "Comment ${trigger.word} and I'll send you <thing that delivers the promise>."

- Offer being teased: ${trigger.offer || "(not set)"}
- Topic the offer covers: ${trigger.topic || "(not set)"}
- Promise to the reader: ${trigger.promise || "(not set)"}`
    : ""
}

## Format

${format || "unsure — pick what fits the topic; default to B-roll (faster to ship, ~70% of best-performing reels)"}

## What you are writing

One complete reel script, ready to film or assemble.

## Format choice

- **B-ROLL (70% of content)** — single powerful text overlay + visual mood + trending audio. 15 to 30 seconds. No spoken voiceover. Use when the topic is a single punchy idea, a POV, a confession, a refusal, a "girl math".
- **VOICEOVER (30% of content)** — Hook (0-1s) → Problem/Desire (1-5s) → Shift (5-8s) → CTA (8-10s). Use when the topic needs teaching, transformation, or personal authority.

Declare which format you picked + WHY (one short sentence) before the script.

## If B-ROLL — output exactly this

\`\`\`
FORMAT: B-roll — [one-line why]
LIBRARY PATTERN: [POV: … / My biggest flex is… / Things I refuse to do as a woman who… / Girl math: … / I used to love X. Then I realized Y. / other]

TEXT OVERLAY:
[Single powerful statement or question. Max 7 words. Stops scroll in 1-2 seconds.]

VISUAL DIRECTION:
- Opening visual (1-2s): [scene that matches the overlay]
- Scene progression: [quick cuts or smooth flow?]
- Aesthetic: [beach sunset, luxury apartment, calm workspace, vibey coffee shop, etc.]
- Pacing: [match the audio rhythm]
- Text placement: [bottom, center, when does it appear?]

AUDIO SUGGESTION:
[Trending sound name + one line on why it works for this vibe.]

CAPTION:
[Instagram caption in the writer's voice. 2 to 4 sentences. Context, why it matters, CTA with keyword.]
\`\`\`

## If VOICEOVER — output exactly this

\`\`\`
FORMAT: Voiceover — [one-line why]

HOOK (0-1s):
[Opening line. Declarative. Specific. Stops scroll in the first second.]

PROBLEM / DESIRE (1-5s):
[Build tension or desire. Show why this matters. Storytelling or teaching, not selling.]

SHIFT / SOLUTION (5-8s):
[The promise. What changes when they take action. Claiming energy, not tentative.]

CTA (8-10s):
[Specific action: "Comment WORD and I'll send you X" — never bare "Comment WORD".]

VOICEOVER SCRIPT (word for word):
[Full spoken script written the way you'd actually say it out loud. Use commas to flow. Read it aloud to test.]

VISUAL DIRECTION:
- Pacing: [fast cuts for urgency, smooth for education]
- Aesthetic: [scene to match]
- B-roll scenes: [hands with coffee, looking out window, laptop screen, etc.]
- Text overlays: [where + which key phrases to bold]

AUDIO SUGGESTION:
[Background music at 30-50% volume that underlays the voiceover without drowning it.]

CAPTION:
[Full caption in the writer's voice. CTA with keyword.]
\`\`\`

## Hard rules

- NO em dashes anywhere. Use commas.
- NO label words ("overwhelmed", "burnout", "stuck"). Scene-based copy only.
- NO victim framing ("I was struggling until…"). "I figured out that…" or "I chose to…" instead.
- NO hype openers ("You won't believe…"). Declarative + specific.
- Declarative & certain. Warm & luxurious. "You get to have this", not "Maybe you could try".
- Personal "I / me / my" language. Drop "you should…" framing.
- Specific over general ("the friend who doesn't work but has more money" beats "passive income").

No preface, no apology, just the script.`;

export async function buildCarouselPrompt(
  topic = "",
  trigger?: TriggerTriplet
): Promise<string> {
  const [{ posts, scraped_at }, strategy, perf] = await Promise.all([
    fetchVaultSafe(),
    fetchStrategy(),
    fetchPerformance(),
  ]);
  const hasScrape = posts.length > 0;
  const top = hasScrape ? topSelf(posts, 15) : [];
  const noticeIfEmpty = hasScrape
    ? ""
    : "_No scrape data yet. You're writing from voice rules + trigger context alone. Customer can scrape their handle in the Vault tab later for sharper hooks._";
  return [
    "# Draft a carousel in my voice",
    BODY_CAROUSEL(topic, trigger),
    noticeIfEmpty,
    fenceData("VOICE DATA (my rules)", strategy),
    fenceData("HOOK DATA (my winners)", { winners: top, scraped_at }),
    fenceData("PERFORMANCE SNAPSHOT", perf),
    "Return the slide-by-slide carousel + caption + visual direction.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildFreshHooksPrompt(
  topic = "",
  format = ""
): Promise<string> {
  const [{ posts, scraped_at }, strategy, perf] = await Promise.all([
    fetchVaultSafe(),
    fetchStrategy(),
    fetchPerformance(),
  ]);
  const hasScrape = posts.length > 0;
  const top = hasScrape ? topSelf(posts, 15) : [];
  const noticeIfEmpty = hasScrape
    ? ""
    : "_No scrape data yet. You're writing from voice rules alone. Customer can scrape their handle in the Vault tab later so the under-used hook detection works._";
  return [
    "# Fresh hooks for one topic",
    BODY_FRESH_HOOKS(topic, format),
    noticeIfEmpty,
    fenceData("VOICE DATA (my rules)", strategy),
    fenceData("HOOK DATA (my winners)", { winners: top, scraped_at }),
    fenceData("PERFORMANCE SNAPSHOT", perf),
    "Return the 10 hook options as a numbered Markdown list.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildStoryPrompt(
  offer = "",
  trigger?: TriggerTriplet,
  promise = "",
  proof = ""
): Promise<string> {
  const [{ posts, scraped_at }, strategy, perf] = await Promise.all([
    fetchVaultSafe(),
    fetchStrategy(),
    fetchPerformance(),
  ]);
  const hasScrape = posts.length > 0;
  const top = hasScrape ? topSelf(posts, 15) : [];
  const noticeIfEmpty = hasScrape
    ? ""
    : "_No scrape data yet. You're writing from voice rules + trigger context alone. The story arcs still work without scraped data._";
  return [
    "# Draft an Instagram story sequence",
    BODY_STORY(offer, trigger, promise, proof),
    noticeIfEmpty,
    fenceData("VOICE DATA (my rules)", strategy),
    fenceData("HOOK DATA (my winners)", { winners: top, scraped_at }),
    fenceData("PERFORMANCE SNAPSHOT", perf),
    "Return the story arc + overlays, ENGLISH only, text only, no visual direction.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildReelPrompt(
  topic = "",
  trigger?: TriggerTriplet,
  format = ""
): Promise<string> {
  const [{ posts, scraped_at }, strategy, perf] = await Promise.all([
    fetchVaultSafe(),
    fetchStrategy(),
    fetchPerformance(),
  ]);
  const hasScrape = posts.length > 0;
  const top = hasScrape ? topSelf(posts, 15) : [];
  const noticeIfEmpty = hasScrape
    ? ""
    : "_No scrape data yet. You're writing from voice rules + trigger context alone. Customer can scrape their handle in the Vault tab later for sharper hooks._";
  return [
    "# Draft a reel script in my voice",
    BODY_REEL(topic, trigger, format),
    noticeIfEmpty,
    fenceData("VOICE DATA (my rules)", strategy),
    fenceData("HOOK DATA (my winners)", { winners: top, scraped_at }),
    fenceData("PERFORMANCE SNAPSHOT", perf),
    "Return the reel script + visual direction + caption.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function buildDraftCaptionPrompt(
  topic = "",
  trigger?: TriggerTriplet
): Promise<string> {
  // Use fetchVaultSafe so a brand-new install (no scrape yet) still gets a
  // usable prompt instead of an EMPTY_VAULT wall. Drafts can be written from
  // trigger triplet + voice rules + topic alone — scraped data sweetens the
  // output (real hook winners + real performance) but is not required.
  const [{ posts, scraped_at }, strategy, perf] = await Promise.all([
    fetchVaultSafe(),
    fetchStrategy(),
    fetchPerformance(),
  ]);
  const hasScrape = posts.length > 0;
  const top = hasScrape ? topSelf(posts, 15) : [];
  const noticeIfEmpty = hasScrape
    ? ""
    : "_No scrape data yet. You're writing from voice rules + trigger context alone. Customer can scrape their handle in the Vault tab later for sharper hooks._";
  return [
    "# Draft a caption in my voice",
    BODY_DRAFT_CAPTION(topic, trigger),
    noticeIfEmpty,
    fenceData("VOICE DATA (my rules)", strategy),
    fenceData("HOOK DATA (my winners)", { winners: top, scraped_at }),
    fenceData("PERFORMANCE SNAPSHOT", perf),
    "Return 3 captions in Markdown.",
  ]
    .filter(Boolean)
    .join("\n\n");
}
