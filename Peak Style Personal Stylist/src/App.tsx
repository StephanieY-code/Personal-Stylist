import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  MouseEvent,
  useEffect,
  useRef,
  useState,
} from "react"

import {
  apiRequest,
  ClosetItem,
  errorMessage,
  initialStatus,
  mediaUrl,
  Status,
} from "./api"
import OutfitPlanner from "./OutfitPlanner"
import StyleChat from "./StyleChat"

type ClosetResponse = { items: ClosetItem[] }
type UploadResponse = { message: string; added: ClosetItem[] }

type Verdict = "buy" | "maybe" | "bye"
type StyleMatch = "great" | "okay" | "off"
type AnalysisResponse = {
  verdict: Verdict
  message: string
  item: { category: string; color: string; description: string }
  outfits: { id: string; reason: string; cautions: string[]; items: ClosetItem[] }[]
  style: string
  styleReview: {
    styleMatch: StyleMatch
    styleComment: string
    similarComment: string
    similarItems: ClosetItem[]
  } | null
}

const VERDICT_LABEL: Record<Verdict, string> = {
  buy: "It’s a buy",
  maybe: "Maybe",
  bye: "It’s a bye",
}

const MATCH_LABEL: Record<StyleMatch, string> = {
  great: "Great match",
  okay: "Partly you",
  off: "Not quite you",
}

function BrandMark() {
  return (
    <a className="brand-mark" href="/" aria-label="Peak Style home">
      <span>PS</span>
    </a>
  )
}

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

/** A small square showing a closet item's photo, or its description when it has none. */
function PieceTile({ item }: { item: ClosetItem }) {
  return item.imageUrl ? (
    <img className="verdict-piece" src={mediaUrl(item.imageUrl)} alt={item.description} />
  ) : (
    <span className="verdict-piece">
      <span>{item.description}</span>
    </span>
  )
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null
  return (
    <p className={`form-status is-${status.kind}`} role="status">
      {status.message}
    </p>
  )
}

