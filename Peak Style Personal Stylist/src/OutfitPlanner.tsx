import { ChangeEvent, FormEvent, useRef, useState } from "react"

import {
  apiRequest,
  ClosetItem,
  errorMessage,
  initialStatus,
  mediaUrl,
  Status,
  Weather,
} from "./api"

type Answers = { city: string; occasion: string; mood: string }

type OutfitResponse = {
  outfit: { itemIds: string[]; reason: string; cautions: string[] }
  items: ClosetItem[]
  weather: Weather | null
  weatherError: string | null
}

type ImageResponse = { message: string; imageUrl: string }

type Look = { status: Status; imageUrl: string | null }

const emptyLook: Look = { status: initialStatus, imageUrl: null }

const EVENT_IDEAS = ["Class", "Work", "Coffee date", "Dinner out", "Party", "Interview"]
const MOOD_IDEAS = ["Confident", "Cozy", "Playful", "Calm", "Bold", "Romantic"]

const CITY_KEY = "peak-style-city"

function savedCity() {
  try {
    return localStorage.getItem(CITY_KEY) ?? ""
  } catch {
    return ""
  }
}

function rememberCity(city: string) {
  try {
    localStorage.setItem(CITY_KEY, city)
  } catch {
    // Private browsing: the city just isn't remembered.
  }
}

