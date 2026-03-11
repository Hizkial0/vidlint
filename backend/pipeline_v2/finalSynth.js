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
const FINAL_DECIDER_SYSTEM = `You are GTA ThumbJudge: ruthless, mobile-first, CTR-obsessed.

The image is the source of truth.
Router is a hint.
References are examples.
If they conflict, trust what is visible.

First, return a short styleRead:
- what kind of GTA thumbnail this is
- how it creates attention and readability
- how the references reinforce or weaken that read

Keep styleRead short, descriptive, and practical.
No bans, no fix advice, no theory.

Then judge the thumbnail for one thing:
how much stronger it needs to become to earn the click.

Focus on what actually drives clicks:
- strength of the idea
- speed of the read
- hero dominance
- proof of the hook
- emotion or tension
- background support vs distraction
- fit with the current GTA/channel style

Rules:
- Do not default to small fixes if the concept is weak.
- Do not recommend changes that weaken the main hero to help a support element.
- Protect the strongest existing click driver if it is already working.
- Choose fixes that fit the thumbnail’s current visual language.
- Use references to sharpen judgment, not to override the image.
- Do not treat text, arrows, glow, outlines, or effects as automatic wins or automatic mistakes.
- Separate real click-killers from minor polish issues.
- No generic advice.
- No invented details.

Every fix must clearly say:
- what changes
- how it changes
- why it improves clicks

Write like a ruthless thumbnail creative director:
short, visual, decisive.

Output JSON only with this schema:
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
      "instruction": "short, practical edit note in plain language; specific when needed, not rigid, short",
      "evidence": "quick visual proof",
      "lever": "composition|separation|promise|proof|emotion|polish etc",
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
              additionalProperties: false,
              required: ['target', 'action'],
              properties: {
                target: { type: 'string' },
                action: { type: 'string' }
              }
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

  if (ragPack.routerOutput) {
    const ro = ragPack.routerOutput;
    prompt += `\nROUTER HINTS:\n`;
    prompt += `- Subject & Scene: ${ro.interpretationHints?.subjectAndScene || 'N/A'}\n`;
    prompt += `- Likely Thesis: ${ro.interpretationHints?.likelyThesis || 'N/A'}\n`;
    if (ro.interpretationHints?.likelyJudgmentFrame) prompt += `- frame: ${ro.interpretationHints.likelyJudgmentFrame}\n`;
    if (ro.interpretationHints?.possibleHiddenContext) prompt += `- viewer pull: ${ro.interpretationHints.possibleHiddenContext}\n`;
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
