/**
 * Stage: Router (Gemini 2.0 Flash)
 *
 * First step in the pipeline. Understands the thumbnail before retrieval.
 * Returns retrieval intent and interpretation hints for downstream stages.
 */

const { GoogleGenAI } = require('@google/genai');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY;

const ROUTER_SYSTEM = `You are a YouTube thumbnail analysis router.

Your ONLY job is to understand what this thumbnail is trying to communicate,
so downstream retrieval and critique stages can work with precision.

You must return ONLY a JSON object with this exact schema:

{
  "retrievalIntent": {
    "searchQuery": "one search phrase for finding similar winning thumbnails",
    "prefer": ["reference type 1", "reference type 2"],
    "avoid": ["reference type to avoid 1"]
  },
  "interpretationHints": {
    "likelyThesis": "what the thumbnail is trying to sell to the viewer",
    "likelyJudgmentFrame": "how the final critic should evaluate this (e.g. judge for emotional readability, meme recognition, cinematic quality)",
    "possibleHiddenContext": "any trend, meme, or cultural reference that might be relevant (or empty string if none)"
  },
  "confidence": 0.0
}

Rules:
- searchQuery must be ONE specific phrase, not generic. Include game name, subject description, mood, composition style.
- prefer should list 2-4 reference TYPES (e.g. "2-subject emotional scenes", "low-text cinematic compositions")
- avoid should list 1-3 reference types that would confuse the final model
- likelyJudgmentFrame tells the final model HOW to judge (emotional? comedic? cinematic? absurd?)
- confidence is 0.0-1.0 for how sure you are about your interpretation
- Return ONLY the JSON. No markdown, no explanation.`;

async function runRouter(imageUrl, title, game) {
    console.log(`[Router] Running Gemini Flash for: "${title}" (${game})`);
    const start = Date.now();

    if (!GEMINI_API_KEY) {
        console.warn('[Router] No Gemini API key found. Returning default router output.');
        return {
            result: getDefaultRouterOutput(title, game),
            _debug: { latencyMs: 0, status: 'skipped', reason: 'no_api_key' }
        };
    }

    try {
        const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

        const userPrompt = `Analyze this YouTube gaming thumbnail.
TITLE: "${title}"
GAME: ${game}

Return your JSON analysis now.`;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: ROUTER_SYSTEM + '\n\n' + userPrompt },
                        {
                            inlineData: {
                                mimeType: 'image/jpeg',
                                data: imageUrl.startsWith('data:')
                                    ? imageUrl.split(',')[1]
                                    : await fetchImageAsBase64(imageUrl)
                            }
                        }
                    ]
                }
            ],
            config: {
                temperature: 0.3,
                maxOutputTokens: 2000,
                responseMimeType: 'application/json'
            }
        });

        let content = response.text || '{}';

        // Strip markdown wrappers if present
        if (content.startsWith('```json')) {
            content = content.replace(/^```json\s*/, '').replace(/\s*```$/, '');
        } else if (content.startsWith('```')) {
            content = content.replace(/^```\s*/, '').replace(/\s*```$/, '');
        }

        try {
            const result = JSON.parse(content);
            const latencyMs = Date.now() - start;
            console.log(`[Router] OK in ${latencyMs}ms | confidence=${result.confidence || 0} | query="${result.retrievalIntent?.searchQuery || 'none'}"`);
            return {
                result,
                _debug: { latencyMs, status: 'ok', model: 'gemini-2.5-flash' }
            };
        } catch (parseErr) {
            console.error(`[Router] parse failed on content:\n${content}\n`);
            throw parseErr;
        }

    } catch (err) {
        console.error(`[Router] Gemini failed: ${err.message}`);
        throw err;
    }
}

function getDefaultRouterOutput(title, game) {
    return {
        retrievalIntent: {
            searchQuery: `${game} ${title}`.trim() || 'gaming thumbnail',
            prefer: ['high-CTR gaming thumbnails'],
            avoid: ['unrelated content']
        },
        interpretationHints: {
            likelyThesis: 'Unknown — router skipped',
            likelyJudgmentFrame: 'judge for general thumbnail effectiveness',
            possibleHiddenContext: ''
        },
        confidence: 0.1
    };
}

async function fetchImageAsBase64(url) {
    const fetch = require('node-fetch');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch image: HTTP ${res.status}`);
    const buf = await res.buffer();
    return buf.toString('base64');
}

module.exports = { runRouter };
