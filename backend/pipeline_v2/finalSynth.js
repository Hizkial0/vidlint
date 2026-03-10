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
const FINAL_DECIDER_SYSTEM = `You are "Gaming ThumbJudge" — ruthless, mobile-first, CTR obsessed.

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
- fixes: 2–5 bold, highly noticeable, and dramatic fixes. Focus on massive improvements that completely transform the appeal. NO tiny, rigid percentage tweaks - act like a creative human designer. 
- layoutOptions: 2–3 composition layout options (A/B/C), each with 2–3 moves.

Output JSON only with this schema (no extra):
{
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
  let prompt = `TITLE: ${title}\n`;
  if (context) prompt += `CONTEXT: ${context}\n`;

  const router = ragPack.routerOutput || {};
  if (router.interpretationHints) {
    prompt += `\nROUTER:\n`;
    const hints = router.interpretationHints;
    if (hints.likelyThesis) prompt += `- thesis: ${hints.likelyThesis}\n`;
    if (hints.likelyJudgmentFrame) prompt += `- frame: ${hints.likelyJudgmentFrame}\n`;
    if (hints.possibleHiddenContext) prompt += `- viewer pull: ${hints.possibleHiddenContext}\n`;
  }

  const localRefs = ragPack.topLocalRefs || [];
  if (localRefs.length > 0) {
    prompt += `\nREFS:\n`;
    localRefs.forEach(ref => {
      if (ref.reason) prompt += `- ${ref.reason}\n`;
    });
  }

  const ytRefs = ragPack.topYoutubeRefs || [];
  if (ytRefs.length > 0) {
    prompt += `\nLIVE:\n`;
    ytRefs.forEach(ref => {
      if (ref.reason) prompt += `- ${ref.reason}\n`;
    });
  }

  return prompt.trim();
}

const MODE_CONFIGS = {
  fast: {
    model: process.env.FINAL_MODEL_FAST || 'gpt-5-mini-2025-08-07',
    max_tokens: 3000
  },
  deep: {
    model: process.env.FINAL_MODEL_DEEP || 'gpt-5.2',
    reasoning_effort: 'medium',
    max_tokens: 7000
  },
  high: {
    model: process.env.FINAL_MODEL_DEEP || 'gpt-5.2',
    reasoning_effort: 'medium',
    max_tokens: 7000
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

    let content = response.choices[0]?.message?.content || '{}';
    console.log(`[V4] Raw LLM content snippet: ${content.substring(0, 500).replace(/\n/g, '\\n')}`);

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
