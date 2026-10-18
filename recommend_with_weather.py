import argparse
import copy
import json
import os
from pathlib import Path

from dotenv import load_dotenv

from get_weather import get_weather
from recommend_clothing import check_request, recommend_clothing


def main():
    parser = argparse.ArgumentParser(
        description="Recommend outfits using weather for today."
    )
    parser.add_argument("wardrobe", type=Path)
    parser.add_argument("city")
    args = parser.parse_args()

    env_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(env_path, override=True)

    gemini_key = os.getenv("GEMINI_API_KEY", "").strip()
    model = os.getenv("GEMINI_TEXT_MODEL", "").strip()
    weather_key = os.getenv("WEATHER_API_KEY", "").strip()

    try:
        if not gemini_key or not model:
            raise ValueError(
                "Set GEMINI_API_KEY and GEMINI_TEXT_MODEL in .env."
            )

        if args.wardrobe.stat().st_size > 100_000:
            raise ValueError("Wardrobe JSON must be under 100 KB.")

        # Read the existing clothing and preferences.
        wardrobe = json.loads(
            args.wardrobe.read_text(encoding="utf-8")
        )
        check_request(wardrobe)

        # Get real weather. If this fails, stop instead of inventing weather.
        weather = get_weather(args.city, weather_key)

        # Update an in-memory copy; do not overwrite wardrobe.json.
        request = copy.deepcopy(wardrobe)
        request["preferences"]["temperatureC"] = weather["temperatureC"]
        request["preferences"]["rain"] = weather["rain"]

        request["preferences"]["chanceOfRain"] = weather["chanceOfRain"]

        existing_notes = request["preferences"].get("notes", "")
        request["preferences"]["notes"] = (
            existing_notes
            + f" Weather context: today's chance of rain is "
            + f"{weather['chanceOfRain']}%. Consider this probability even "
            + "if the provider's rain flag is false. Do not assume any "
            + "garment is waterproof."
        )

        # Call your existing recommendation function.
        recommendations = recommend_clothing(
            request,
            gemini_key,
            model,
        )

        output = {
            "weather": weather,
            **recommendations,
        }

        print(json.dumps(output, indent=2, ensure_ascii=False))
        return 0

    except (OSError, ValueError, RuntimeError) as error:
        message = str(error)

        for key in (gemini_key, weather_key):
            if key:
                message = message.replace(key, "[KEY REDACTED]")

        print(message)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())