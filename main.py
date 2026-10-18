"""Peak Style backend.

Run:
    python -m uvicorn main:app --reload --port 8000

Test:
    http://localhost:8000/docs

Required .env settings:
    GEMINI_API_KEY
    GEMINI_TEXT_MODEL
    WEATHER_API_KEY
    GEMINI_IMAGE_MODEL

Optional:
    DEFAULT_CITY=Seattle
    CORS_ORIGINS=http://localhost:8443
"""

import asyncio
import base64
import hashlib
import json
import os
import tempfile
import uuid
from pathlib import Path
from threading import Lock
from typing import Literal, Optional
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import (
    APIRouter,
    BackgroundTasks,
    FastAPI,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import database
from analyze_clothing import analyze_clothing, prepare_image
from generate_preview import generate_look
from get_weather import get_weather
from recommend_clothing import recommend_clothing
from review_purchase import review_purchase
from style_chat import style_chat
from today_outfit import today_outfit


HERE = Path(__file__).resolve().parent
PREVIEW_DIR = HERE / "previews"

load_dotenv(HERE / ".env", override=True)

MAX_PHOTOS_PER_UPLOAD = 20
# How many photos Gemini analyzes at the same time during one upload.
PARALLEL_ANALYSES = 5
DEFAULT_STYLE = "simple, comfortable and put-together"

UPLOAD_LOCK = Lock()


# ---------- Helper functions ----------

def add_photo(path, key, model):
    # The slow Gemini call runs in parallel; only the save is serialized
    # because the database chooses the next available clothing ID.
    result = analyze_clothing(path, key, model)
    image_bytes = prepare_image(path)
    with UPLOAD_LOCK:
        item = database.add_item(
            result["category"], result["color"], result["description"],
            image_bytes=image_bytes,
        )
    item["uncertainties"] = result["uncertainties"]  # shown to the user, not stored
    return item


def env(name, default=""):
    return os.getenv(name, default).strip()


def redact(message):
    """Remove API keys from error messages."""
    for name in ("GEMINI_API_KEY", "WEATHER_API_KEY"):
        if env(name):
            message = message.replace(env(name), "[KEY REDACTED]")
    return message


def fail(exc):
    """Convert an input or provider error into an HTTP error."""
    status = 502 if isinstance(exc, RuntimeError) else 400
    return HTTPException(status, redact(str(exc)))


async def read_photo(upload: UploadFile) -> bytes:
    try:
        data = await upload.read()
    finally:
        await upload.close()

    if not data:
        raise ValueError("The photo is empty.")

    return data


def saved_image_path(item):
    """Return the photo path only if its file exists inside images/."""
    if not item.get("image_path"):
        return None

    path = (database.HERE / item["image_path"]).resolve()

    if not path.is_relative_to(database.IMAGE_DIR.resolve()):
        return None

    if not path.is_file():
        return None

    return path


def with_image_url(item):
    """Add an image URL that the frontend can display.

    The URL is relative (/api/images/...) so it also works through the
    frontend's /api proxy when the site is opened from another device.
    """
    item = dict(item)
    path = saved_image_path(item)

    if path:
        relative_path = path.relative_to(
            database.IMAGE_DIR.resolve()
        ).as_posix()

        item["imageUrl"] = "/api/images/" + quote(relative_path)
    else:
        item["imageUrl"] = None

    item["owned"] = bool(item["owned"])
    return item


def owned_closet(photos_only=False):
    """Return up to 30 owned items in the format the AI expects."""
    keys = ("id", "category", "color", "description")

    items = [
        item
        for item in database.list_items(owned=True)
        if not photos_only or saved_image_path(item)
    ]

    return [
        {key: item[key] for key in keys}
        for item in items
    ][:30]


def weather_for(city):
    """Return weather, or an error message if weather is unavailable."""
    try:
        return get_weather(city, env("WEATHER_API_KEY")), None
    except (ValueError, RuntimeError) as exc:
        return None, redact(str(exc))


def preferences(occasion, weather, notes="", mood=""):
    prefs = {
        "style": database.get_setting("style", DEFAULT_STYLE),
        "occasion": occasion,
        "temperatureC": weather["temperatureC"] if weather else None,
        "rain": weather["rain"] if weather else None,
        "notes": notes,
        "excludedItemIds": [],
    }

    if mood:
        prefs["mood"] = mood

    if weather:
        prefs["notes"] = (
            notes
            + f" Today's chance of rain is {weather['chanceOfRain']}%."
            + " Do not assume any garment is waterproof."
        ).strip()

    return prefs


def describe(items):
    return " + ".join(item["description"] for item in items)


def outfit_pieces(item_ids):
    """Look up clothing IDs for the image model.

    Returns the items and, for each one, its description plus its photo
    path (None when it has no photo, so it is drawn from the description).
    """
    items = []

    # Remove duplicate IDs while preserving order.
    for item_id in dict.fromkeys(item_ids):
        item = database.get_item(item_id)

        if not item:
            raise HTTPException(404, f"No item with ID {item_id}.")

        items.append(item)

    if not items:
        raise HTTPException(400, "Choose at least one clothing item.")

    pieces = [
        {"description": item["description"], "photo": saved_image_path(item)}
        for item in items
    ]
    return items, pieces


def save_generated(image, mime):
    """Save a generated image in previews/ and return its URL."""
    extensions = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
    }

    if mime not in extensions or not image:
        raise HTTPException(
            502,
            "The image service did not return a supported image.",
        )

    name = f"{uuid.uuid4().hex}{extensions[mime]}"

    PREVIEW_DIR.mkdir(exist_ok=True)
    (PREVIEW_DIR / name).write_bytes(image)

    return "/api/previews/" + name


