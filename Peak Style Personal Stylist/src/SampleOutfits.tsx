import { ChangeEvent, MouseEvent, useEffect, useRef, useState } from "react"

import {
  apiRequest,
  ClosetItem,
  errorMessage,
  initialStatus,
  mediaUrl,
  Status,
} from "./api"

type Sample = {
  occasion: string
  outfit: { itemIds: string[]; reason: string; cautions: string[] } | null
  error: string | null
  items: ClosetItem[]
}

type ImageResponse = { message: string; imageUrl: string }

type Look = { status: Status; imageUrl: string | null }

type Looks = { model: Look; me: Look; showing: "model" | "me" }

const emptyLook: Look = { status: initialStatus, imageUrl: null }
const emptyLooks: Looks = { model: emptyLook, me: emptyLook, showing: "model" }

const RACK = [
  { occasion: "everyday", label: "Everyday", className: "garment-one" },
  { occasion: "work", label: "Work", className: "garment-two" },
  { occasion: "weekend", label: "Weekend", className: "garment-three" },
]

/** The three garments in the home page closet: a sample outfit for each occasion. */
export default function SampleOutfits() {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [samples, setSamples] = useState<Sample[] | null>(null)
  const [openOccasion, setOpenOccasion] = useState<string | null>(null)
  // Generated photos per occasion, so reopening a sample keeps them.
  const [looks, setLooks] = useState<Record<string, Looks>>({})

  useEffect(() => {
    let active = true
    apiRequest<{ samples: Sample[] }>("/outfit/samples")
      .then((result) => {
        if (active) setSamples(result.samples)
      })
      .catch(() => {
        if (active) setSamples([]) // no backend: the closet just stays empty
      })
    return () => {
      active = false
    }
  }, [])

  const sampleFor = (occasion: string) =>
    samples?.find((sample) => sample.occasion === occasion && sample.items.length)

  const open = openOccasion ? sampleFor(openOccasion) : undefined
  const openLooks = (openOccasion && looks[openOccasion]) || emptyLooks

  const updateLooks = (occasion: string, change: Partial<Looks>) =>
    setLooks((current) => ({
      ...current,
      [occasion]: { ...(current[occasion] || emptyLooks), ...change },
    }))

  const showSample = (occasion: string) => {
    setOpenOccasion(occasion)
    dialogRef.current?.showModal()
  }

  const showOnModel = async (sample: Sample) => {
    const { occasion } = sample
    updateLooks(occasion, {
      showing: "model",
      model: {
        status: { kind: "loading", message: "Dressing your model… this takes about 20 seconds." },
        imageUrl: null,
      },
    })
    try {
      const look = await apiRequest<ImageResponse>("/outfit/look", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemIds: sample.items.map((item) => item.id), occasion }),
      })
      updateLooks(occasion, {
        model: { status: { kind: "success", message: look.message }, imageUrl: look.imageUrl },
      })
    } catch (error) {
      updateLooks(occasion, {
        model: {
          status: { kind: "error", message: errorMessage(error, "Could not create the model photo.") },
          imageUrl: null,
        },
      })
    }
  }

  const tryOnMe = async (sample: Sample, event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // lets you pick the same photo again
    if (!file) return

    const { occasion } = sample
    updateLooks(occasion, {
      showing: "me",
      me: {
        status: { kind: "loading", message: "Putting the outfit on you… this takes about 20 seconds." },
        imageUrl: null,
      },
    })

    const data = new FormData()
    data.append("person", file)
    data.append("itemIds", sample.items.map((item) => item.id).join(","))
    data.append("notes", occasion)

    try {
      const look = await apiRequest<ImageResponse>("/outfit/preview", {
        method: "POST",
        body: data,
      })
      updateLooks(occasion, {
        me: { status: { kind: "success", message: look.message }, imageUrl: look.imageUrl },
      })
    } catch (error) {
      updateLooks(occasion, {
        me: {
          status: { kind: "error", message: errorMessage(error, "Could not create your try-on photo.") },
          imageUrl: null,
        },
      })
    }
  }

  // Clicking the dimmed area outside the card closes the dialog.
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) event.currentTarget.close()
  }

  const look = openLooks.showing === "me" ? openLooks.me : openLooks.model
  const busy =
    openLooks.model.status.kind === "loading" || openLooks.me.status.kind === "loading"
  const label = RACK.find((garment) => garment.occasion === openOccasion)?.label

  return (
    <>
      {RACK.map((garment) => {
        const sample = sampleFor(garment.occasion)
        if (!sample) {
          return (
            <div
              key={garment.occasion}
              className={`garment ${garment.className} ${samples === null ? "is-loading" : ""}`}
              aria-hidden="true"
            >
              {garment.label}
            </div>
          )
        }
        return (
          <button
            type="button"
            key={garment.occasion}
            className={`garment ${garment.className} has-outfit`}
            onClick={() => showSample(garment.occasion)}
            aria-label={`See the ${garment.label.toLowerCase()} outfit`}
          >
            <span className="garment-pieces">
              {sample.items.slice(0, 4).map((item) =>
                item.imageUrl ? (
                  <img key={item.id} src={mediaUrl(item.imageUrl)} alt="" />
                ) : (
                  <span key={item.id} className="piece-thumb">
                    PS
                  </span>
                ),
              )}
            </span>
            <span className="garment-label">{garment.label}</span>
          </button>
        )
      })}

      <dialog
        ref={dialogRef}
        className="verdict-dialog sample-dialog"
        aria-labelledby="sample-title"
        onClick={closeOnBackdrop}
        onClose={() => setOpenOccasion(null)}
      >
        {open && open.outfit && (
          <div className="verdict-card sample-card">
            <button
              type="button"
              className="verdict-close"
              aria-label="Close"
              onClick={() => dialogRef.current?.close()}
            >
              ×
            </button>

            <figure className="look-frame">
              {look.imageUrl ? (
                <img
                  src={mediaUrl(look.imageUrl)}
                  alt={
                    openLooks.showing === "me"
                      ? `You wearing the ${label} outfit (AI-generated)`
                      : `A model wearing the ${label} outfit (AI-generated)`
                  }
                />
              ) : (
                <div className={`look-placeholder is-${look.status.kind}`} role="status">
                  <span>PS</span>
                  <p>
                    {look.status.message ||
                      "See this look on a model, or upload a full-body photo to try it on you."}
                  </p>
                </div>
              )}
              {openLooks.me.status.kind !== "idle" && openLooks.model.status.kind !== "idle" && (
                <div className="look-toggle" role="group" aria-label="Show the look on">
                  <button
                    type="button"
                    aria-pressed={openLooks.showing === "model"}
                    onClick={() => updateLooks(open.occasion, { showing: "model" })}
                  >
                    Model
                  </button>
                  <button
                    type="button"
                    aria-pressed={openLooks.showing === "me"}
                    onClick={() => updateLooks(open.occasion, { showing: "me" })}
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
              <p className="eyebrow">From your closet</p>
              <h1 id="sample-title">{label} look</h1>
              <p className="look-reason">{open.outfit.reason}</p>
              <ul className="look-items">
                {open.items.map((item) => (
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
              {open.outfit.cautions.length > 0 && (
                <ul className="look-cautions" aria-label="Things to keep in mind">
                  {open.outfit.cautions.map((caution) => (
                    <li key={caution}>{caution}</li>
                  ))}
                </ul>
              )}
              <div className="look-actions">
                <button type="button" onClick={() => void showOnModel(open)} disabled={busy}>
                  {openLooks.model.imageUrl ? "New model photo" : "Show on a model"}
                </button>
                <label className={`look-button is-quiet ${busy ? "is-disabled" : ""}`}>
                  Try it on me
                  <input
                    type="file"
                    accept="image/*"
                    disabled={busy}
                    onChange={(event) => void tryOnMe(open, event)}
                  />
                </label>
              </div>
              <small className="look-note">
                “Try it on me” uses a full-body photo of you only to make this preview.
              </small>
            </div>
          </div>
        )}
      </dialog>
    </>
  )
}