function MainExperience() {
  const closetRef = useRef<HTMLElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [closetOpen, setClosetOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null)
  const [status, setStatus] = useState<Status>(initialStatus)

  useEffect(() => {
    const section = closetRef.current
    if (!section) return

    const observer = new IntersectionObserver(
      ([entry]) => setClosetOpen(entry.isIntersecting),
      { threshold: 0.48 },
    )
    observer.observe(section)
    return () => observer.disconnect()
  }, [])

  // Free the old photo preview whenever a new one replaces it.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  const submitBuyOrBye = async (file: File) => {
    setPreviewUrl(URL.createObjectURL(file))
    setAnalysis(null)
    setStatus({ kind: "loading", message: "Your stylist is taking a look…" })
    const data = new FormData()
    data.append("image", file)

    try {
      const result = await apiRequest<AnalysisResponse>("/analyze", {
        method: "POST",
        body: data,
      })
      setAnalysis(result)
      setStatus({
        kind: "success",
        message: result.message,
      })
      dialogRef.current?.showModal()
    } catch (error) {
      setStatus({
        kind: "error",
        message: errorMessage(
          error,
          "Could not analyze this item. Check the backend and try again.",
        ),
      })
    }
  }

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = "" // lets you pick the same photo again
    if (file) void submitBuyOrBye(file)
  }

  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file?.type.startsWith("image/")) void submitBuyOrBye(file)
  }

  // Clicking the dimmed area outside the card closes the dialog.
  const closeOnBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) event.currentTarget.close()
  }

  return (
    <main className="snap-page">
      <section className="art-section hero" aria-labelledby="welcome-title">
        <img src="/assets/c0fd1.png" alt="" className="slide-art" />
        <div className="hero-copy">
          <p className="eyebrow">Your personal stylist</p>
          <h1 id="welcome-title">Dress like you, only better.</h1>
          <p>Closet clarity, thoughtful outfits, and honest shopping advice.</p>
          <a className="primary-link" href="#closet">
            Meet your closet <ArrowIcon />
          </a>
        </div>
        <a className="scroll-cue" href="#closet">
          <span>Scroll to begin</span>
          <i />
        </a>
      </section>

      <section
        className={`art-section closet-section ${closetOpen ? "is-open" : ""}`}
        id="closet"
        ref={closetRef}
        aria-labelledby="closet-title"
      >
        <div className="closet-heading">
          <p className="eyebrow">Everything you already love</p>
          <h2 id="closet-title">My Closet</h2>
          <p>Scroll in and take a look around.</p>
        </div>

        <div className="closet-reveal" aria-hidden="true">
          <div className="rail" />
          <div className="garment garment-one">Everyday</div>
          <div className="garment garment-two">Work</div>
          <div className="garment garment-three">Weekend</div>
        </div>
        <div className="closet-doors" aria-hidden="true">
          <div className="door door-left">
            <span />
          </div>
          <div className="door door-right">
            <span />
          </div>
        </div>

        <nav className="slide-actions" aria-label="Stylist tools">
          <a href="?view=upload" target="_blank" rel="noreferrer">
            <span>Upload closet</span>
            <ArrowIcon />
          </a>
          <a href="?view=outfit" target="_blank" rel="noreferrer">
            <span>Today’s outfit</span>
            <ArrowIcon />
          </a>
          <a href="?view=style" target="_blank" rel="noreferrer">
            <span>Find your style</span>
            <ArrowIcon />
          </a>
        </nav>
      </section>

      <section
        className="art-section verdict-section"
        id="buy-or-bye"
        aria-labelledby="verdict-title"
      >
        <div className="verdict-heading">
          <span className="pixel-heart" aria-hidden="true">
            ♥
          </span>
          <div>
            <p className="eyebrow">Your honest second opinion</p>
            <h2 id="verdict-title">Buy or Bye</h2>
          </div>
          <span className="pixel-heart" aria-hidden="true">
            ♥
          </span>
        </div>
        <label
          className={`verdict-dropzone ${
            status.kind !== "idle" ? `is-${status.kind}` : ""
          }`}
          onDragOver={(event) => event.preventDefault()}
          onDrop={dropFile}
        >
          <input
            type="file"
            accept="image/*"
            onChange={chooseFile}
            disabled={status.kind === "loading"}
          />
          {previewUrl && status.kind !== "loading" ? (
            <img src={previewUrl} alt="Item for stylist review" />
          ) : (
            <span className={`upload-plus ${status.kind === "loading" ? "is-thinking" : ""}`}>
              +
            </span>
          )}
          <strong>
            {status.kind === "idle"
              ? "Drop your maybe-buy here"
              : status.kind === "success" && analysis
                ? VERDICT_LABEL[analysis.verdict]
                : status.message}
          </strong>
          <small>
            {status.kind === "idle"
              ? "or click to choose a photo"
              : status.kind === "loading"
                ? "This takes a few seconds"
                : "Click to try another"}
          </small>
        </label>
        {analysis && (
          <button
            type="button"
            className="verdict-reopen"
            onClick={() => dialogRef.current?.showModal()}
          >
            See the outfits
          </button>
        )}

        <dialog
          ref={dialogRef}
          className="verdict-dialog"
          aria-labelledby="verdict-result-title"
          onClick={closeOnBackdrop}
        >
          {analysis && (
            <div className="verdict-card">
              <button
                type="button"
                className="verdict-close"
                aria-label="Close"
                onClick={() => dialogRef.current?.close()}
              >
                ×
              </button>
              <header className="verdict-result">
                {previewUrl && <img src={previewUrl} alt="" />}
                <div>
                  <span className={`verdict-badge is-${analysis.verdict}`}>
                    {VERDICT_LABEL[analysis.verdict]}
                  </span>
                  <h3 id="verdict-result-title">{analysis.item.description}</h3>
                  <p>{analysis.message}</p>
                </div>
              </header>
              {analysis.styleReview && (
                <div className="verdict-review">
                  <section>
                    <h4>
                      Your style
                      <span className={`match-badge is-${analysis.styleReview.styleMatch}`}>
                        {MATCH_LABEL[analysis.styleReview.styleMatch]}
                      </span>
                    </h4>
                    <p>{analysis.styleReview.styleComment}</p>
                    <small>Saved style: {analysis.style}</small>
                  </section>
                  <section>
                    <h4>Already in your closet?</h4>
                    {analysis.styleReview.similarItems.length > 0 && (
                      <div className="verdict-pieces">
                        {analysis.styleReview.similarItems.map((item) => (
                          <PieceTile key={item.id} item={item} />
                        ))}
                      </div>
                    )}
                    <p>{analysis.styleReview.similarComment}</p>
                  </section>
                </div>
              )}
              {analysis.outfits.length > 0 && (
                <h4 className="verdict-subhead">Outfits you can make</h4>
              )}
              {analysis.outfits.length > 0 && (
                <ol className="verdict-outfits">
                  {analysis.outfits.map((outfit, index) => (
                    <li key={outfit.id}>
                      <div className="verdict-pieces">
                        {previewUrl && (
                          <img
                            className="verdict-piece is-new"
                            src={previewUrl}
                            alt="The new item"
                          />
                        )}
                        {outfit.items.map((item) => (
                          <PieceTile key={item.id} item={item} />
                        ))}
                      </div>
                      <p>
                        <strong>Outfit {index + 1}.</strong> {outfit.reason}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
              <form method="dialog">
                <button>Close</button>
              </form>
            </div>
          )}
        </dialog>
      </section>
    </main>
  )
}

function ToolIntro({ kicker, title, copy }: { kicker: string; title: string; copy: string }) {
  return (
    <div className="tool-intro">
      <p className="eyebrow">{kicker}</p>
      <h1>{title}</h1>
      <p>{copy}</p>
    </div>
  )
}

function UploadCloset() {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [closetItems, setClosetItems] = useState<ClosetItem[]>([])
  const [chosen, setChosen] = useState(0)

  useEffect(() => {
    let active = true
    void apiRequest<ClosetResponse>("/closet")
      .then((data) => {
        if (active) setClosetItems(data.items)
      })
      .catch((error: unknown) => {
        if (active) {
          setStatus({
            kind: "error",
            message: errorMessage(error, "Could not load your closet."),
          })
        }
      })

    return () => {
      active = false
    }
  }, [])

  const submitCloset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setStatus({
      kind: "loading",
      message: `Adding ${chosen === 1 ? "this piece" : `${chosen} pieces`} to your closet… a few seconds each.`,
    })
    try {
      const result = await apiRequest<UploadResponse>("/closet/upload", {
        method: "POST",
        body: data,
      })
      setClosetItems((items) => {
        const updated = new Map<string, ClosetItem>()
        items.forEach((item) => updated.set(item.id, item))
        result.added.forEach((item) => updated.set(item.id, item))
        return Array.from(updated.values())
      })
      setStatus({
        kind: "success",
        message: result.message,
      })
      form.reset()
      setChosen(0)
    } catch (error) {
      setStatus({
        kind: "error",
        message: errorMessage(error, "Could not upload these photos."),
      })
    }
  }

  const removeClosetItem = async (itemId: string) => {
    setStatus({ kind: "loading", message: "Removing this piece…" })
    try {
      await apiRequest<{ message: string }>(
        `/closet/${encodeURIComponent(itemId)}`,
        { method: "DELETE" },
      )
      setClosetItems((items) => items.filter((item) => item.id !== itemId))
      setStatus({ kind: "success", message: "Removed from your closet." })
    } catch (error) {
      setStatus({
        kind: "error",
        message: errorMessage(error, "Could not remove this item."),
      })
    }
  }

  return (
    <>
      <ToolIntro
        kicker="Build your digital wardrobe"
        title="Upload your closet"
        copy="Add a few favorite pieces. Your stylist will learn what you own and what you actually wear."
      />

      <form className="tool-form" onSubmit={submitCloset}>
        <label className="file-field">
          <input
            required
            type="file"
            name="items"
            accept="image/*"
            multiple
            onChange={(event) => setChosen(event.target.files?.length ?? 0)}
          />
          <span className="upload-plus">+</span>
          <strong>
            {chosen
              ? `${chosen} photo${chosen === 1 ? "" : "s"} chosen`
              : "Choose clothing photos"}
          </strong>
          <small>JPG, PNG, or WEBP · up to 10 at a time</small>
        </label>
        <button type="submit" disabled={status.kind === "loading"}>
          Add to my closet
        </button>
      </form>

      <section className="closet-items" aria-label="Your closet items">
        <h2>Your closet ({closetItems.length})</h2>
        {closetItems.map((item) => (
          <article className="closet-item" key={item.id}>
            {item.imageUrl ? (
              <img src={mediaUrl(item.imageUrl)} alt={item.description} />
            ) : (
              <div className="closet-item-placeholder" aria-hidden="true">
                PS
              </div>
            )}
            <div>
              <strong>{item.description}</strong>
              <small>
                {item.color} · {item.category}
              </small>
            </div>
            <button
              type="button"
              className="remove-item"
              onClick={() => void removeClosetItem(item.id)}
              disabled={status.kind === "loading"}
              aria-label={`Remove ${item.description}`}
            >
              Remove
            </button>
          </article>
        ))}
        {closetItems.length === 0 && (
          <p className="empty-closet">Your closet is empty. Add a photo to begin.</p>
        )}
      </section>

      <StatusLine status={status} />
    </>
  )
}

const STYLE_CHOICES = [
  "Effortless & refined",
  "Playful & expressive",
  "Minimal & calm",
]

function StyleProfile() {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [choice, setChoice] = useState("")
  const [ownWords, setOwnWords] = useState("")
  const [currentStyle, setCurrentStyle] = useState("")

  useEffect(() => {
    let active = true
    void apiRequest<{ style: string }>("/style-profile")
      .then((data) => {
        if (!active) return
        setCurrentStyle(data.style)
        if (STYLE_CHOICES.includes(data.style)) setChoice(data.style)
      })
      .catch(() => {
        // Not critical: the form still works without the current style.
      })
    return () => {
      active = false
    }
  }, [])

  const submitStyle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const preference = ownWords.trim() || choice
    if (!preference) {
      setStatus({ kind: "error", message: "Pick a feeling or describe your style." })
      return
    }
    setStatus({ kind: "loading", message: "Reading your style signals…" })
    try {
      const data = new FormData()
      data.append("preference", preference)
      const result = await apiRequest<{ message: string; style: string }>(
        "/style-profile",
        {
          method: "POST",
          body: data,
        },
      )
      setCurrentStyle(result.style)
      setStatus({
        kind: "success",
        message: `${result.message} Today’s outfit will follow it.`,
      })
    } catch (error) {
      setStatus({
        kind: "error",
        message: errorMessage(error, "Could not save your style preference."),
      })
    }
  }

  const savedFromChat = (style: string) => {
    setCurrentStyle(style)
    setChoice(STYLE_CHOICES.includes(style) ? style : "")
    setOwnWords("")
    setStatus({
      kind: "success",
      message: "Saved from your chat with the peacock. Today’s outfit will follow it.",
    })
  }

  return (
    <>
      <StyleChat onStyleSaved={savedFromChat} />

      <form className="tool-form style-form" onSubmit={submitStyle}>
        <p className="eyebrow style-kicker">Find your style</p>
        {currentStyle && (
          <p className="current-style">
            Your style right now: <strong>{currentStyle}</strong>
          </p>
        )}
        <fieldset>
          <legend>I want my wardrobe to feel…</legend>
          {STYLE_CHOICES.map((option) => (
            <label key={option}>
              <input
                type="radio"
                name="style"
                value={option}
                checked={!ownWords.trim() && choice === option}
                onChange={() => {
                  setChoice(option)
                  setOwnWords("")
                }}
              />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
        <label className="own-words">
          <span>Or say it in your own words</span>
          <input
            type="text"
            maxLength={200}
            placeholder="e.g. Clean lines, earthy colors, nothing too tight"
            value={ownWords}
            onChange={(event) => setOwnWords(event.target.value)}
          />
        </label>
        <button type="submit" disabled={status.kind === "loading"}>
          Create my style profile
        </button>
        {status.kind === "success" && (
          <a className="next-link" href="?view=outfit">
            Style today’s outfit <ArrowIcon />
          </a>
        )}
      </form>

      <StatusLine status={status} />
    </>
  )
}

function ToolPage({ view }: { view: string }) {
  return (
    <main className="tool-page">
      <BrandMark />
      <a className="back-link" href="/">
        ← Back home
      </a>
      <section className="tool-card">
        {view === "upload" ? (
          <UploadCloset />
        ) : view === "outfit" ? (
          <OutfitPlanner />
        ) : view === "style" ? (
          <StyleProfile />
        ) : (
          <ToolIntro
            kicker="Peak Style"
            title="Your personal stylist"
            copy="Return home to explore your closet."
          />
        )}
      </section>
    </main>
  )
}

export default function App() {
  const view = new URLSearchParams(window.location.search).get("view")
  return view ? <ToolPage view={view} /> : <MainExperience />
}
