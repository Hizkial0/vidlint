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
const FINAL_DECIDER_SYSTEM = `You are Gaming ThumbJudge: ruthless, mobile-first, CTR-obsessed.

The image is the source of truth.
Router is a hint.
References are examples.
If they disagree, trust what is visible.

Judge the thumbnail for two things:
1. will it win the 1-second mobile glance?
2. is the visual idea strong enough to earn the click?

Do not default to small improvements. If the concept, proof, or focal idea is weak, recommend a bigger change.

Look for:
- one clear hero
- instant story
- strong foreground/background separation
- low clutter
- obvious focal point
- emotional or curiosity pull

Prefer high-leverage changes over polish:
crop, enlarge, isolate, remove, reposition, simplify, relight, replace, exaggerate, recolor, rotate, etc.

Use references only to borrow winning structure
Do not give generic advice.
Do not nitpick tiny polish unless it affects CTR.
Do not invent details not visible in the image.

Every fix must be a direct editor instruction:
say what changes, how to change it, and why it improves clicks.

Be harsh about weak concepts.
Favor bold moves over safe tweaks. 
Write like a sharp human thumbnail lead leaving fast edit notes:
- easy to scan
- easy to execute
- short sentences
- plain visual language
- use numbers only when truly necessary
- prefer clear actions over exact percentages
- make each fix feel like a practical suggestion, not a rigid rule

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
      "instruction": "short, practical edit note in plain language; specific when needed, not rigid",
      "evidence": "quick visual proof",
      "lever": "composition|separation|promise|proof|emotion|polish",
      "impact": "high|medium"
    }
  ],
  "layoutOptions": [
    { "label": "A", "name": "string", "goal": "string", "moves": ["string","string"] },
    { "label": "B", "name": "string", "goal": "string", "moves": ["string","string"] }
  ]
}`;

const SCORE_BUCKET_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['val', 'max', 'why'],
  properties: {
    val: { type: 'number', minimum: 0, maximum: 20 },
    max: { type: 'number', const: 20 },
    why: { type: 'string' }
  }
};

const FINAL_DECIDER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['sceneSummary', 'styleRead', 'rating', 'topProblems', 'fixes', 'layoutOptions'],
  properties: {
    sceneSummary: {
      type: 'object',
      additionalProperties: false,
      required: ['hero', 'threat', 'background', 'story', 'ignoreArtifacts'],
      properties: {
        hero: { type: 'string' },
        threat: { type: 'string' },
        background: { type: 'string' },
        story: { type: 'string' },
        ignoreArtifacts: {
          type: 'array',
          items: { type: 'string' }
        }
      }
    },
    styleRead: {
      type: 'object',
      additionalProperties: false,
      required: ['family', 'styleRead', 'referenceEffect', 'confidence'],
      properties: {
        family: { type: 'string' },
        styleRead: { type: 'string' },
        referenceEffect: {
          type: 'string',
          enum: ['reinforce', 'sharpen', 'weakly_support']
        },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    rating: {
      type: 'object',
      additionalProperties: false,
      required: ['POP', 'CLARITY', 'HOOK', 'CLEAN', 'TRUST', 'total', 'focus'],
      properties: {
        POP: SCORE_BUCKET_SCHEMA,
        CLARITY: SCORE_BUCKET_SCHEMA,
        HOOK: SCORE_BUCKET_SCHEMA,
        CLEAN: SCORE_BUCKET_SCHEMA,
        TRUST: SCORE_BUCKET_SCHEMA,
        total: { type: 'number', minimum: 0, maximum: 100 },
        focus: {
          type: 'array',
          minItems: 1,
          maxItems: 2,
          items: { type: 'string' }
        }
      }
    },
    topProblems: {
      type: 'array',
      minItems: 2,
      maxItems: 4,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['problem', 'evidence'],
        properties: {
          problem: { type: 'string' },
          evidence: { type: 'string' }
        }
      }
    },
    fixes: {
      type: 'array',
      minItems: 3,
      maxItems: 5,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['priority', 'title', 'why', 'ops', 'applyTo', 'instruction', 'evidence', 'lever', 'impact'],
        properties: {
          priority: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4', 'P5'] },
          title: { type: 'string' },
          why: { type: 'string' },
          ops: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: true
            }
          },
          applyTo: {
            type: 'array',
            items: { type: 'string' }
          },
          instruction: { type: 'string' },
          evidence: { type: 'string' },
          lever: {
            type: 'string',
            enum: ['composition', 'separation', 'promise', 'proof', 'emotion', 'polish']
          },
          impact: { type: 'string', enum: ['high', 'medium'] }
        }
      }
    },
    layoutOptions: {
      type: 'array',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'name', 'goal', 'moves'],
        properties: {
          label: { type: 'string', enum: ['A', 'B', 'C'] },
          name: { type: 'string' },
          goal: { type: 'string' },
          moves: {
            type: 'array',
            minItems: 2,
            maxItems: 3,
            items: { type: 'string' }
          }
        }
      }
    }
  }
};

function supportsStructuredOutputs(model) {
  return /gpt-5|gpt-4\.1|gpt-4o|o1|o3/i.test(model || '');
}

function getResponseFormat(model) {
  if (!supportsStructuredOutputs(model)) {
    return { type: 'json_object' };
  }

  return {
    type: 'json_schema',
    json_schema: {
      name: 'thumbnail_analysis',
      strict: true,
      schema: FINAL_DECIDER_SCHEMA
    }
  };
}

function extractMessageContent(message) {
  const raw = message?.content;
  if (typeof raw === 'string') return raw;
  if (!Array.isArray(raw)) return '';

  return raw
    .map(part => {
      if (typeof part === 'string') return part;
      if (typeof part?.text === 'string') return part.text;
      return '';
    })
    .join('')
    .trim();
}

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
      messages,
      response_format: getResponseFormat(config.model)
    };

    // Modern OpenAI SDK uses max_completion_tokens for o-series and gpt-series now
    reqPayload.max_completion_tokens = config.max_tokens || config.max_completion_tokens || 4000;

    // Add reasoning effort only if the model is an o-series
    if ((config.model.includes('o1') || config.model.includes('o3') || config.model.includes('gpt-5')) && config.reasoning_effort) {
      reqPayload.reasoning_effort = config.reasoning_effort;
    } else if (!config.model.includes('o1') && !config.model.includes('o3') && !config.model.includes('gpt-5')) {
      reqPayload.temperature = 0.28;
    }

    const response = await getOpenAI().chat.completions.create(reqPayload);

    const choice = response.choices?.[0];
    console.log(`[V4] finish_reason: ${choice?.finish_reason}, tokens: ${JSON.stringify(response.usage)}`);

    if (!choice?.message?.content && !choice?.message?.refusal) {
      console.error(`[V4] CRITICAL: OpenAI returned empty content! Full choice:`, JSON.stringify(choice));
    }

    if (choice?.message?.refusal) {
      throw new Error(`Model refusal: ${choice.message.refusal}`);
    }

    let content = extractMessageContent(choice?.message);
    if (!content) {
      throw new Error(`OpenAI returned empty content. finish_reason: ${choice?.finish_reason}`);
    }
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
    const requestMeta = [err.status, err.request_id].filter(Boolean).join(' | ');
    console.error(`[V4] Final Decider failed${requestMeta ? ` (${requestMeta})` : ''}: ${err.message}`);
    throw new Error(`Strategist failed: ${err.message}`);
  }
}

module.exports = { runFinalSynth, FINAL_DECIDER_SYSTEM };
