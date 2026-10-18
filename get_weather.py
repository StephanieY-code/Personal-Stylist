import argparse
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv


def get_weather(city, api_key):
    if not api_key:
        raise ValueError("Add WEATHER_API_KEY to your .env file.")

    if not city.strip():
        raise ValueError("Enter a city.")

    try:
        response = httpx.get(
            "https://api.weatherapi.com/v1/forecast.json",
            params={
                "key": api_key,
                "q": city.strip(),
                "days": 1,
                "aqi": "no",
                "alerts": "no",
            },
            timeout=20,
        )
    except httpx.TimeoutException:
        raise RuntimeError("Weather request timed out.") from None
    except httpx.RequestError:
        raise RuntimeError("Could not connect to WeatherAPI.") from None

    if not response.is_success:
        try:
            message = response.json()["error"]["message"]
        except (ValueError, KeyError, TypeError):
            message = "Could not retrieve weather."

        # Avoid exposing the key in error messages.
        message = str(message).replace(api_key, "[KEY REDACTED]")
        raise RuntimeError(
            f"Weather HTTP {response.status_code}: {message}"
        )

    try:
        data = response.json()
        location = data["location"]
        current = data["current"]
        forecast = data["forecast"]["forecastday"][0]
        day = forecast["day"]

        temperature = float(current["temp_c"])
        rain_flag = int(day["daily_will_it_rain"])
        rain_chance = int(day["daily_chance_of_rain"])

        if not -60 <= temperature <= 60:
            raise ValueError("Invalid temperature.")

        if rain_flag not in (0, 1) or not 0 <= rain_chance <= 100:
            raise ValueError("Invalid rain forecast.")

        return {
            "city": location["name"],
            "region": location.get("region", ""),
            "country": location["country"],
            "temperatureC": temperature,
            "rain": rain_flag == 1,
            "chanceOfRain": rain_chance,
            "observedAt": current["last_updated"],
            "forecastDate": forecast["date"],
            "scope": "Current temperature and today's rain forecast",
            "source": "WeatherAPI.com",
        }

    except (ValueError, KeyError, IndexError, TypeError):
        raise RuntimeError(
            "WeatherAPI returned incomplete or invalid data."
        ) from None


def main():
    parser = argparse.ArgumentParser(description="Get weather for a city.")
    parser.add_argument("city", help='Example: Seattle or "New York"')
    args = parser.parse_args()

    env_path = Path(__file__).resolve().parent / ".env"
    load_dotenv(env_path, override=True)

    api_key = os.getenv("WEATHER_API_KEY", "").strip()

    try:
        weather = get_weather(args.city, api_key)
        print(json.dumps(weather, indent=2, ensure_ascii=False))
        return 0

    except (ValueError, RuntimeError) as error:
        message = str(error)
        if api_key:
            message = message.replace(api_key, "[KEY REDACTED]")
        print(message)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())