function SurveyField({
  label,
  value,
  placeholder,
  ideas = [],
  maxLength,
  onChange,
}: {
  label: string
  value: string
  placeholder: string
  ideas?: string[]
  maxLength: number
  onChange: (value: string) => void
}) {
  return (
    <div className="survey-field">
      <label>
        <span>{label}</span>
        <input
          required
          type="text"
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      </label>
      {ideas.length > 0 && (
        <div className="idea-chips" role="group" aria-label={`${label} ideas`}>
          {ideas.map((idea) => (
            <button
              type="button"
              key={idea}
              aria-pressed={value === idea}
              onClick={() => onChange(idea)}
            >
              {idea}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function OutfitPlanner() {
  const [answers, setAnswers] = useState<Answers>(() => ({
    city: savedCity(),
    occasion: "",
    mood: "",
  }))
  const [step, setStep] = useState<"survey" | "result">("survey")
  const [status, setStatus] = useState<Status>(initialStatus)
  const [outfit, setOutfit] = useState<OutfitResponse | null>(null)
  const [modelLook, setModelLook] = useState<Look>(emptyLook)
  const [myLook, setMyLook] = useState<Look>(emptyLook)
  const [showing, setShowing] = useState<"model" | "me">("model")
  // Each styling run gets a number so late answers from an older run are ignored.
  const runRef = useRef(0)

  const answer = (field: keyof Answers) => (value: string) =>
    setAnswers((current) => ({ ...current, [field]: value }))

  const styleOutfit = async () => {
    const run = ++runRef.current
    const { city, occasion, mood } = answers
    setStep("result")
    window.scrollTo(0, 0)
    setOutfit(null)
    setModelLook(emptyLook)
    setMyLook(emptyLook)
    setShowing("model")
    rememberCity(city)
    setStatus({
      kind: "loading",
      message: `Checking the weather in ${city} and picking pieces from your closet…`,
    })

    let result: OutfitResponse
    try {
      const params = new URLSearchParams({ city, occasion, mood })
      result = await apiRequest<OutfitResponse>(`/outfit/today?${params}`)
    } catch (error) {
      if (run === runRef.current) {
        setStatus({
          kind: "error",
          message: errorMessage(error, "Could not style today's outfit."),
        })
      }
      return
    }
    if (run !== runRef.current) return

    setOutfit(result)
    if (!result.items.length) {
      setStatus({ kind: "error", message: result.outfit.reason })
      return
    }
    setStatus(initialStatus)
    setModelLook({
      status: {
        kind: "loading",
        message: "Dressing your model… this takes about 20 seconds.",
      },
      imageUrl: null,
    })

    try {
      const look = await apiRequest<ImageResponse>("/outfit/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itemIds: result.outfit.itemIds,
          occasion,
          mood,
          temperatureC: result.weather?.temperatureC ?? null,
          chanceOfRain: result.weather?.chanceOfRain ?? null,
        }),
      })
      if (run === runRef.current) {
        setModelLook({
          status: { kind: "success", message: look.message },
          imageUrl: look.imageUrl,
        })
      }
    } catch (error) {
      if (run === runRef.current) {
        setModelLook({
          status: {
            kind: "error",
            message: errorMessage(error, "Could not create the model photo."),
          },
          imageUrl: null,
        })
      }
    }
  }

  const tryOnMe = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // lets you pick the same photo again
    if (!file || !outfit) return

    const run = runRef.current
    setShowing("me")
    setMyLook({
      status: {
        kind: "loading",
        message: "Putting the outfit on you… this takes about 20 seconds.",
      },
      imageUrl: null,
    })

    const data = new FormData()
    data.append("person", file)
    data.append("itemIds", outfit.outfit.itemIds.join(","))
    data.append("notes", [answers.occasion, answers.mood].join(", "))

    try {
      const look = await apiRequest<ImageResponse>("/outfit/preview", {
        method: "POST",
        body: data,
      })
      if (run === runRef.current) {
        setMyLook({
          status: { kind: "success", message: look.message },
          imageUrl: look.imageUrl,
        })
      }
    } catch (error) {
      if (run === runRef.current) {
        setMyLook({
          status: {
            kind: "error",
            message: errorMessage(error, "Could not create your try-on photo."),
          },
          imageUrl: null,
        })
      }
    }
  }

  const editAnswers = () => {
    runRef.current++ // drop any answer still on its way
    setStep("survey")
    window.scrollTo(0, 0)
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void styleOutfit()
  }

  if (step === "survey") {
    return (
      <>
        <div className="tool-intro">
          <p className="eyebrow">A look made for today</p>
          <h1>Today’s outfit</h1>
          <p>
            Three quick questions. We’ll check the weather, pick a look from your
            closet, and show it on a model.
          </p>
        </div>
        <form className="tool-form outfit-survey" onSubmit={submit}>
          <SurveyField
            label="Where are you today?"
            placeholder="e.g. Seattle"
            maxLength={80}
            value={answers.city}
            onChange={answer("city")}
          />
          <SurveyField
            label="What’s the event?"
            placeholder="e.g. Class, brunch, job interview"
            ideas={EVENT_IDEAS}
            maxLength={200}
            value={answers.occasion}
            onChange={answer("occasion")}
          />
          <SurveyField
            label="What’s your mood?"
            placeholder="e.g. Cozy"
            ideas={MOOD_IDEAS}
            maxLength={100}
            value={answers.mood}
            onChange={answer("mood")}
          />
          <button type="submit">Style my outfit</button>
        </form>
      </>
    )
  }

  const look = showing === "me" ? myLook : modelLook
  const busy =
    status.kind === "loading" ||
    modelLook.status.kind === "loading" ||
    myLook.status.kind === "loading"
  const weather = outfit?.weather

  return (
    <>
      <figure className="look-frame">
        {look.imageUrl ? (
          <img
            src={mediaUrl(look.imageUrl)}
            alt={
              showing === "me"
                ? "You wearing today's outfit (AI-generated)"
                : "A model wearing today's outfit (AI-generated)"
            }
          />
        ) : (
          <div
            className={`look-placeholder is-${
              status.kind === "loading" ? "loading" : look.status.kind
            }`}
            role="status"
          >
            <span>PS</span>
            <p>
              {status.kind === "loading"
                ? "Picking your look…"
                : look.status.message || "Your look will appear here."}
            </p>
          </div>
        )}
        {myLook.status.kind !== "idle" && (
          <div className="look-toggle" role="group" aria-label="Show the look on">
            <button
              type="button"
              aria-pressed={showing === "model"}
              onClick={() => setShowing("model")}
            >
              Model
            </button>
            <button
              type="button"
              aria-pressed={showing === "me"}
              onClick={() => setShowing("me")}
            >
              On me
            </button>
          </div>
        )}
        {look.imageUrl && (
          <figcaption>AI-generated · the real clothes may look a little different</figcaption>
        )}
      </figure>

      <div className="look-details">
        <p className="eyebrow">
          {answers.occasion} · {answers.mood}
        </p>
        <h1>Today’s look</h1>

        {weather ? (
          <p className="weather-pill">
            <strong>
              {Math.round(weather.temperatureC)}°C / {Math.round(weather.temperatureC * 1.8 + 32)}°F
            </strong>
            <span>
              {weather.city} · {weather.chanceOfRain}% chance of rain
            </span>
          </p>
        ) : (
          outfit?.weatherError && (
            <p className="weather-pill is-missing">
              Weather unavailable: {outfit.weatherError}
            </p>
          )
        )}

        {status.kind !== "idle" && (
          <p className={`form-status is-${status.kind}`} role="status">
            {status.message}
          </p>
        )}

        {outfit && outfit.items.length > 0 && (
          <>
            <p className="look-reason">{outfit.outfit.reason}</p>
            <ul className="look-items">
              {outfit.items.map((item) => (
                <li key={item.id}>
                  {item.imageUrl ? (
                    <img src={mediaUrl(item.imageUrl)} alt="" />
                  ) : (
                    <span className="piece-thumb" aria-hidden="true">
                      PS
                    </span>
                  )}
                  <div>
                    <strong>{item.description}</strong>
                    <small>
                      {item.color} · {item.category}
                    </small>
                  </div>
                </li>
              ))}
            </ul>
            {outfit.outfit.cautions.length > 0 && (
              <ul className="look-cautions" aria-label="Things to keep in mind">
                {outfit.outfit.cautions.map((caution) => (
                  <li key={caution}>{caution}</li>
                ))}
              </ul>
            )}
          </>
        )}

        <div className="look-actions">
          {outfit && outfit.items.length > 0 && (
            <label className={`look-button ${busy ? "is-disabled" : ""}`}>
              Try it on me
              <input
                type="file"
                accept="image/*"
                disabled={busy}
                onChange={(event) => void tryOnMe(event)}
              />
            </label>
          )}
          <button type="button" onClick={() => void styleOutfit()} disabled={busy}>
            Restyle
          </button>
          <button type="button" className="is-quiet" onClick={editAnswers}>
            Change answers
          </button>
        </div>
        {outfit && outfit.items.length > 0 && (
          <small className="look-note">
            “Try it on me” uses a full-body photo of you only to make this preview.
          </small>
        )}
      </div>
    </>
  )
}
