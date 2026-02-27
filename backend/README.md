# Thumbnail Linter - Local Backend

This is the local development backend for the Thumbnail Linter application. It mimics the Cloudflare Worker architecture for easy future deployment.

## Prerequisites

- **Node.js** 18+ installed ([Download](https://nodejs.org/))
- **OpenAI API Key** ([Get one here](https://platform.openai.com/api-keys))

## Quick Start

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

```bash
# Copy the example file
cp .env.example .env

# Edit .env and add your OpenAI API key
# OPENAI_API_KEY=sk-your-actual-key-here
```

### 3. Start the Server

```bash
npm start
```

You should see:
```
🚀 Thumbnail Linter Backend running at http://localhost:8787
   POST /analyze  - Analyze a thumbnail
   GET  /health   - Health check
```

### 4. Enable in Frontend

Edit `script.js` and set:
```javascript
const API_CONFIG = {
    baseUrl: "http://localhost:8787",
    useLiveBackend: true  // <-- Change this to true
};
```

## API Endpoints

### `POST /analyze`

Analyzes a thumbnail using OpenAI Vision.

**Request Body:**
```json
{
  "mode": "finished",
  "game": "minecraft",
  "context": "100 Days Hardcore",
  "publicId": "abc123",
  "imageUrlSmall": "https://res.cloudinary.com/.../w_512/abc123",
  "retinaMetrics": {
    "brightness": 128,
    "contrastStd": 45,
    "dynRange": 180,
    "mobile": {
      "width": 360,
      "dynRange": 35,
      "edgeDensity": 0.025,
      "pass": true
    }
  }
}
```

**Response:**
```json
{
  "mode": "finished",
  "score": 87,
  "scoreColor": "#4ade80",
  "verdict": "FIX then publish",
  "weakest": ["CLARITY", "POP"],
  "metrics": [...],
  "fixes": [...],
  "comps": [...]
}
```

### `GET /health`

Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "hasApiKey": true,
  "timestamp": "2026-01-24T12:00:00.000Z"
}
```

## Troubleshooting

### "Invalid OpenAI API key"
- Check that your `.env` file exists and contains a valid key
- Ensure the key starts with `sk-`
- Verify the key has credits in your OpenAI dashboard

### "CORS error"
- Make sure the backend is running before loading the frontend
- Check that you're accessing the frontend from `http://` not `file://`

### "Backend not responding"
- Verify the server is running on port 8787
- Check for any error messages in the terminal

## Architecture

```
Frontend (browser)          Backend (Node.js)           OpenAI
     │                            │                        │
     ├─── POST /analyze ─────────>│                        │
     │    {mode, game, image...}  │                        │
     │                            ├──── Vision API ───────>│
     │                            │     (gpt-4o)           │
     │                            │<─── JSON response ─────┤
     │<─── {score, fixes...} ─────┤                        │
     │                            │                        │
```

## Next Steps (Future)

1. Add OCR analysis (word count, text area)
2. Add face detection (face ratio)
3. Add DISTS quality scoring
4. Deploy to Cloudflare Workers
