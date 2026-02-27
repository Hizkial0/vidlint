"""
Thumbnail Analyzer Service - v2 with Region Anchors

Returns:
- signals: CV metrics (mobile, ocr, objects, style, saliency)
- regions: Detected regions with stable IDs for LLM targeting

Models:
- OpenCV: Mobile readability (dynRange, edgeDensity)
- EasyOCR: Text detection with bounding boxes
- YOLO11s: Object detection (hero, faces)
- SigLIP: Style classification
- OpenCV Saliency: Visual clutter
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import numpy as np
import cv2
import requests
from io import BytesIO
from PIL import Image
import logging
from typing import Optional, List
import threading
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import os
import threading
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
import os

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Thumbnail Analyzer", version="2.0.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ============================================================
# LAZY LOADING - Models loaded on first use
# ============================================================
_ocr_reader = None
_yolo_model = None
_siglip_model = None
_siglip_processor = None
_face_landmarker = None
_landmarker_lock = threading.Lock()

def get_ocr():
    """Lazy load EasyOCR"""
    global _ocr_reader
    if _ocr_reader is None:
        try:
            print("DEBUG: importing easyocr", flush=True)
            import easyocr
            print("DEBUG: Loading EasyOCR model...", flush=True)
            logger.info("Loading EasyOCR...")
            _ocr_reader = easyocr.Reader(['en'], gpu=False)
            logger.info("EasyOCR loaded.")
        except Exception as e:
            logger.error(f"EasyOCR init failed: {e}")
            print(f"DEBUG: EasyOCR init failed: {e}", flush=True)
            raise RuntimeError(f"EasyOCR Init Failed: {e}")
    return _ocr_reader

def get_yolo():
    """Lazy load YOLO11s"""
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO
        logger.info("Loading YOLO11s...")
        _yolo_model = YOLO("yolo11s.pt")
        logger.info("YOLO11s loaded.")
    return _yolo_model

def get_siglip():
    """Lazy load SigLIP"""
    global _siglip_model, _siglip_processor
    if _siglip_model is None:
        from transformers import AutoProcessor, AutoModel
        import torch
        logger.info("Loading SigLIP...")
        model_name = "google/siglip-base-patch16-224"
        _siglip_processor = AutoProcessor.from_pretrained(model_name)
        _siglip_model = AutoModel.from_pretrained(model_name)
        _siglip_model.eval()
        if torch.cuda.is_available():
            _siglip_model = _siglip_model.cuda()
        logger.info("SigLIP loaded.")
    return _siglip_model, _siglip_processor

def get_face_landmarker():
    """Lazy load MediaPipe Face Landmarker (Thread-safe)"""
    global _face_landmarker
    if _face_landmarker is None:
        with _landmarker_lock:
            if _face_landmarker is None:
                logger.info("Loading Face Landmarker (Surgical)...")
                base_options = python.BaseOptions(
                    model_asset_path=os.path.join(os.path.dirname(__file__), 'assets', 'face_landmarker.task')
                )
                options = vision.FaceLandmarkerOptions(
                    base_options=base_options,
                    running_mode=vision.RunningMode.IMAGE,
                    num_faces=5,
                    min_face_detection_confidence=0.5,
                    min_face_presence_confidence=0.5,
                    output_face_blendshapes=True
                )
                _face_landmarker = vision.FaceLandmarker.create_from_options(options)
                logger.info("Face Landmarker loaded.")
    return _face_landmarker



# ============================================================
# REQUEST / RESPONSE MODELS
# ============================================================
class AnalyzeRequest(BaseModel):
    imageUrlSmall: str

class MobileSignals(BaseModel):
    dynRange: float
    edgeDensity: float
    passed: bool

class OcrSignals(BaseModel):
    wordCount: int
    textAreaPct: float
    minTextPxMobile: float
    medianTextPxMobile: float
    timestampOverlap: bool

class ObjectSignals(BaseModel):
    heroAreaRatio: float
    objectCount: int
    faceCount: int  # NEW: Number of faces detected

class StyleSignals(BaseModel):
    authenticGameplay: float
    renderLike: float
    uiHeavy: float
    available: bool = True

class SaliencySignals(BaseModel):
    peaks: int
    mapW: int = 0         # Width of saliency map (128)
    mapH: int = 0         # Height of saliency map
    map128: List[float] = []  # Flattened saliency heatmap (0-1), row-major

# Region model for LLM targeting (strict: no synthetics)
class Region(BaseModel):
    id: str              # Stable ID: "hero_1", "text_1", "face_1", etc.
    type: str            # "hero", "text", "face", "object", "person"
    x: float             # Normalized 0-1 (left)
    y: float             # Normalized 0-1 (top)
    w: float             # Normalized 0-1 (width)
    h: float             # Normalized 0-1 (height)
    pos: str             # Human readable: "center-left", "top-right", etc.
    displayName: Optional[str] = None  # Human label: "left face", "bottom title"
    conf: Optional[float] = None  # Confidence score
    text: Optional[str] = None    # For text regions only
    label: Optional[str] = None   # YOLO class label
    isSuppressed: bool = False    # Anti-ghosting: True if redundant
    source: Optional[str] = None  # "yolo" | "mediapipe" | "easyocr"
    synthetic: bool = False       # MUST always be False in strict mode
    # Role metadata for LLM grounding
    role: Optional[str] = None        # "hero" | "hook" | "stealer" | "support"
    areaRatio: Optional[float] = None # bbox area / frame (0-1)
    centerDist: Optional[float] = None # distance from center (0-1)
    whyChosen: Optional[str] = None   # reason for selection (for debugging)

class SignalsResponse(BaseModel):
    mobile: MobileSignals
    ocr: OcrSignals
    objects: ObjectSignals
    style: StyleSignals
    saliency: SaliencySignals

# Face Data for grounding hooks
class FaceData(BaseModel):
    exists: bool
    count: int
    areaRatio: float  # Largest face area / image area
    largestFacePos: Optional[str] = None

# Typed anchor/quality/metrics models (no loose dicts)
class AnchorsModel(BaseModel):
    hero_1: Optional[Region] = None
    hook_1: Optional[Region] = None
    stealer_1: Optional[Region] = None

class QualityModel(BaseModel):
    anchorCompleteness: float  # = (# non-null anchors among hero/hook/stealer) / 3
    status: str                # "READY_FOR_FIX" | "REDESIGN_REQUIRED"

class DerivedMetricsModel(BaseModel):
    hero_area_ratio: Optional[float] = None
    hero_center_dist: Optional[float] = None       # euclidean(center(hero), center(frame)), [0, 0.707]
    hero_bg_contrast: Optional[float] = None        # ring-mask luminance delta
    hero_saliency_share: Optional[float] = None     # % of total saliency in hero bbox
    hook_saliency_share: Optional[float] = None
    attention_competition: Optional[float] = None   # max_nonhero_sal / max(hero_sal, 1e-6)
    hero_hook_iou: Optional[float] = None
    text_present: bool = False
    min_text_px_mobile: Optional[float] = None
    timestamp_overlap: bool = False
    authentic_gameplay: Optional[float] = None

class DebugInfo(BaseModel):
    facesDetectedRaw: int
    facesKept: int
    facesReturned: int
    suppressedBodiesCount: int
    suppressedBodyId: Optional[str] = None
    containmentFace1BodyBest: Optional[float] = None
    faceAreasSorted: bool
    faceAreaRatios: List[float]
    paddingBucket: Optional[str] = None
    warnings: List[str]

class AnalyzeResponse(BaseModel):
    signals: SignalsResponse
    regions: List[Region]            # real detected regions only
    anchors: AnchorsModel
    missing: List[str]               # ["hero_1", "hook_1"] if null
    quality: QualityModel
    derivedMetrics: DerivedMetricsModel
    imageDims: dict
    faceData: Optional[FaceData] = None
    debug: Optional[DebugInfo] = None

# ============================================================
# HELPER FUNCTIONS
# ============================================================
def compute_center_dist(region: Region) -> float:
    cx = region.x + region.w / 2
    cy = region.y + region.h / 2
    dx = cx - 0.5
    dy = cy - 0.5
    return (dx**2 + dy**2) ** 0.5

def compute_iou(r1: Region, r2: Region) -> float:
    if not r1 or not r2: return 0.0
    
    x1 = max(r1.x, r2.x)
    y1 = max(r1.y, r2.y)
    x2 = min(r1.x + r1.w, r2.x + r2.w)
    y2 = min(r1.y + r1.h, r2.y + r2.h)
    
    if x2 <= x1 or y2 <= y1:
        return 0.0
        
    intersection = (x2 - x1) * (y2 - y1)
    area1 = r1.w * r1.h
    area2 = r2.w * r2.h
    union = area1 + area2 - intersection
    
    return intersection / union if union > 0 else 0.0
def download_image(url: str) -> np.ndarray:
    """Download image from URL and return as OpenCV BGR array"""
    response = requests.get(url, timeout=15)
    response.raise_for_status()
    img_pil = Image.open(BytesIO(response.content)).convert("RGB")
    img_np = np.array(img_pil)
    return cv2.cvtColor(img_np, cv2.COLOR_RGB2BGR)

def get_position_label(cx: float, cy: float) -> str:
    """Convert normalized center coordinates to human-readable position"""
    v = "top" if cy < 0.33 else ("bottom" if cy > 0.66 else "center")
    h = "left" if cx < 0.33 else ("right" if cx > 0.66 else "center")
    if v == "center" and h == "center":
        return "center"
    return f"{v}-{h}"



def generate_display_name(region_type: str, pos: str, index: int, text: str = None) -> str:
    """Generate human-readable display name for region.
    
    Rules:
    - faces: "left face", "right face" by position
    - persons/heroes: "left character", "center subject"
    - text: "bottom title", "center sign", "top text" by y position
    - objects: use label if available, else "object N"
    """
    # Extract vertical position
    is_bottom = "bottom" in pos
    is_top = "top" in pos
    is_left = "left" in pos
    is_right = "right" in pos
    
    if region_type == 'face':
        if is_left: return "left face"
        elif is_right: return "right face"
        else: return "center face"
    
    elif region_type in ('person', 'hero'):
        if is_left: return "left character"
        elif is_right: return "right character"
        else: return "center subject"
    
    elif region_type == 'text':
        if is_bottom: return "bottom title"
        elif is_top: return "top text"
        else: return "center sign"
    
    else:  # object
        return f"object {index}"

def compute_saliency_share(region, saliency_map: np.ndarray) -> float:
    """Compute % of total saliency contained in this region's bbox.
    
    Formula: sum(saliency[region_bbox]) / sum(saliency_total)
    region coords are normalized 0-1, saliency_map is HxW float32.
    """
    if saliency_map is None or saliency_map.size == 0:
        return 0.0
    
    h, w = saliency_map.shape[:2]
    total_sal = saliency_map.sum()
    if total_sal < 1e-6:
        return 0.0
    
    # Convert normalized coords to pixel coords
    x1 = max(0, int(region.x * w))
    y1 = max(0, int(region.y * h))
    x2 = min(w, int((region.x + region.w) * w))
    y2 = min(h, int((region.y + region.h) * h))
    
    if x2 <= x1 or y2 <= y1:
        return 0.0
    
    region_sal = saliency_map[y1:y2, x1:x2].sum()
    return round(float(region_sal / total_sal), 4)

def compute_hero_bg_contrast(img: np.ndarray, hero) -> float:
    """Ring-mask hero-background contrast.
    
    Formula: |mean_luminance(hero_bbox) - mean_luminance(ring_around_hero)|
    Ring = expanded hero bbox (1.5x) minus hero bbox, clipped to frame.
    Returns delta in [0, 255].
    """
    if hero is None:
        return 0.0
    
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY).astype(np.float32)
    
    # Hero bbox in pixels
    hx1 = max(0, int(hero.x * w))
    hy1 = max(0, int(hero.y * h))
    hx2 = min(w, int((hero.x + hero.w) * w))
    hy2 = min(h, int((hero.y + hero.h) * h))
    
    hero_crop = gray[hy1:hy2, hx1:hx2]
    if hero_crop.size == 0:
        return 0.0
    hero_mean = hero_crop.mean()
    
    # Ring = expanded bbox (1.5x) minus hero bbox
    expand = 0.25  # 25% expansion in each direction
    rx1 = max(0, int((hero.x - hero.w * expand) * w))
    ry1 = max(0, int((hero.y - hero.h * expand) * h))
    rx2 = min(w, int((hero.x + hero.w * (1 + expand)) * w))
    ry2 = min(h, int((hero.y + hero.h * (1 + expand)) * h))
    
    # Create ring mask
    ring_mask = np.zeros((h, w), dtype=bool)
    ring_mask[ry1:ry2, rx1:rx2] = True
    ring_mask[hy1:hy2, hx1:hx2] = False  # Remove hero interior
    
    ring_pixels = gray[ring_mask]
    if ring_pixels.size == 0:
        return 0.0
    ring_mean = ring_pixels.mean()
    
    return round(float(abs(hero_mean - ring_mean)), 2)

def build_region_graph_strict(all_regions: List[Region], saliency_map: np.ndarray = None) -> dict:
    """Strict Region Graph — no fallbacks, no synthetics.
    
    Returns {anchors: {hero_1, hook_1, stealer_1}, missing: [...], regions: [...]}
    If an anchor is not found, it is None and added to missing.
    """
    # --- HERO SELECTION (strict priority) ---
    # Priority 1: Largest face with area >= 0.06
    face_candidates = [r for r in all_regions 
                       if r.type == 'face' and not r.isSuppressed]
    face_candidates.sort(key=lambda r: r.w * r.h, reverse=True)
    
    hero_1 = None
    for c in face_candidates:
        area = c.w * c.h
        if area >= 0.06:
            hero_1 = Region(
                id="hero_1", type=c.type,
                x=c.x, y=c.y, w=c.w, h=c.h,
                pos=c.pos, displayName=c.displayName or "main subject",
                conf=c.conf, label=c.label, source=c.source,
                role="hero",
                areaRatio=round(area, 4),
                centerDist=round(compute_center_dist(c), 4),
                whyChosen=f"largest face with area {area:.2%}"
            )
            break
    
    # Priority 2: Largest person/hero object with area >= 0.08
    if hero_1 is None:
        obj_candidates = [r for r in all_regions 
                          if r.type in ('hero', 'person') and not r.isSuppressed]
        obj_candidates.sort(key=lambda r: r.w * r.h, reverse=True)
        for c in obj_candidates:
            area = c.w * c.h
            if area >= 0.08:
                hero_1 = Region(
                    id="hero_1", type=c.type,
                    x=c.x, y=c.y, w=c.w, h=c.h,
                    pos=c.pos, displayName=c.displayName or "main subject",
                    conf=c.conf, label=c.label, source=c.source,
                    role="hero",
                    areaRatio=round(area, 4),
                    centerDist=round(compute_center_dist(c), 4),
                    whyChosen=f"largest {c.type} with area {area:.2%}"
                )
                break
    
    # Priority 3: null (NO FALLBACK)
    
    # --- HOOK SELECTION (strict, all guards must pass) ---
    hero_source_id = None
    if hero_1 is not None:
        # Track which original region became the hero
        hero_source_id = next(
            (r.id for r in all_regions 
             if r.x == hero_1.x and r.y == hero_1.y and r.w == hero_1.w and r.h == hero_1.h),
            None
        )
    
    # Type priority: object/person first, then text
    hook_candidates_primary = [r for r in all_regions 
                               if r.type in ('object', 'hero', 'person')
                               and r.id != hero_source_id
                               and not r.isSuppressed]
    hook_candidates_text = [r for r in all_regions
                            if r.type == 'text'
                            and not r.isSuppressed]
    hook_candidates = hook_candidates_primary + hook_candidates_text
    hook_candidates.sort(key=lambda r: r.w * r.h, reverse=True)
    
    hook_1 = None
    for c in hook_candidates:
        area = c.w * c.h
        if area < 0.02:
            continue  # Too small
        
        # IoU check (only if hero exists)
        if hero_1 is not None:
            iou = compute_iou(hero_1, c)
            if iou > 0.45:
                continue  # Too overlapped
            
            # Distance guard: center distance from hero >= 0.08
            hero_cx = hero_1.x + hero_1.w / 2
            hero_cy = hero_1.y + hero_1.h / 2
            cand_cx = c.x + c.w / 2
            cand_cy = c.y + c.h / 2
            dist = ((hero_cx - cand_cx)**2 + (hero_cy - cand_cy)**2)**0.5
            if dist < 0.08:
                continue  # Too close to hero
        else:
            iou = 0.0
        
        # Saliency share check
        sal_share = compute_saliency_share(c, saliency_map) if saliency_map is not None else 0.1
        if sal_share < 0.08 and saliency_map is not None:
            continue  # Not attention-worthy
        
        hook_1 = Region(
            id="hook_1", type=c.type,
            x=c.x, y=c.y, w=c.w, h=c.h,
            pos=c.pos, displayName=c.displayName or "hook element",
            conf=c.conf, label=c.label, text=c.text, source=c.source,
            role="hook",
            areaRatio=round(area, 4),
            centerDist=round(compute_center_dist(c), 4),
            whyChosen=f"{c.type} area={area:.2%}, IoU={iou:.2f}, sal={sal_share:.2f}"
        )
        break
    
    # --- STEALER SELECTION ---
    used_source_ids = set()
    if hero_source_id:
        used_source_ids.add(hero_source_id)
    if hook_1 is not None:
        hook_source_id = next(
            (r.id for r in all_regions 
             if r.x == hook_1.x and r.y == hook_1.y and r.w == hook_1.w and r.h == hook_1.h),
            None
        )
        if hook_source_id:
            used_source_ids.add(hook_source_id)
    
    stealer_candidates = [r for r in all_regions 
                          if r.id not in used_source_ids 
                          and not r.isSuppressed]
    stealer_candidates.sort(key=lambda r: r.w * r.h, reverse=True)
    
    stealer_1 = None
    for c in stealer_candidates:
        sal_share = compute_saliency_share(c, saliency_map) if saliency_map is not None else 0.0
        if sal_share >= 0.10 or (saliency_map is None and (c.w * c.h) > 0.05):
            stealer_1 = Region(
                id="stealer_1", type=c.type,
                x=c.x, y=c.y, w=c.w, h=c.h,
                pos=c.pos, displayName=c.displayName or "distraction",
                conf=c.conf, label=c.label, source=c.source,
                role="stealer",
                areaRatio=round(c.w * c.h, 4),
                centerDist=round(compute_center_dist(c), 4),
                whyChosen=f"largest non-anchor, sal_share={sal_share:.2f}"
            )
            break
    
    # --- BUILD MISSING LIST ---
    missing = []
    if hero_1 is None:
        missing.append("hero_1")
    if hook_1 is None:
        missing.append("hook_1")
    if stealer_1 is None:
        missing.append("stealer_1")
    
    # --- BUILD CLEAN REGION LIST (real only, with role metadata) ---
    final_regions = []
    seen_ids = set()
    for r in all_regions:
        if not r.isSuppressed and r.id not in seen_ids:
            r.role = r.role or "support"
            r.areaRatio = round(r.w * r.h, 4)
            r.centerDist = round(compute_center_dist(r), 4)
            r.whyChosen = r.whyChosen or f"detected {r.type}"
            final_regions.append(r)
            seen_ids.add(r.id)
    
    return {
        "anchors": {"hero_1": hero_1, "hook_1": hook_1, "stealer_1": stealer_1},
        "missing": missing,
        "regions": final_regions
    }

def compute_derived_metrics(anchors: dict, signals, saliency_map: np.ndarray, img: np.ndarray) -> dict:
    """Compute 11 derived metrics. Null-safe: missing anchors → null metrics.
    
    Formulas (locked):
    - hero_area_ratio: hero.w * hero.h (normalized 0-1)
    - hero_center_dist: euclidean(center(hero), (0.5,0.5)), range [0, ~0.707]
    - hero_bg_contrast: ring-mask luminance delta [0, 255]
    - hero_saliency_share: sum(sal[hero_bbox]) / sum(sal_total)
    - hook_saliency_share: same for hook
    - attention_competition: max_nonhero_sal / max(hero_sal, 1e-6)
    - hero_hook_iou: IoU between hero and hook, null if either missing
    - text_present: bool, wordCount > 0
    - min_text_px_mobile: from OCR signals
    - timestamp_overlap: from OCR signals
    - authentic_gameplay: from style signals
    """
    hero = anchors.get("hero_1")
    hook = anchors.get("hook_1")
    
    # Hero-dependent metrics (null if hero missing)
    hero_area_ratio = None
    hero_center_dist = None
    hero_bg_contrast = None
    hero_saliency_share = None
    attention_competition = None
    
    if hero is not None:
        hero_area_ratio = round(hero.w * hero.h, 4)
        hero_center_dist = round(compute_center_dist(hero), 4)
        hero_bg_contrast = compute_hero_bg_contrast(img, hero)
        hero_saliency_share = compute_saliency_share(hero, saliency_map)
        
        # attention_competition = max_nonhero_sal / max(hero_sal, 1e-6)
        if saliency_map is not None and hero_saliency_share > 0:
            total_sal = 1.0  # saliency shares are already fractions of total
            nonhero_sal = total_sal - hero_saliency_share
            attention_competition = round(nonhero_sal / max(hero_saliency_share, 1e-6), 4)
    
    # Hook-dependent metrics
    hook_saliency_share = None
    if hook is not None:
        hook_saliency_share = compute_saliency_share(hook, saliency_map)
    
    # Hero-hook IoU (null if either missing)
    hero_hook_iou = None
    if hero is not None and hook is not None:
        hero_hook_iou = round(compute_iou(hero, hook), 4)
    
    # Signal-derived (always available)
    ocr = signals.ocr if hasattr(signals, 'ocr') else None
    style = signals.style if hasattr(signals, 'style') else None
    
    return {
        "hero_area_ratio": hero_area_ratio,
        "hero_center_dist": hero_center_dist,
        "hero_bg_contrast": hero_bg_contrast,
        "hero_saliency_share": hero_saliency_share,
        "hook_saliency_share": hook_saliency_share,
        "attention_competition": attention_competition,
        "hero_hook_iou": hero_hook_iou,
        "text_present": (ocr.wordCount > 0) if ocr else False,
        "min_text_px_mobile": ocr.minTextPxMobile if ocr else None,
        "timestamp_overlap": ocr.timestampOverlap if ocr else False,
        "authentic_gameplay": style.authenticGameplay if style else None,
    }



def resize_for_mobile(img: np.ndarray, target_width: int = 360) -> np.ndarray:
    """Resize image to mobile width, preserving aspect ratio"""
    h, w = img.shape[:2]
    scale = target_width / w
    new_h = int(h * scale)
    resized = cv2.resize(img, (target_width, new_h), interpolation=cv2.INTER_AREA)
    blurred = cv2.GaussianBlur(resized, (3, 3), 0)
    return blurred

# ============================================================
# SIGNAL 1: Mobile Readability (OpenCV)
# ============================================================
def analyze_mobile(img: np.ndarray) -> MobileSignals:
    """Compute mobile readability signals"""
    mobile_img = resize_for_mobile(img, 360)
    gray = cv2.cvtColor(mobile_img, cv2.COLOR_BGR2GRAY)
    
    # Dynamic range (contrast)
    p05 = np.percentile(gray, 5)
    p95 = np.percentile(gray, 95)
    dyn_range = float(p95 - p05)
    
    # Edge density (detail visibility)
    edges = cv2.Canny(gray, 50, 150)
    edge_density = float(np.count_nonzero(edges) / edges.size)
    
    # Pass if both thresholds met
    passed = dyn_range >= 35 and edge_density >= 0.015
    
    return MobileSignals(
        dynRange=round(dyn_range, 2),
        edgeDensity=round(edge_density, 4),
        passed=passed
    )

# ============================================================
# SIGNAL 2: OCR Text Analysis with Regions
# ============================================================
def analyze_ocr_with_regions(img: np.ndarray) -> tuple[OcrSignals, List[Region]]:
    """
    Detect text and return both signals and region boxes
    """
    reader = get_ocr()
    h, w = img.shape[:2]
    image_area = h * w
    
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    result = reader.readtext(img_rgb)
    
    word_count = 0
    text_area = 0
    text_heights = []
    timestamp_overlap = False
    regions = []
    
    mobile_scale = 360 / w
    text_idx = 0
    
    for detection in result:
        box = detection[0]
        text = detection[1]
        confidence = detection[2]
        
        if confidence < 0.5:
            continue
        
        # Count words
        words = text.split()
        word_count += len(words)
        
        # Calculate box dimensions
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        box_w = max_x - min_x
        box_h = max_y - min_y
        text_area += box_w * box_h
        
        # Mobile height
        mobile_height = box_h * mobile_scale
        text_heights.append(mobile_height)
        
        # Timestamp overlap check
        center_x = (min_x + max_x) / 2
        center_y = (min_y + max_y) / 2
        if center_x > w * 0.80 and center_y > h * 0.75:
            timestamp_overlap = True
        
        # Create region (store temporarily without ID)
        regions.append({
            'min_x': min_x, 'min_y': min_y,
            'box_w': box_w, 'box_h': box_h,
            'center_x': center_x, 'center_y': center_y,
            'conf': confidence,
            'text': text[:50]
        })
    
    # Sort by y position descending (bottom-most first → text_1)
    regions.sort(key=lambda r: r['center_y'], reverse=True)
    
    # Now assign IDs based on sorted order
    final_regions = []
    for i, r in enumerate(regions):
        pos = get_position_label(r['center_x'] / w, r['center_y'] / h)
        final_regions.append(Region(
            id=f"text_{i+1}",
            type="text",
            x=round(r['min_x'] / w, 4),
            y=round(r['min_y'] / h, 4),
            w=round(r['box_w'] / w, 4),
            h=round(r['box_h'] / h, 4),
            pos=pos,
            displayName=generate_display_name("text", pos, i+1, r['text']),
            conf=round(r['conf'], 3),
            text=r['text'],
            source="easyocr"
        ))
    
    text_area_pct = (text_area / image_area) * 100 if image_area > 0 else 0
    min_text_px = min(text_heights) if text_heights else 0
    median_text_px = float(np.median(text_heights)) if text_heights else 0
    
    signals = OcrSignals(
        wordCount=word_count,
        textAreaPct=round(text_area_pct, 2),
        minTextPxMobile=round(min_text_px, 1),
        medianTextPxMobile=round(median_text_px, 1),
        timestampOverlap=timestamp_overlap
    )
    
    return signals, final_regions

# ============================================================
# SIGNAL 3: Object Detection with Regions (YOLO)
# ============================================================
def analyze_objects_with_regions(img: np.ndarray) -> tuple[ObjectSignals, List[Region]]:
    """
    Detect objects and return signals + regions
    Hero_1 = largest object, Hero_2 = second largest
    """
    model = get_yolo()
    h, w = img.shape[:2]
    image_area = h * w
    
    results = model(img, verbose=False)[0]
    
    # Collect all detected objects with their areas
    detections = []
    face_count = 0
    PERSON_CLASS = 0
    
    for box in results.boxes:
        cls = int(box.cls[0])
        conf = float(box.conf[0])
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        
        if conf < 0.3:
            continue
        
        box_w = x2 - x1
        box_h = y2 - y1
        box_area = box_w * box_h
        center_x = (x1 + x2) / 2
        center_y = (y1 + y2) / 2
        
        class_name = results.names[cls]
        is_person = cls == PERSON_CLASS
        
        if is_person:
            # We no longer count faces here (MediaPipe does it)
            pass
        
        detections.append({
            'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
            'box_w': box_w, 'box_h': box_h,
            'area': box_area,
            'center_x': center_x, 'center_y': center_y,
            'conf': conf,
            'class_name': class_name,
            'is_person': is_person
        })
    
    # Sort by area descending
    detections.sort(key=lambda d: d['area'], reverse=True)
    
    regions = []
    hero_area = 0
    
    # Assign hero_1 and hero_2 to top 2 largest
    for i, det in enumerate(detections):
        if i == 0:
            region_id = "hero_1"
            region_type = "hero"
            hero_area = det['area']
        elif i == 1:
            region_id = "hero_2"
            region_type = "hero"
        else:
            region_id = f"obj_{i+1}"
            region_type = "object"
        
        pos = get_position_label(det['center_x'] / w, det['center_y'] / h)
        region = Region(
            id=region_id,
            type=region_type,
            x=round(det['x1'] / w, 4),
            y=round(det['y1'] / h, 4),
            w=round(det['box_w'] / w, 4),
            h=round(det['box_h'] / h, 4),
            pos=pos,
            displayName=generate_display_name(region_type, pos, i+1),
            conf=round(det['conf'], 3),
            label=det['class_name'],
            source="yolo"
        )
        regions.append(region)
    
    hero_ratio = hero_area / image_area if image_area > 0 else 0
    
    signals = ObjectSignals(
        heroAreaRatio=round(hero_ratio, 4),
        objectCount=len(regions),
        faceCount=0 # Handled by MediaPipe now
    )
    
    return signals, regions

# ============================================================
# SIGNAL 4: Saliency (OpenCV)
# ============================================================
def analyze_saliency(img: np.ndarray):
    """Count visual attention peaks and compute saliency map128.
    Returns: (SaliencySignals, raw_saliency_map_ndarray_or_None)
    """
    try:
        saliency = cv2.saliency.StaticSaliencySpectralResidual_create()
        _, sal_map = saliency.computeSaliency(img)
        
        # Original peak counting
        sal_map_255 = (sal_map * 255).astype(np.uint8)
        _, binary = cv2.threshold(sal_map_255, 128, 255, cv2.THRESH_BINARY)
        contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        significant_peaks = sum(1 for c in contours if cv2.contourArea(c) > 500)
        
        # Compute map128 for attention hierarchy
        orig_h, orig_w = sal_map.shape[:2]
        target_w = 128
        target_h = max(1, int(orig_h * target_w / orig_w))
        
        sal_resized = cv2.resize(sal_map, (target_w, target_h), interpolation=cv2.INTER_AREA)
        
        sal_min = sal_resized.min()
        sal_max = sal_resized.max()
        if sal_max > sal_min:
            sal_normalized = (sal_resized - sal_min) / (sal_max - sal_min)
        else:
            sal_normalized = np.zeros_like(sal_resized, dtype=np.float32)
        
        sal_normalized = np.clip(sal_normalized, 0.0, 1.0)
        map128 = sal_normalized.flatten().tolist()
        
        signals = SaliencySignals(
            peaks=min(significant_peaks, 10),
            mapW=target_w,
            mapH=target_h,
            map128=map128
        )
        return signals, sal_map  # Return raw map for strict resolver
    except Exception as e:
        logger.warning(f"Saliency failed: {e}")
        return SaliencySignals(peaks=3, mapW=0, mapH=0, map128=[]), None

# ============================================================
# SIGNAL 5: Style Classification (SigLIP)
# ============================================================
def analyze_style(img: np.ndarray) -> StyleSignals:
    """Classify thumbnail style"""
    try:
        import torch
        model, processor = get_siglip()
        
        pil_img = Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        
        prompts = [
            "a real gameplay screenshot from a video game",
            "a 3D rendered promotional image",
            "a game UI menu screen"
        ]
        
        inputs = processor(text=prompts, images=pil_img, return_tensors="pt", padding=True)
        
        if torch.cuda.is_available():
            inputs = {k: v.cuda() for k, v in inputs.items()}
        
        with torch.no_grad():
            outputs = model(**inputs)
            logits = outputs.logits_per_image
            probs = torch.softmax(logits, dim=1)[0].cpu().numpy()
        
        return StyleSignals(
            authenticGameplay=round(float(probs[0]), 3),
            renderLike=round(float(probs[1]), 3),
            uiHeavy=round(float(probs[2]), 3)
        )
    except Exception as e:
        logger.warning(f"SigLIP failed: {e}")
        return StyleSignals(authenticGameplay=0.5, renderLike=0.3, uiHeavy=0.2, available=False)

# ============================================================
# LIGHTWEIGHT FALLBACK
# ============================================================


# ============================================================
# NEW: SURGICAL FACE ANALYSIS (MediaPipe)
# ============================================================
def analyze_faces_surgical(img: np.ndarray) -> tuple[List[Region], int]:
    """
    Detect faces using MediaPipe Landmarker (Mesh) for tight designer boxes.
    Applies adaptive padding and strict filtering.
    """
    landmarker = get_face_landmarker()
    h, w = img.shape[:2]
    img_rgb = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=img_rgb)
    
    # Run inference (IMAGE mode blocks until done)
    detector_result = landmarker.detect(mp_image)
    
    raw_faces = []
    
    for i, landmarks in enumerate(detector_result.face_landmarks):
        # 1. Compute bounds from landmarks
        xs = [lm.x for lm in landmarks]
        ys = [lm.y for lm in landmarks]
        min_x, max_x = min(xs), max(xs)
        min_y, max_y = min(ys), max(ys)
        
        raw_w = max_x - min_x
        raw_h = max_y - min_y
        area = raw_w * raw_h
        
        # 2. Adaptive Padding (Surgical)
        if area < 0.02:
            padding = 0.15
        elif area < 0.08:
            padding = 0.10
        else:
            padding = 0.06
            
        pad_x = raw_w * padding
        pad_y = raw_h * padding
        
        # 3. Clamp to [0..1]
        x1 = max(0.0, min_x - pad_x)
        y1 = max(0.0, min_y - pad_y)
        x2 = min(1.0, max_x + pad_x)
        y2 = min(1.0, max_y + pad_y)
        
        final_x = x1
        final_y = y1
        final_w = x2 - x1
        final_h = y2 - y1
        final_area = final_w * final_h
        
        # 4. Filter Garbage
        # Drop tiny faces (< 0.8%) unless it's the only one
        if final_area < 0.008 and len(detector_result.face_landmarks) > 1:
            continue
            
        raw_faces.append({
            'x': final_x, 'y': final_y, 'w': final_w, 'h': final_h,
            'area': final_area,
            'center_x': final_x + final_w/2,
            'center_y': final_y + final_h/2
        })
        
    # 5. Sort by Area Descending
    raw_faces.sort(key=lambda f: f['area'], reverse=True)
    
    # 6. Create Regions (Top 3)
    final_regions = []
    for i, f in enumerate(raw_faces[:3]):
        # ID: face_1, face_2
        rid = f"face_{i+1}"
        
        # Display Name based on Position
        cx = f['center_x']
        if cx < 0.33: dname = "left face"
        elif cx < 0.66: dname = "center face"
        else: dname = "right face"
        
        pos = get_position_label(cx, f['center_y'])
        
        final_regions.append(Region(
            id=rid,
            type="face",
            x=round(f['x'], 4),
            y=round(f['y'], 4),
            w=round(f['w'], 4),
            h=round(f['h'], 4),
            pos=pos,
            displayName=dname,
            conf=0.95,
            source="mediapipe"
        ))
        
    return final_regions, len(raw_faces)

# ============================================================
# MAIN ENDPOINT - Returns signals + regions
# ============================================================
@app.post("/analyze_signals", response_model=AnalyzeResponse)
async def analyze_signals(request: AnalyzeRequest):
    try:
        logger.info(f"Analyzing: {request.imageUrlSmall}")
        
        # Download image
        try:
            img = download_image(request.imageUrlSmall)
        except Exception as e:
            logger.error(f"Download failed: {e}")
            raise HTTPException(status_code=400, detail=f"Download failed: {str(e)}")
            
        h, w = img.shape[:2]
        logger.info(f"Image downloaded: {w}x{h}")
        
        all_regions = []
        
        # 1. Mobile analysis (pure OpenCV)
        mobile = analyze_mobile(img)
        
        # 2. Saliency
        saliency, raw_saliency_map = analyze_saliency(img) or (SaliencySignals(peaks=0), None)
        
        # 3. OCR with regions
        try:
            ocr, text_regions = analyze_ocr_with_regions(img)
            all_regions.extend(text_regions)
        except Exception as e:
            logger.warning(f"OCR failed: {e}")
            ocr = OcrSignals(wordCount=0, textAreaPct=0, minTextPxMobile=0, medianTextPxMobile=0, timestampOverlap=False)
        
        # 4. Surgical Face Analysis (MediaPipe)
        face_regions = []
        raw_face_count = 0
        try:
            face_regions, raw_face_count = analyze_faces_surgical(img)
            all_regions.extend(face_regions)
            logger.info(f"Faces: {len(face_regions)} detected via MediaPipe (Raw: {raw_face_count})")
        except Exception as e:
            logger.error(f"Face Landmarker failed: {e}")
            # Fallback? No, just 0 faces
        
        # 5. Object detection (YOLO) - Person ignored for faces
        containment_best = 0.0
        suppressed_best_id = None
        
        try:
            objects, obj_regions = analyze_objects_with_regions(img)
            all_regions.extend(obj_regions)
            
            # ANTI-GHOSTING (Containment: Face inside Body)
            # Threshold: 0.85 (Head+Shoulders safety)
            if len(face_regions) > 0:
                face_1 = face_regions[0]
                f1_area = face_1.w * face_1.h
                
                for r in obj_regions:
                    if r.label == 'person': # Found a body
                        # Intersection
                        x_left = max(face_1.x, r.x)
                        y_top = max(face_1.y, r.y)
                        x_right = min(face_1.x + face_1.w, r.x + r.w)
                        y_bottom = min(face_1.y + face_1.h, r.y + r.h)
                        
                        if x_right > x_left and y_bottom > y_top:
                            intersection = (x_right - x_left) * (y_bottom - y_top)
                            # Containment = What % of FACE is inside BODY?
                            containment = intersection / f1_area if f1_area > 0 else 0
                            
                            # Track best overlap for debug
                            if containment > containment_best:
                                containment_best = containment
                                if containment >= 0.85:
                                    suppressed_best_id = r.id
                            
                            if containment >= 0.85:
                                r.isSuppressed = True
                                logger.info(f"Suppressed ghost body {r.id} (containment={containment:.2f})")

        except Exception as e:
            logger.error(f"YOLO failed: {e}")
            raise HTTPException(status_code=500, detail=f"YOLO Object Detection Failed: {str(e)}")
        
        # 6. Style classification
        try:
            style = analyze_style(img)
        except Exception as e:
            logger.error(f"SigLIP failed: {e}")
            raise HTTPException(status_code=500, detail=f"Style Analysis Failed: {str(e)}")
            
        # 7. Update Signals (Count from MediaPipe, capped by Model not UI)
        objects.faceCount = raw_face_count
        
        # Build signals response
        signals = SignalsResponse(
            mobile=mobile,
            ocr=ocr,
            objects=objects,
            style=style,
            saliency=saliency
        )
        
        # 8. Strict Region Graph (no fallbacks, no synthetics)
        region_graph = build_region_graph_strict(all_regions, raw_saliency_map)
        anchors = region_graph["anchors"]
        missing = region_graph["missing"]
        strict_regions = region_graph["regions"]
        logger.info(f"✓ StrictGraph: anchors={[k for k,v in anchors.items() if v]}, missing={missing}")
        
        # 9. Compute 11 derived metrics (null-safe)
        derived = compute_derived_metrics(anchors, signals, raw_saliency_map, img)
        
        # 10. Anchor completeness + pipeline status
        non_null_count = sum(1 for v in anchors.values() if v is not None)
        anchor_completeness = round(non_null_count / 3.0, 4)
        pipeline_status = "READY_FOR_FIX" if anchor_completeness >= 0.67 else "REDESIGN_REQUIRED"
        
        # FaceData
        largest_face_pos = face_regions[0].pos if face_regions else None
        top_face_area = (face_regions[0].w * face_regions[0].h) if face_regions else 0.0
        
        face_data = FaceData(
            exists=raw_face_count > 0,
            count=raw_face_count,
            areaRatio=round(top_face_area, 4),
            largestFacePos=largest_face_pos
        )
        
        # DEBUG & VERIFICATION
        debug_warnings = []
        suppressed_count = sum(1 for r in all_regions if r.isSuppressed)
        
        for r in all_regions:
            if not (0.0 <= r.x <= 1.0 and 0.0 <= r.y <= 1.0):
                debug_warnings.append(f"Region {r.id} pos out of bounds: x={r.x}, y={r.y}")
            if not (r.w > 0 and r.h > 0):
                debug_warnings.append(f"Region {r.id} zero/neg dims: w={r.w}, h={r.h}")
            if r.x + r.w > 1.01 or r.y + r.h > 1.01:
                debug_warnings.append(f"Region {r.id} overflow: x+w={r.x+r.w}, y+h={r.y+r.h}")
        
        # Synthetic check (hard acceptance: must pass)
        for r in strict_regions:
            if r.synthetic:
                debug_warnings.append(f"FATAL: Region {r.id} is synthetic (rejected)")
        
        # Duplicate ID check
        seen = set()
        for r in strict_regions:
            if r.id in seen:
                debug_warnings.append(f"FATAL: Duplicate region ID: {r.id}")
            seen.add(r.id)
        
        # Missing consistency check
        if anchors["hero_1"] is None and "hero_1" not in missing:
            debug_warnings.append("FATAL: hero_1 is null but not in missing list")
        if anchors["hook_1"] is None and "hook_1" not in missing:
            debug_warnings.append("FATAL: hook_1 is null but not in missing list")
        
        face_area_ratios = [round(f.w * f.h, 4) for f in face_regions] if face_regions else []
        is_sorted = all(face_area_ratios[i] >= face_area_ratios[i+1] for i in range(len(face_area_ratios)-1)) if len(face_area_ratios) > 1 else True
                
        debug_info = DebugInfo(
            facesDetectedRaw=raw_face_count, 
            facesKept=raw_face_count,
            facesReturned=len(face_regions),
            suppressedBodiesCount=suppressed_count,
            suppressedBodyId=suppressed_best_id,
            containmentFace1BodyBest=round(containment_best, 3),
            faceAreasSorted=is_sorted,
            faceAreaRatios=face_area_ratios,
            paddingBucket="adaptive",
            warnings=debug_warnings
        )
        
        if debug_warnings:
            logger.warning(f"Verification Warnings: {debug_warnings}")
        
        logger.info(f"✓ Complete: status={pipeline_status}, completeness={anchor_completeness}, warnings={len(debug_warnings)}")
        
        return AnalyzeResponse(
            signals=signals,
            regions=strict_regions,
            anchors=AnchorsModel(**anchors),
            missing=missing,
            quality=QualityModel(anchorCompleteness=anchor_completeness, status=pipeline_status),
            derivedMetrics=DerivedMetricsModel(**derived),
            imageDims={"width": w, "height": h},
            faceData=face_data,
            debug=debug_info
        )
        
    except requests.RequestException as e:
        logger.error(f"Failed to download image: {e}")
        raise HTTPException(status_code=400, detail=f"Failed to download image: {str(e)}")
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "ok", "service": "analyzer", "version": "2.0.0"}

# ============================================================
# RUN
# ============================================================
if __name__ == "__main__":
    import uvicorn
    import traceback
    try:
        print("Starting Analyzer on port 8001...")
        uvicorn.run(app, host="0.0.0.0", port=8001)
    except Exception as e:
        print("FATAL ERROR IN MAIN:")
        traceback.print_exc()

