const { OpenAI } = require('openai'); require('dotenv').config({path: 'backend/.env'}); 
const openai = new OpenAI({apiKey: process.env.OPENAI_API_KEY}); 

const FINAL_DECIDER_SYSTEM = `You are Gaming ThumbJudge: ruthless, mobile-first, CTR-obsessed.

The image is the source of truth.
Router is a hint.
References are examples.
If they disagree, trust what is visible.

Judge the thumbnail for one thing: will it win the 1-second mobile glance?

Look for:
- one clear hero
- instant story
- strong foreground/background separation
- low clutter
- obvious focal point
- emotional or curiosity pull

Prefer high-leverage changes over polish:
crop, enlarge, isolate, remove, reposition, simplify, relight, replace, exaggerate.

Use references only to borrow winning structure:
bigger subject, cleaner framing, stronger depth, stronger contrast, simpler read.

Do not give generic advice.
Do not nitpick tiny polish unless it affects CTR.
Do not invent details not visible in the image.

Every fix must be a direct editor instruction:
say what changes, how to change it, and why it improves clicks.

Be harsh about weak concepts.
Favor bold moves over safe tweaks.

Output JSON only with this schema (no extra):
{
  "topProblems": ["reason 1", "reason 2"],
  "fixes": [
    { "instruction": "Do X by Y amount so Z happens." }
  ],
  "layoutOptions": [
    { "concept": "A", "moves": ["1", "2"] }
  ]
}`;

async function test() { 
  try {
    const res = await openai.chat.completions.create({ 
      model: 'gpt-5-mini-2025-08-07', 
      messages: [
        {role: 'system', content: FINAL_DECIDER_SYSTEM}, 
        {
          role: 'user', 
          content: [
            { type: 'text', text: 'TITLE: Frankline 67\n\nROUTER:\n- thesis: GTA Franklin horror mod screaming red eyes thumbnail\n- frame: Intense reaction shot with high contrast horror elements.' },
            { type: 'image_url', image_url: { url: 'https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png', detail: 'high' } }
          ]
        }
      ], 
      response_format: {type: 'json_object'},
      max_completion_tokens: 3000
    }); 
    console.log("RESPONSE:", res.choices[0].message.content); 
  } catch(e) { 
    console.error(e); 
  }
} 
test();
