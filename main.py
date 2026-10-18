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
"""

import os
import tempfile
import uuid
from pathlib import Path
from threading import Lock
from typing import Optional
from urllib.parse import quote

from dotenv import load_dotenv
from fastapi import (
    APIRouter,
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

import database
from analyze_clothing import analyze_clothing
from generate_preview import MAX_CLOTHING_PHOTOS, generate_preview
from get_weather import get_weather
from recommend_clothing import recommend_clothing
from today_outfit import today_outfit


HERE = Path(__file__).resolve().parent
PREVIEW_DIR = HERE / "previews"

load_dotenv(HERE / ".env", override=True)

MAX_PHOTO_BYTES = 5 * 1024 * 1024
MAX_PHOTOS_PER_UPLOAD = 10
DEFAULT_STYLE = "simple, comfortable and put-together"

UPLOAD_LOCK = Lock()


# ---------- Helper functions ----------

def add_photo(path, key, model):
    # Serialize uploads in this process because the database chooses
    # the next available clothing ID.
    with UPLOAD_LOCK:
        return database.add_from_photo(path, key, model)


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
        data = await upload.read(MAX_PHOTO_BYTES + 1)
    finally:
        await upload.close()

    if len(data) > MAX_PHOTO_BYTES:
        raise ValueError("Use a photo smaller than 5 MB.")

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


def with_image_url(item, request: Request):
    """Add an image URL that the frontend can display."""
    item = dict(item)
    path = saved_image_path(item)

    if path:
        relative_path = path.relative_to(
            database.IMAGE_DIR.resolve()
        ).as_posix()

        item["imageUrl"] = (
            str(request.base_url).rstrip("/")
            + "/api/images/"
            + quote(relative_path)
        )
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


def preferences(occasion, weather, notes=""):
    prefs = {
        "style": database.get_setting("style", DEFAULT_STYLE),
        "occasion": occasion,
        "temperatureC": weather["temperatureC"] if weather else None,
        "rain": weather["rain"] if weather else None,
        "notes": notes,
        "excludedItemIds": [],
    }

    if weather:
        prefs["notes"] = (
            notes
            + f" Today's chance of rain is {weather['chanceOfRain']}%."
            + " Do not assume any garment is waterproof."
        ).strip()

    return prefs


def describe(items):
    return " + ".join(item["description"] for item in items)


# ---------- App setup ----------

app = FastAPI(title="Peak Style API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    request: Request,
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

    added = []
    skipped = []

    for upload in items:
        try:
            data = await read_photo(upload)

            with tempfile.TemporaryDirectory() as tmp:
                path = Path(tmp) / "photo"
                path.write_bytes(data)

                item = await run_in_threadpool(
                    add_photo,
                    path,
                    env("GEMINI_API_KEY"),
                    env("GEMINI_TEXT_MODEL"),
                )

            added.append(with_image_url(item, request))

        except (ValueError, RuntimeError) as exc:
            skipped.append({
                "filename": upload.filename,
                "error": redact(str(exc)),
            })

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

    return {
        "message": message,
        "added": added,
        "skipped": skipped,
    }


@api.get("/closet")
def get_closet(request: Request):
    return {
        "items": [
            with_image_url(item, request)
            for item in database.list_items(owned=True)
        ]
    }


@api.delete("/closet/{item_id}")
def delete_closet_item(item_id: str):
    if not database.delete_item(item_id):
        raise HTTPException(404, "No such item.")

    return {"message": "Removed from your closet."}


# ---------- Today's outfit ----------

@api.get("/outfit/today")
def outfit_today(
    request: Request,
    city: Optional[str] = None,
    occasion: str = "everyday",
    photosOnly: bool = False,
):
    """Recommend an outfit using the closet and local weather.

    Set photosOnly=true to choose only items with available photos.
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

    try:
        result = today_outfit(
            closet,
            preferences(occasion[:200], weather),
            env("GEMINI_API_KEY"),
            env("GEMINI_TEXT_MODEL"),
        )
    except (ValueError, RuntimeError) as exc:
        raise fail(exc)

    items = [
        with_image_url(database.get_item(item_id), request)
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


# ---------- Outfit preview ----------

@api.post("/outfit/preview")
async def outfit_preview(
    request: Request,
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
    """Generate a try-on image from a person photo and clothing photos.

    The person photo is stored temporarily for this request.
    """
    ids = [
        item_id.strip()
        for item_id in itemIds.split(",")
        if item_id.strip()
    ]

    if not ids:
        raise HTTPException(400, "Choose at least one clothing item.")

    with_photo = []
    without_photo = []

    # Remove duplicate IDs while preserving order.
    for item_id in dict.fromkeys(ids):
        item = database.get_item(item_id)

        if not item:
            raise HTTPException(404, f"No item with ID {item_id}.")

        if saved_image_path(item):
            with_photo.append(item)
        else:
            without_photo.append(item)

    if not with_photo:
        raise HTTPException(
            400,
            "None of these items has an available photo. "
            "Upload photos or restore the missing files in images/.",
        )

    if len(with_photo) > MAX_CLOTHING_PHOTOS:
        raise HTTPException(
            400,
            f"Choose at most {MAX_CLOTHING_PHOTOS} items with photos.",
        )

    try:
        data = await read_photo(person)

        with tempfile.TemporaryDirectory() as tmp:
            person_path = Path(tmp) / "person"
            person_path.write_bytes(data)

            image, mime = await run_in_threadpool(
                generate_preview,
                person_path,
                [saved_image_path(item) for item in with_photo],
                env("GEMINI_API_KEY"),
                env("GEMINI_IMAGE_MODEL"),
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

    message = (
        "Here's your preview. It's AI-generated, "
        "so the real clothes may look a little different."
    )

    if without_photo:
        message += (
            " Not shown (photo missing or not uploaded): "
            + ", ".join(item["description"] for item in without_photo)
            + "."
        )

    return {
        "message": message,
        "imageUrl": (
            str(request.base_url).rstrip("/")
            + "/api/previews/"
            + name
        ),
        "usedItems": [
            with_image_url(item, request)
            for item in with_photo
        ],
        "skippedItems": [
            item["id"]
            for item in without_photo
        ],
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

        result = await run_in_threadpool(
            recommend_clothing,
            wardrobe,
            env("GEMINI_API_KEY"),
            env("GEMINI_TEXT_MODEL"),
        )

    except (ValueError, RuntimeError) as exc:
        raise fail(exc)

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
    }


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