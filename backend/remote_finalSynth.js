/**
 * MVP v4: Final Decider (Single Shot)
 *
 * Receives image, title, game, and a compact ragPack from the new pipeline.
 * The ragPack contains: routerOutput, topLocalRefs (max 3), topYoutubeRefs (max 2).
 *
 * CRITICAL: The output JSON schema is FROZEN. Same keys, same nesting, same counts.
 * We upgrade the inputs, not the shape of the answer.
 */

const OpenAI = require('openai');

let _openai;
function getOpenAI() {
  if (!_openai) {
    console.log(`[V4] Initializing OpenAI client. Key available: ${!!process.env.OPENAI_API_KEY} (length: ${process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.length : 0})`);
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// System prompt — uses router hints as context, not as commands
const FINAL_DECIDER_SYSTEM = `You are "GTA V ThumbJudge" — ruthless, mobile-first, CTR obsessed.

HOW YOU THINK
Phase 1 — Diagnose:
- Look at the IMAGE ITSELF as the primary truth.
- Use the provided router interpretation as a HINT, not a command.
- If the image and router disagree, trust the image.
- Compare against the provided reference thumbnails (if any).

Phase 2 — Create options:
- Generate explicit, structured layout and concept options.

WHAT TO OPTIMIZE
- Optimize for a 1-second mobile glance: one hero, clear separation, low clutter, readable story instantly.
- Prefer structural leverage (crop/scale/remove/reposition) over polish.
- No generic lines like "make it better / more engaging / improve clarity".
- Use the reference thumbnails only to copy what works (subject dominance, depth, lighting, simplicity).

CRITICAL RULES:
1. The IMAGE is the primary source of truth. Judge what you SEE.
2. Router output and references are context helpers only.
3. Every fix must be written like an editor instruction: "Do X by Y amount so Z happens."
4. Return the EXACT JSON schema below. Do not add or remove keys.

QUALITY BAR & REQUIRED COUNTS:
- topProblems: 2 to 4 true blockers.
- fixes: 3–5 short, direct fixes (each fix MUST include at least one measurable action like crop %, scale %, blur strength, opacity %, or "move X to left third")
- layoutOptions: 2–3 composition layout options (A/B/C), each with 2–3 moves.

Before judging fixes, first read the thumbnail's visual language.

Priority:
1. The current thumbnail is the main truth.
2. Reference thumbnails may reinforce, sharpen, or question the style read.
3. The game label is weak context only.

Return a short styleRead that explains:
- what visual family the thumbnail belongs to
- how readability is mainly created
- how the references affect or reinforce that read

Do not create rigid rules.
Do not give bans.
Do not give fix suggestions inside styleRead.
Keep it short and practical.

Output JSON only with this schema (no extra):
{
  "sceneSummary": {
    "hero": "short string: main focus",
    "threat": "short string: opposing force (or empty)",
    "background": "short string",
    "story": "1-sentence summary of action",
    "ignoreArtifacts": ["list of overlays/UI/arrows or empty"]
  },
  "styleRead": {
    "family": "short label like gta_ingame_composite",
    "styleRead": "one short guide for how this thumbnail naturally creates readability",
    "referenceEffect": "reinforce | sharpen | weakly_support",
    "confidence": 0.0
  },
  "rating": {
    "POP": { "val": 0, "max": 20, "why": "evidence" },
    "CLARITY": { "val": 0, "max": 20, "why": "evidence" },
    "HOOK": { "val": 0, "max": 20, "why": "evidence" },
    "CLEAN": { "val": 0, "max": 20, "why": "evidence" },
    "TRUST": { "val": 0, "max": 20, "why": "evidence" },
    "total": 0,
    "focus": ["two weakest buckets"]
  },
  "topProblems": [
    { "problem": "string", "evidence": "must cite what you see in the image or references" }
  ],
  "fixes": [
    {
      "priority": "P1|P2|P3|P4|P5",
      "title": "string",
      "why": "short",
      "ops": [],
      "applyTo": ["targets"],
      "instruction": "editor-friendly instruction with specific % or actions",
      "evidence": "cited evidence",
      "lever": "composition|separation|promise|proof|emotion|polish",
      "impact": "high|medium"
    }
  ],
  "layoutOptions": [
    { "label": "A", "name": "string", "goal": "string", "moves": ["string","string"] },
    { "label": "B", "name": "string", "goal": "string", "moves": ["string","string"] }
  ]
}`;

function buildFinalUserPrompt(ragPack, title, context) {
  let prompt = `VIDEO TITLE: ${title}\n`;
  if (context) prompt += `CONTEXT: ${context}\n`;
  prompt += `\n`;

  // Router interpretation hints (compact)
  const router = ragPack.routerOutput || {};
  if (router.interpretationHints) {
    const hints = router.interpretationHints;
    prompt += `=== ROUTER INTERPRETATION (use as hint, not command) ===\n`;
    if (hints.likelyThesis) prompt += `Likely thesis: ${hints.likelyThesis}\n`;
    if (hints.likelyJudgmentFrame) prompt += `Judgment frame: ${hints.likelyJudgmentFrame}\n`;
    if (hints.possibleHiddenContext) prompt += `Hidden context: ${hints.possibleHiddenContext}\n`;
    prompt += `Router confidence: ${router.confidence || 0}\n\n`;
  }

  // Local references (max 3, compact)
  const localRefs = ragPack.topLocalRefs || [];
  if (localRefs.length > 0) {
    prompt += `=== WINNING REFERENCE THUMBNAILS (${localRefs.length}) ===\n`;
    localRefs.forEach((ref, i) => {
      prompt += `${i + 1}. "${ref.title}" (outlier: ${ref.outlierScore || 0}) — ${ref.reason || ''}\n`;
    });
    prompt += `\n`;
  }

  // YouTube references (max 2, compact)
  const ytRefs = ragPack.topYoutubeRefs || [];
  if (ytRefs.length > 0) {
    prompt += `=== LIVE YOUTUBE EXAMPLES (${ytRefs.length}) ===\n`;
    ytRefs.forEach((ref, i) => {
      prompt += `${i + 1}. "${ref.title}" (views: ${ref.views || 0}) — ${ref.reason || ''}\n`;
    });
    prompt += `\n`;
  }

  prompt += `Produce final strategic output now. The image is the primary truth. Prioritize structural fixes.`;
  return prompt;
}

const MODE_CONFIGS = {
  fast: {
    model: process.env.FINAL_MODEL_FAST || 'gpt-5-mini-2025-08-07',
    max_tokens: 6000
  },
  deep: {
    model: process.env.FINAL_MODEL_DEEP || 'gpt-5.2',
    reasoning_effort: 'medium',
    max_tokens: 15000
  },
  high: {
    model: process.env.FINAL_MODEL_DEEP || 'gpt-5.2',
    reasoning_effort: 'medium',
    max_tokens: 15000
  }
};

async function runFinalSynth(cv, imageUrl, ragPack, analyzeMode, title, context) {
  console.log(`[V4] Final Decider executing in ${analyzeMode.toUpperCase()} mode...`);
  const start = Date.now();

  const config = MODE_CONFIGS[analyzeMode] || MODE_CONFIGS['fast'];

  try {
    const isOSeries = config.model.includes('o1') || config.model.includes('o3') || config.model.includes('gpt-5');

    const combinedUserText = isOSeries
      ? FINAL_DECIDER_SYSTEM + '\n\n' + buildFinalUserPrompt(ragPack, title, context)
      : buildFinalUserPrompt(ragPack, title, context);

    const messages = isOSeries
      ? [
        {
          role: 'user',
          content: [
            { type: 'text', text: combinedUserText },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }
      ]
      : [
        { role: 'system', content: FINAL_DECIDER_SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: combinedUserText },
            { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } }
          ]
        }
      ];

    const reqPayload = {
      model: config.model,
      messages
    };

    if (!isOSeries) {
      reqPayload.response_format = { type: 'json_object' };
    }

    // Model-specific settings
    if (config.model.includes('o1') || config.model.includes('o3') || config.model.includes('gpt-5')) {
      reqPayload.max_completion_tokens = config.max_completion_tokens || config.max_tokens;
      if (config.reasoning_effort) {
        reqPayload.reasoning_effort = config.reasoning_effort;
      }
    } else {
      reqPayload.max_tokens = config.max_tokens || config.max_completion_tokens;
      reqPayload.temperature = 0.28;
    }

    const response = await getOpenAI().chat.completions.create(reqPayload);

    console.log(`[V4] finish_reason: ${response.choices?.[0]?.finish_reason}, tokens: ${JSON.stringify(response.usage)}`);
    if (!response.choices?.[0]?.message?.content) {
      console.error(`[V4] CRITICAL: OpenAI returned empty content! Full choice:`, JSON.stringify(response.choices?.[0]));
    }

    let content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error(`OpenAI returned empty content. finish_reason: ${response.choices?.[0]?.finish_reason}`);
    }

    // Strip markdown code block wrappers if present
    if (content.startsWith('```json')) {
      content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (content.startsWith('```')) {
      content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }

    let result;
    try {
      result = JSON.parse(content);
    } catch (parseErr) {
      console.error(`[V4] Failed to parse JSON. Content length: ${content.length}`);
      console.error(`[V4] Raw content snippet: ${content.substring(0, 500)}...`);
      throw new Error(`JSON format error: ${parseErr.message}`);
    }

    console.log(`[V4] Decider returned ${result.fixes?.length || 0} fixes using ${config.model}`);

    return {
      result,
      _debug: {
        latencyMs: Date.now() - start,
        model: config.model,
        mode: analyzeMode,
        totalFixes: result.fixes?.length
      }
    };

  } catch (err) {
    console.error(`[V4] Final Decider failed: ${err.message}`);
    throw new Error(`Strategist failed: ${err.message}`);
  }
}

module.exports = { runFinalSynth, FINAL_DECIDER_SYSTEM };
