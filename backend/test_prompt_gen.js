require('dotenv').config();
const OpenAI = require('openai');

async function testPromptGen() {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    console.log("=== Test 1: developer role + json_schema (no image) ===");
    try {
        const resp1 = await client.chat.completions.create({
            model: "gpt-5-mini-2025-08-07",
            messages: [
                {
                    role: "developer",
                    content: "You write image-edit prompts. Return only JSON matching the schema."
                },
                {
                    role: "user",
                    content: "Write a prompt to make a GTA thumbnail more dramatic"
                }
            ],
            response_format: {
                type: "json_schema",
                json_schema: {
                    name: "thumbnail_edit_prompt",
                    strict: true,
                    schema: {
                        type: "object",
                        additionalProperties: false,
                        required: ["prompt", "negativePrompt"],
                        properties: {
                            prompt: { type: "string" },
                            negativePrompt: { type: "string" }
                        }
                    }
                }
            },
            max_completion_tokens: 2000
        });

        console.log("finish_reason:", resp1.choices?.[0]?.finish_reason);
        console.log("content:", resp1.choices?.[0]?.message?.content);
        console.log("refusal:", resp1.choices?.[0]?.message?.refusal);
        console.log("usage:", resp1.usage);
    } catch (e) {
        console.error("Test 1 FAILED:", e.message);
    }

    console.log("\n=== Test 2: system role + json_object (old pattern) ===");
    try {
        const resp2 = await client.chat.completions.create({
            model: "gpt-5-mini-2025-08-07",
            messages: [
                {
                    role: "system",
                    content: 'You write image-edit prompts. Return JSON: { "prompt": "...", "negativePrompt": "..." }'
                },
                {
                    role: "user",
                    content: "Write a prompt to make a GTA thumbnail more dramatic"
                }
            ],
            response_format: { type: "json_object" },
            max_completion_tokens: 2000
        });

        console.log("finish_reason:", resp2.choices?.[0]?.finish_reason);
        console.log("content:", resp2.choices?.[0]?.message?.content);
    } catch (e) {
        console.error("Test 2 FAILED:", e.message);
    }
}

testPromptGen();