# ---------- App setup ----------

app = FastAPI(title="Peak Style API")
cors_origins = [
    origin.strip().rstrip("/")
    for origin in env(
        "CORS_ORIGINS",
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:8443,http://127.0.0.1:8443",
    ).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")


# ---------- Health check ----------

@api.get("/health")
def health():
    return {
        "ok": True,
        "geminiConfigured": bool(
            env("GEMINI_API_KEY") and env("GEMINI_TEXT_MODEL")
        ),
        "weatherConfigured": bool(env("WEATHER_API_KEY")),
        "imageModelConfigured": bool(env("GEMINI_IMAGE_MODEL")),
        "closetItems": len(database.list_items(owned=True)),
    }


# ---------- My Closet ----------

@api.post("/closet/upload")
async def upload_closet(
    background: BackgroundTasks,
    items: list[UploadFile] = File(
        ...,
        description="Choose clothing photos",
        json_schema_extra={
            "items": {
                "type": "string",
                "format": "binary",
            }
        },
    ),
):
    """Analyze and save uploaded clothing photos."""
    if len(items) > MAX_PHOTOS_PER_UPLOAD:
        raise HTTPException(
            400,
            f"Upload at most {MAX_PHOTOS_PER_UPLOAD} photos at a time.",
        )

    slots = asyncio.Semaphore(PARALLEL_ANALYSES)

    async def process(upload):
        """Return ("added", item) or ("skipped", details) for one photo."""
        try:
            data = await read_photo(upload)

            async with slots:
                with tempfile.TemporaryDirectory() as tmp:
                    path = Path(tmp) / "photo"
                    path.write_bytes(data)

                    item = await run_in_threadpool(
                        add_photo,
                        path,
                        env("GEMINI_API_KEY"),
                        env("GEMINI_TEXT_MODEL"),
                    )

            return "added", with_image_url(item)

        except (ValueError, RuntimeError) as exc:
            return "skipped", {
                "filename": upload.filename,
                "error": redact(str(exc)),
            }

    results = await asyncio.gather(*(process(upload) for upload in items))
    added = [value for kind, value in results if kind == "added"]
    skipped = [value for kind, value in results if kind == "skipped"]

    if not added:
        raise HTTPException(
            400,
            {
                "message": "None of the photos could be added.",
                "skipped": skipped,
            },
        )

    message = (
        f"Added {len(added)} "
        f"piece{'s' if len(added) != 1 else ''} to your closet."
    )

    if skipped:
        message += f" Skipped {len(skipped)}."

    background.add_task(outfit_samples)  # refresh the home page samples
    return {
        "message": message,
        "added": added,
        "skipped": skipped,
    }


@api.get("/closet")
def get_closet():
    return {
        "items": [
            with_image_url(item)
            for item in database.list_items(owned=True)
        ]
    }


@api.delete("/closet/{item_id}")
def delete_closet_item(item_id: str, background: BackgroundTasks):
    if not database.delete_item(item_id):
        raise HTTPException(404, "No such item.")

    background.add_task(outfit_samples)  # refresh the home page samples
    return {"message": "Removed from your closet."}


# ---------- Today's outfit ----------

@api.get("/outfit/today")
def outfit_today(
    city: Optional[str] = None,
    occasion: str = "everyday",
    mood: str = "",
    photosOnly: bool = False,
    avoid: list[str] = Query([]),
):
    """Recommend an outfit using the closet, local weather and your mood.

    Set photosOnly=true to choose only items with available photos.
    Pass avoid=top_01,bottoms_02 (repeatable) for outfits already shown, so Restyle picks a new one.
    """
    closet = owned_closet(photos_only=photosOnly)

    if not closet:
        message = (
            "No clothes with photos yet. Upload some photos first."
            if photosOnly
            else "Your closet is empty. Upload some clothes first."
        )
        raise HTTPException(400, message)

    weather, weather_error = weather_for(
        city or env("DEFAULT_CITY", "Seattle")
    )

    prefs = preferences(occasion[:200], weather, mood=mood[:100])
    closet_ids = {item["id"] for item in closet}
    previous = [
        [item_id for item_id in outfit.split(",") if item_id in closet_ids]
        for outfit in avoid[-5:]
    ]
    if any(previous):
        prefs["previousOutfits"] = [ids for ids in previous if ids]

    try:
        result = today_outfit(
            closet,
            prefs,
            env("GEMINI_API_KEY"),
            env("GEMINI_TEXT_MODEL"),
        )
    except (ValueError, RuntimeError) as exc:
        raise fail(exc)

    items = [
        with_image_url(database.get_item(item_id))
        for item_id in result["itemIds"]
    ]

    message = (
        f"Today's look: {describe(items)}. {result['reason']}"
        if items
        else result["reason"]
    )

    return {
        "message": message,
        "outfit": result,
        "items": items,
        "weather": weather,
        "weatherError": weather_error,
    }


# ---------- Sample outfits for the home page closet ----------

SAMPLE_OCCASIONS = ("everyday", "work", "weekend")
SAMPLES_VERSION = 3 # bump to rebuild saved samples after changing how they are picked
SAMPLES_LOCK = asyncio.Lock()


def closet_fingerprint(closet, style):
    """Changes whenever an item is added, removed or edited, or the style changes."""
    text = json.dumps(
        {"closet": closet, "style": style, "version": SAMPLES_VERSION},
        sort_keys=True,
    )
    return hashlib.sha256(text.encode()).hexdigest()


@api.get("/outfit/samples")
async def outfit_samples():
    """One sample outfit each for everyday, work and weekend.

    Results are saved and reused until the closet or style changes,
    so the home page only asks Gemini again after you update your closet.
    An empty closet returns no samples.
    """
    closet = owned_closet()
    if not closet:
        return {"samples": []}

    async with SAMPLES_LOCK:  # two page loads at once share one Gemini run
        fingerprint = closet_fingerprint(
            closet, database.get_setting("style", DEFAULT_STYLE)
        )
        try:
            saved = json.loads(database.get_setting("sample_outfits", "{}"))
        except json.JSONDecodeError:
            saved = {}

        if saved.get("fingerprint") != fingerprint:
            # Picked one after another so each sample avoids the earlier ones.
            results = []
            for occasion in SAMPLE_OCCASIONS:
                prefs = preferences(
                    occasion,
                    None,
                    notes="A general sample outfit, not for a specific day: "
                    "ignore the weather and do not mention it in cautions.",
                )
                earlier = [r["itemIds"] for r in results if r.get("itemIds")]
                if earlier:
                    prefs["previousOutfits"] = earlier
                try:
                    result = await run_in_threadpool(
                        today_outfit,
                        closet,
                        prefs,
                        env("GEMINI_API_KEY"),
                        env("GEMINI_TEXT_MODEL"),
                    )
                except (ValueError, RuntimeError) as exc:
                    result = {"error": redact(str(exc))}
                results.append(result)
            saved = {
                "fingerprint": fingerprint,
                "outfits": dict(zip(SAMPLE_OCCASIONS, results)),
            }
            # Keep failed runs out of the cache so the next visit tries again.
            if not any("error" in result for result in results):
                database.set_setting("sample_outfits", json.dumps(saved))

    samples = []
    for occasion in SAMPLE_OCCASIONS:
        outfit = saved["outfits"][occasion]
        items = [database.get_item(item_id) for item_id in outfit.get("itemIds", [])]
        samples.append({
            "occasion": occasion,
            "outfit": outfit if "error" not in outfit else None,
            "error": outfit.get("error"),
            "items": [with_image_url(item) for item in items if item],
        })

    return {"samples": samples}


# ---------- Outfit images ----------

LOOK_MESSAGE = (
    "Here's your look. It's AI-generated, "
    "so the real clothes may look a little different."
)


class LookRequest(BaseModel):
    itemIds: list[str] = Field(..., min_length=1, max_length=8)
    occasion: str = Field("", max_length=200)
    mood: str = Field("", max_length=100)
    temperatureC: Optional[float] = Field(None, ge=-60, le=60)
    chanceOfRain: Optional[int] = Field(None, ge=0, le=100)


@api.post("/outfit/look")
async def outfit_look(body: LookRequest):
    """Generate a photo of an AI fashion model wearing the chosen items.

    Items without a photo are drawn from their text description.
    """
    items, pieces = outfit_pieces(body.itemIds)

    context = []
    if body.occasion.strip():
        context.append(f"Occasion: {body.occasion.strip()}.")
    if body.mood.strip():
        context.append(f"Mood: {body.mood.strip()}.")
    if body.temperatureC is not None:
        weather = f"Weather: about {round(body.temperatureC)}°C"
        if body.chanceOfRain is not None:
            weather += f" with a {body.chanceOfRain}% chance of rain"
        context.append(weather + ".")

    try:
        image, mime = await run_in_threadpool(
            generate_look,
            pieces,
            env("GEMINI_API_KEY"),
            env("GEMINI_IMAGE_MODEL"),
            None,
            " ".join(context),
        )
    except (ValueError, RuntimeError) as exc:
        raise fail(exc)

    return {
        "message": LOOK_MESSAGE,
        "imageUrl": save_generated(image, mime),
        "items": [with_image_url(item) for item in items],
    }


@api.post("/outfit/preview")
async def outfit_preview(
    person: UploadFile = File(
        ...,
        description="Photo of the person; full body works best",
    ),
    itemIds: str = Form(
        ...,
        description=(
            "Comma-separated clothing IDs, "
            "e.g. top_04,bottoms_01,shoes_02"
        ),
    ),
    notes: str = Form("", max_length=500),
):
    """Generate a try-on image of the person in the photo wearing the items.

    The person photo is stored temporarily for this request.
    Items without a photo are drawn from their text description.
    """
    items, pieces = outfit_pieces(
        item_id.strip()
        for item_id in itemIds.split(",")
        if item_id.strip()
    )

    try:
        data = await read_photo(person)

        with tempfile.TemporaryDirectory() as tmp:
            person_path = Path(tmp) / "person"
            person_path.write_bytes(data)

            image, mime = await run_in_threadpool(
                generate_look,
                pieces,
                env("GEMINI_API_KEY"),
                env("GEMINI_IMAGE_MODEL"),
                person_path,
                notes,
            )

    except FileNotFoundError:
        raise HTTPException(
            400,
            "A clothing photo is missing. "
            "Refresh your closet and upload the photo again.",
        ) from None

    except (ValueError, RuntimeError) as exc:
        raise fail(exc)

    return {
        "message": LOOK_MESSAGE,
        "imageUrl": save_generated(image, mime),
        "usedItems": [with_image_url(item) for item in items],
    }


# ---------- Style profile ----------

@api.post("/style-profile")
def save_style(
    preference: str = Form(
        ...,
        min_length=1,
        max_length=200,
        description="Type your style preferences here.",
    ),
):
    style = preference.strip()

    if not style:
        raise HTTPException(
            status_code=400,
            detail="Enter a style preference.",
        )

    database.set_setting("style", style)

    return {
        "message": "Your style preference has been saved.",
        "style": style,
        "saved": True,
    }


@api.get("/style-profile")
def get_style(preference: Optional[str] = None):
    """Enter a style to save it, or leave the field empty to read it."""

    if preference is not None:
        style = preference.strip()

        if not style:
            raise HTTPException(
                status_code=400,
                detail="Enter a style preference or leave the field unset.",
            )

        if len(style) > 200:
            raise HTTPException(
                status_code=400,
                detail="Keep your preference within 200 characters.",
            )

        database.set_setting("style", style)

        return {
            "style": style,
            "saved": True,
            "message": "Your style preference has been saved.",
        }

    return {
        "style": database.get_setting("style", DEFAULT_STYLE)
    }

# ---------- Style chat ----------

class ChatMessage(BaseModel):
    role: Literal["user", "stylist"]
    text: str = Field(..., min_length=1, max_length=2000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(..., min_length=1, max_length=40)


@api.post("/style-chat")
async def chat_with_stylist(body: ChatRequest):
    """Ask the Peak Style peacock a style question.

    Send the whole conversation, oldest first, ending with your message.
    """
    try:
        return await run_in_threadpool(
            style_chat,
            [message.model_dump() for message in body.messages],
            database.get_setting("style", DEFAULT_STYLE),
            owned_closet(),
            env("GEMINI_API_KEY"),
            env("GEMINI_TEXT_MODEL"),
        )
    except (ValueError, RuntimeError) as exc:
        raise fail(exc)


# ---------- Buy or Bye ----------

@api.post("/analyze")
async def buy_or_bye(
    image: UploadFile = File(
        ...,
        description="Photo of the item you might buy",
    ),
):
    """Analyze a shopping item and find outfits using your closet.

    The shopping item is not saved to the closet.
    """
    closet = owned_closet()

    if not closet:
        raise HTTPException(
            400,
            "Upload your closet first so I can compare.",
        )

    try:
        data = await read_photo(image)

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "photo"
            path.write_bytes(data)

            item = await run_in_threadpool(
                analyze_clothing,
                path,
                env("GEMINI_API_KEY"),
                env("GEMINI_TEXT_MODEL"),
            )
            # A JPEG copy for the results page: browsers cannot show HEIC photos.
            photo = await run_in_threadpool(prepare_image, path)

        candidate = {
            "id": "candidate_check",
            "category": item["category"],
            "color": item["color"],
            "description": item["description"],
        }

        wardrobe = {
            "closetItems": closet,
            "candidate": candidate,
            "preferences": preferences(
                "everyday wear",
                None,
                "Only suggest combinations that genuinely work.",
            ),
        }

        style = database.get_setting("style", DEFAULT_STYLE)

        # Find outfits and review the style fit at the same time.
        result, review = await asyncio.gather(
            run_in_threadpool(
                recommend_clothing,
                wardrobe,
                env("GEMINI_API_KEY"),
                env("GEMINI_TEXT_MODEL"),
            ),
            run_in_threadpool(
                review_purchase,
                {key: item[key] for key in ("category", "color", "description")},
                closet,
                style,
                env("GEMINI_API_KEY"),
                env("GEMINI_TEXT_MODEL"),
            ),
            return_exceptions=True,
        )

        if isinstance(result, BaseException):
            raise result

    except (ValueError, RuntimeError) as exc:
        raise fail(exc)

    # The outfits still work if only the style review failed.
    if isinstance(review, (ValueError, RuntimeError)):
        review = None
    elif isinstance(review, BaseException):
        raise review

    style_review = None

    if review:
        style_review = {
            "styleMatch": review["styleMatch"],
            "styleComment": review["styleComment"],
            "similarComment": review["similarComment"],
            "similarItems": [
                with_image_url(database.get_item(item_id))
                for item_id in review["similarItemIds"]
            ],
        }

    # Add the closet pieces of each outfit so the frontend can show them.
    for outfit in result["outfits"]:
        outfit["items"] = [
            with_image_url(database.get_item(item_id))
            for item_id in outfit["itemIds"]
            if item_id != candidate["id"]
        ]

    count = len(result["outfits"])

    if count >= 2:
        verdict = "buy"
        message = (
            f"It's a buy — this {item['description'].lower()} "
            f"works in {count} outfits with your closet."
        )

    elif count == 1:
        verdict = "maybe"
        message = (
            "Maybe — it only makes 1 outfit with what you own. "
            + result["outfits"][0]["reason"]
        )

    else:
        verdict = "bye"
        message = (
            "It's a bye — it doesn't pair well with your current closet. "
            + result["message"]
        )

    return {
        "verdict": verdict,
        "message": message,
        "item": item,
        "outfits": result["outfits"],
        "style": style,
        "styleReview": style_review,
        "imageUrl": "data:image/jpeg;base64," + base64.b64encode(photo).decode("ascii"),
    }


# ---------- Feedback ----------

class FeedbackRequest(BaseModel):
    rating: int = Field(..., ge=1, le=5)
    message: str = Field("", max_length=2000)


@api.post("/feedback")
def save_feedback(body: FeedbackRequest):
    """Save a 1–5 heart rating and an optional comment in wardrobe.db."""
    database.add_feedback(body.rating, body.message.strip())
    return {"message": "Your feedback has been saved."}


# ---------- Register routes and serve images ----------

app.include_router(api)

database.IMAGE_DIR.mkdir(exist_ok=True)
app.mount(
    "/api/images",
    StaticFiles(directory=database.IMAGE_DIR),
    name="images",
)

PREVIEW_DIR.mkdir(exist_ok=True)
app.mount(
    "/api/previews",
    StaticFiles(directory=PREVIEW_DIR),
    name="previews",
)

# ---------- Website ----------

# When the frontend has been built (render-build.sh does this on Render),
# serve it at "/" so one service hosts both the website and the API.
# Mounted last so the /api routes above always win.
FRONTEND_DIR = HERE / "Peak Style Personal Stylist" / "dist"

if FRONTEND_DIR.is_dir():
    app.mount(
        "/",
        StaticFiles(directory=FRONTEND_DIR, html=True),
        name="website",
    )
