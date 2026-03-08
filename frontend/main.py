# main.py
from fastapi import FastAPI, File, UploadFile, Form
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from PIL import Image
import io
import uuid
import base64

# Firebase imports
import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore import GeoPoint

app = FastAPI()

# --- PRIORITY AI CONFIGURATION ---
# Priority levels: critical, high, medium, low
PRIORITY_RULES = {
    "traffic": "high",           # Traffic issues = high priority
    "street_light": "high",      # Street light issues = high priority (safety)
    "pothole": "medium",        # Road damage = medium priority
    "garbage": "low",            # Garbage = low priority
    "other": "medium"            # Default
}

# Keywords that increase priority
HIGH_PRIORITY_KEYWORDS = [
    "emergency", "accident", "danger", "unsafe", "injury", 
    "flood", "fire", "broken", "critical", "urgent", "deadly"
]

def detect_priority(issue_type, description, confidence):
    """AI-powered priority detection based on issue type and description"""
    
    # Start with base priority from issue type
    priority = PRIORITY_RULES.get(issue_type.lower(), "medium")
    
    # Check description for high-priority keywords
    desc_lower = description.lower()
    keyword_count = sum(1 for keyword in HIGH_PRIORITY_KEYWORDS if keyword in desc_lower)
    
    # Upgrade priority based on keywords
    if keyword_count >= 2:
        priority = "critical"
    elif keyword_count == 1:
        if priority == "low":
            priority = "medium"
        elif priority == "medium":
            priority = "high"
    
    # Lower confidence = lower priority (AI unsure)
    if confidence < 0.5 and priority in ["high", "critical"]:
        priority = "medium"
    
    return priority

def compress_image(image_bytes, max_size_kb=500, max_dim=1280):
    """Compress image to stay under Firestore document size limit"""
    image = Image.open(io.BytesIO(image_bytes))
    
    # Resize if too large
    if max(image.size) > max_dim:
        ratio = max_dim / max(image.size)
        new_size = (int(image.size[0] * ratio), int(image.size[1] * ratio))
        image = image.resize(new_size, Image.Resampling.LANCZOS)
    
    # Convert to RGB if needed
    if image.mode in ('RGBA', 'P'):
        image = image.convert('RGB')
    
    # Compress to target size
    output = io.BytesIO()
    quality = 85
    image.save(output, format='JPEG', quality=quality, optimize=True)
    
    # Reduce quality if still too large
    while len(output.getvalue()) > max_size_kb * 1024 and quality > 30:
        quality -= 10
        output = io.BytesIO()
        image.save(output, format='JPEG', quality=quality, optimize=True)
    
    return output.getvalue()

# --- 1. ENABLE CORS ---
# Allows the frontend (citizen.html) to communicate with this API
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 2. INITIALIZE MODELS & FIREBASE ---
# Ensure "best.pt" and "firebase_key.json" are in the same directory
model = YOLO("best.pt") 

# Initialize Firebase (Firestore only - no Storage needed)
cred = credentials.Certificate("firebase_key.json")
firebase_admin.initialize_app(cred)

db = firestore.client()

@app.post("/submit_report")
async def submit_report(
    file: UploadFile = File(...),
    description: str = Form(""),
    address: str = Form(""),
    lat: str = Form("0"),
    lng: str = Form("0")
):
    try:
        # Read image for YOLO analysis
        image_bytes = await file.read()
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Run YOLO prediction
        results = model.predict(image)
        detections = []
        for r in results:
            for box in r.boxes:
                detections.append({
                    "issue": model.names[int(box.cls[0])],
                    "confidence": float(box.conf[0])
                })

        # Process AI results
        issue_detected = "Unknown Issue"
        confidence = 0.0
        if detections:
            best = max(detections, key=lambda x: x['confidence'])
            issue_detected = best["issue"]
            confidence = best["confidence"]

        # --- AI PRIORITY DETECTION ---
        priority = detect_priority(issue_detected, description, confidence)

        # --- COORDINATE PROCESSING ---
        try:
            lat_float = float(lat)
            lng_float = float(lng)
        except (ValueError, TypeError):
            lat_float = 0.0
            lng_float = 0.0
        
        location_point = GeoPoint(lat_float, lng_float)

        # Generate unique ID for the report
        file_id = str(uuid.uuid4())

        # Compress image and convert to Base64 (instead of Firebase Storage)
        compressed_bytes = compress_image(image_bytes)
        image_base64 = base64.b64encode(compressed_bytes).decode('utf-8')
        image_data_url = f"data:image/jpeg;base64,{image_base64}"

        # Save record to Firestore with AI-detected priority
        report_data = {
            "issue": issue_detected,
            "priority": priority,            # AI-detected priority
            "confidence": confidence,
            "description": description,
            "address": address,
            "location": location_point,
            "latitude": lat_float,
            "longitude": lng_float,
            "imageUrl": image_data_url,      # Base64 encoded image
            "status": "pending",
            "createdAt": firestore.SERVER_TIMESTAMP
        }

        db.collection("reports").document(file_id).set(report_data)
        
        # Prepare response (convert Firestore objects to serializable types)
        response_data = {
            "message": "Success",
            "report": {
                "id": file_id,
                "issue": issue_detected,
                "priority": priority,
                "confidence": confidence,
                "description": description,
                "address": address,
                "latitude": lat_float,
                "longitude": lng_float,
                "imageUrl": image_data_url,
                "status": "pending",
                "createdAt": "server_timestamp"
            }
        }
        
        return response_data

    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})

