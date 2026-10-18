"""Store the closet in SQLite (wardrobe.db) instead of wardrobe.json.

Uses your existing functions unchanged: analyze_clothing, recommend_clothing, get_weather.

Commands:
  python database.py seed wardrobe.json            # import the items from your JSON once
  python database.py add shirt.png                 # analyze a photo with Gemini and save it
  python database.py add blazer.jpg --candidate    # save an item you are thinking of buying
  python database.py list                          # show everything saved
  python database.py delete top_01                 # remove an item
  python database.py recommend candidate_01 --city Seattle
        # outfits from saved clothes; style/occasion/notes come from wardrobe.json "preferences"

Later, FastAPI endpoints can call these same functions (add_item, list_items, ...).
"""

import argparse
import copy
import json
import os
import sqlite3
import sys
from pathlib import Path

from dotenv import load_dotenv

from analyze_clothing import CATEGORIES, analyze_clothing, prepare_image
from get_weather import get_weather
from recommend_clothing import recommend_clothing

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "wardrobe.db"
IMAGE_DIR = HERE / "images"


def connect():
    """Open the database and create the table the first time."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row  # rows behave like dicts
    conn.execute("""
        CREATE TABLE IF NOT EXISTS items (
            id          TEXT PRIMARY KEY,
            category    TEXT NOT NULL,
            color       TEXT NOT NULL,
            description TEXT NOT NULL,
            owned       INTEGER NOT NULL DEFAULT 1,   -- 1 = in closet, 0 = thinking of buying
            image_path  TEXT,                          -- e.g. images/top_06.jpg
            created_at  TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Simple key/value settings, e.g. the user's style profile.
    conn.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
    return conn


def get_setting(key, default=None):
    with connect() as conn:
        row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def set_setting(key, value):
    with connect() as conn:
        conn.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def next_id(conn, category, owned=True):
    """top_06, bottoms_05, candidate_02 ... the next free number."""
    prefix = category if owned else "candidate"
    n = 1
    while conn.execute("SELECT 1 FROM items WHERE id = ?", (f"{prefix}_{n:02d}",)).fetchone():
        n += 1
    return f"{prefix}_{n:02d}"


def add_item(category, color, description, owned=True, image_bytes=None, item_id=None):
    if category not in CATEGORIES:
        raise ValueError(f"Invalid category: {category}")
    with connect() as conn:  # commits automatically
        item_id = item_id or next_id(conn, category, owned)
        image_path = None
        if image_bytes:
            IMAGE_DIR.mkdir(exist_ok=True)
            image_path = f"images/{item_id}.jpg"
            (HERE / image_path).write_bytes(image_bytes)
        try:
            # "?" placeholders keep user text from breaking the SQL (no SQL injection).
            conn.execute(
                "INSERT INTO items (id, category, color, description, owned, image_path) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (item_id, category, color, description, int(owned), image_path),
            )
        except sqlite3.IntegrityError:
            raise ValueError(f"An item with ID {item_id} already exists.") from None
    return get_item(item_id)


def add_from_photo(photo: Path, key, model, owned=True):
    """Gemini describes the photo, then the item and a cleaned copy of the photo are saved."""
    result = analyze_clothing(photo, key, model)
    item = add_item(result["category"], result["color"], result["description"],
                    owned=owned, image_bytes=prepare_image(photo))
    item["uncertainties"] = result["uncertainties"]  # shown to the user, not stored
    return item


def get_item(item_id):
    with connect() as conn:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return dict(row) if row else None


def list_items(owned=None):
    query, params = "SELECT * FROM items", ()
    if owned is not None:
        query, params = query + " WHERE owned = ?", (int(owned),)
    with connect() as conn:
        return [dict(r) for r in conn.execute(query + " ORDER BY category, id", params)]


def delete_item(item_id):
    item = get_item(item_id)
    if not item:
        return False
    with connect() as conn:
        conn.execute("DELETE FROM items WHERE id = ?", (item_id,))
    if item["image_path"]:
        (HERE / item["image_path"]).unlink(missing_ok=True)
    return True


def build_wardrobe(candidate_id, preferences):
    """Turn database rows into the exact JSON shape recommend_clothing() expects."""
    def clean(item):
        return {k: item[k] for k in ("id", "category", "color", "description")}

    candidate = get_item(candidate_id)
    if not candidate:
        raise ValueError(f"No item with ID {candidate_id}.")
    closet = [clean(i) for i in list_items(owned=True) if i["id"] != candidate_id]
    if not closet:
        raise ValueError("Add at least one owned item first.")
    if len(closet) > 30:
        raise ValueError("recommend_clothing accepts up to 30 owned items.")
    valid_ids = {i["id"] for i in closet} | {candidate_id}
    prefs = copy.deepcopy(preferences)
    prefs["excludedItemIds"] = [x for x in prefs.get("excludedItemIds", []) if x in valid_ids]
    return {"closetItems": closet, "candidate": clean(candidate), "preferences": prefs}


def recommend_from_db(candidate_id, preferences, key, model, city=None, weather_key=""):
    wardrobe = build_wardrobe(candidate_id, preferences)
    weather = None
    if city:
        weather = get_weather(city, weather_key)
        prefs = wardrobe["preferences"]
        prefs["temperatureC"] = weather["temperatureC"]
        prefs["rain"] = weather["rain"]
        prefs["notes"] = (prefs.get("notes", "") + f" Weather context: today's chance of rain is "
                          f"{weather['chanceOfRain']}%. Do not assume any garment is waterproof.")[:1000]
    return {"weather": weather, **recommend_clothing(wardrobe, key, model)}


def seed_from_json(path: Path):
    data = json.loads(path.read_text(encoding="utf-8"))
    added = 0
    for item, owned in [(i, True) for i in data.get("closetItems", [])] + [(data["candidate"], False)]:
        if not get_item(item["id"]):
            add_item(item["category"], item["color"], item["description"], owned=owned, item_id=item["id"])
            added += 1
    return added


def main():
    parser = argparse.ArgumentParser(description="Manage the closet database.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("seed").add_argument("json_file", type=Path)
    p_add = sub.add_parser("add")
    p_add.add_argument("photo", type=Path)
    p_add.add_argument("--candidate", action="store_true", help="An item you are thinking of buying")
    sub.add_parser("list")
    sub.add_parser("delete").add_argument("item_id")
    p_rec = sub.add_parser("recommend")
    p_rec.add_argument("candidate_id")
    p_rec.add_argument("--city")
    p_rec.add_argument("--prefs", type=Path, default=HERE / "wardrobe.json",
                       help="JSON file whose 'preferences' are used (default wardrobe.json)")
    args = parser.parse_args()

    load_dotenv(HERE / ".env", override=True)
    key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_TEXT_MODEL", "").strip()
    weather_key = os.getenv("WEATHER_API_KEY", "").strip()

    try:
        if args.command == "seed":
            print(f"Added {seed_from_json(args.json_file)} items to {DB_PATH.name}.")
        elif args.command == "add":
            output = add_from_photo(args.photo, key, model, owned=not args.candidate)
            print(json.dumps(output, indent=2, ensure_ascii=False))
        elif args.command == "list":
            for i in list_items():
                tag = "" if i["owned"] else "  (candidate)"
                print(f"{i['id']:14} {i['color']:14} {i['description']}{tag}")
        elif args.command == "delete":
            print("Deleted." if delete_item(args.item_id) else "No such item.")
        elif args.command == "recommend":
            prefs = json.loads(args.prefs.read_text(encoding="utf-8"))["preferences"]
            output = recommend_from_db(args.candidate_id, prefs, key, model, args.city, weather_key)
            print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0
    except (OSError, ValueError, RuntimeError, KeyError) as exc:
        message = str(exc)
        for secret in (key, weather_key):
            if secret:
                message = message.replace(secret, "[KEY REDACTED]")
        print(message, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())