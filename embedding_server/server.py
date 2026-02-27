from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import base64, io, os
import numpy as np
from PIL import Image

import torch
from transformers import AutoImageProcessor, AutoModel

MODEL_ID = os.getenv("VISION_MODEL_ID", "google/siglip2-base-patch16-256")

app = FastAPI()

device = "cuda" if torch.cuda.is_available() else "cpu"
processor = AutoImageProcessor.from_pretrained(MODEL_ID)
model = AutoModel.from_pretrained(MODEL_ID).to(device)
model.eval()

class EmbedRequest(BaseModel):
    image_b64: str  # base64 string, no data:image/... prefix

def decode_image(b64: str) -> Image.Image:
    try:
        raw = base64.b64decode(b64)
        return Image.open(io.BytesIO(raw)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image_b64")

def l2norm(x: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(x) + 1e-12
    return (x / n).astype(np.float32)

@torch.no_grad()
def embed_image(img: Image.Image) -> np.ndarray:
    inputs = processor(images=img, return_tensors="pt").to(device)
    with torch.no_grad():
        if hasattr(model, "get_image_features"):
            tensor = model.get_image_features(**inputs)[0]
        else:
            out = model(**inputs)
            tensor = out.last_hidden_state[:, 0, :] if hasattr(out, "last_hidden_state") else out.pooler_output[0]
            
    # Extract batch dimension so tensor is [256, 768] or [768]
    if len(tensor.shape) == 3 and tensor.shape[0] == 1:
        tensor = tensor[0]
        
    print("HUGGINGFACE TENSOR SHAPE:", tensor.shape)
    # If the model returns a sequence of patches (e.g., shape [256, 768]), pool them
    if len(tensor.shape) > 1:
        tensor = tensor.mean(dim=0)
        
    v = tensor.float().cpu().numpy().flatten()
    print("NUMPY SHAPE:", v.shape)
    return l2norm(v)

@app.get("/health")
def health():
    return {"ok": True, "model": MODEL_ID, "device": device}

@app.post("/embed")
def embed(req: EmbedRequest):
    img = decode_image(req.image_b64)

    w, h = img.size
    left = img.crop((0, 0, w // 2, h))
    right = img.crop((w // 2, 0, w, h))

    g = embed_image(img).tolist()
    l = embed_image(left).tolist()
    r = embed_image(right).tolist()

    return {
        "model": MODEL_ID,
        "dim": len(g),
        "global": g,
        "left": l,
        "right": r
    }
