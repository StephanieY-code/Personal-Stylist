import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react"

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api"

type Status = { kind: "idle" | "loading" | "success" | "error" message: string }

const initialStatus: Status = { kind: "idle", message: "" }

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

function MainExperience() {
  const closetRef = useRef<HTMLElement>(null)
  const [closetOpen, setClosetOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
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

  const submitBuyOrBye = async (file: File) => {
    setStatus({ kind: "loading", message: "Your stylist is taking a look…" })
    const data = new FormData()
    data.append("image", file)

    try {
      const response = await fetch(`${API_BASE}/analyze`, {
        method: "POST",
        body: data,
      })
      if (!response.ok) throw new Error("Analysis request failed")
      const result = await response.json()
      setStatus({
        kind: "success",
        message:
          result.message ??
          result.verdict ??
          "It’s a buy — this piece fits your style.",
      })
    } catch {
      setStatus({
        kind: "error",
        message:
          "Your stylist backend is offline. Start the Python API and try again.",
      })
    }
  }

  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) {
      setSelectedFile(file)
      void submitBuyOrBye(file)
    }
  }

  const dropFile = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    const file = event.dataTransfer.files?.[0]
    if (file?.type.startsWith("image/")) {
      setSelectedFile(file)
      void submitBuyOrBye(file)
    }
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
          <input type="file" accept="image/*" onChange={chooseFile} />
          {selectedFile && status.kind !== "loading" ? (
            <img
              src={URL.createObjectURL(selectedFile)}
              alt="Item for stylist review"
            />
          ) : (
            <span className="upload-plus">+</span>
          )}
          <strong>
            {status.kind === "idle"
              ? "Drop your maybe-buy here"
              : status.message}
          </strong>
          <small>
            {status.kind === "idle"
              ? "or click to choose a photo"
              : "Click to try another"}
          </small>
        </label>
      </section>
    </main>
  )
}

function ToolPage({ view }: { view: string }) {
  const [status, setStatus] = useState<Status>(initialStatus)
  const [answer, setAnswer] = useState("")

  const submitCloset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    setStatus({ kind: "loading", message: "Adding pieces to your closet…" })
    try {
      const response = await fetch(`${API_BASE}/closet/upload`, {
        method: "POST",
        body: data,
      })
      if (!response.ok) throw new Error("Upload failed")
      setStatus({
        kind: "success",
        message: "Your closet is ready for styling.",
      })
      form.reset()
    } catch {
      setStatus({
        kind: "error",
        message: "Couldn’t reach the Python backend. Please try again.",
      })
    }
  }

  const fetchOutfit = async () => {
    setStatus({ kind: "loading", message: "Styling your look…" })
    try {
      const response = await fetch(`${API_BASE}/outfit/today`)
      if (!response.ok) throw new Error("Outfit request failed")
      const data = await response.json()
      setStatus({
        kind: "success",
        message: data.message ?? data.outfit ?? "Your outfit is ready.",
      })
    } catch {
      setStatus({
        kind: "error",
        message: "Connect the Python backend to generate today’s look.",
      })
    }
  }

  const submitStyle = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setStatus({ kind: "loading", message: "Reading your style signals…" })
    try {
      const response = await fetch(`${API_BASE}/style-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preference: answer }),
      })
      if (!response.ok) throw new Error("Style request failed")
      const data = await response.json()
      setStatus({
        kind: "success",
        message: data.message ?? data.style ?? "Style profile saved.",
      })
    } catch {
      setStatus({
        kind: "error",
        message: "Connect the Python backend to save your style profile.",
      })
    }
  }

  const content = {
    upload: {
      kicker: "Build your digital wardrobe",
      title: "Upload your closet",
      copy: "Add a few favorite pieces. Your stylist will learn what you own and what you actually wear.",
    },
    outfit: {
      kicker: "A look made for today",
      title: "Today’s outfit",
      copy: "We’ll pair pieces from your closet into a polished look that feels completely like you.",
    },
    style: {
      kicker: "A quick style check-in",
      title: "Find your style",
      copy: "Tell us which feeling you want from your wardrobe, and we’ll shape your personal style direction.",
    },
  }[view] ?? {
    kicker: "Peak Style",
    title: "Your personal stylist",
    copy: "Return home to explore your closet.",
  }

  return (
    <main className="tool-page">
      <BrandMark />
      <a className="back-link" href="/">
        ← Back home
      </a>
      <section className="tool-card">
        <div className="tool-intro">
          <p className="eyebrow">{content.kicker}</p>
          <h1>{content.title}</h1>
          <p>{content.copy}</p>
        </div>

        {view === "upload" && (
          <form className="tool-form" onSubmit={submitCloset}>
            <label className="file-field">
              <input
                required
                type="file"
                name="items"
                accept="image/*"
                multiple
              />
              <span className="upload-plus">+</span>
              <strong>Choose clothing photos</strong>
              <small>JPG, PNG, or WEBP</small>
            </label>
            <button type="submit">Add to my closet</button>
          </form>
        )}

        {view === "outfit" && (
          <div className="outfit-preview">
            <div className="outfit-shape">
              <span>PS</span>
            </div>
            <button type="button" onClick={fetchOutfit}>
              Style my outfit
            </button>
          </div>
        )}

        {view === "style" && (
          <form className="tool-form style-form" onSubmit={submitStyle}>
            <fieldset>
              <legend>I want my wardrobe to feel…</legend>
              {[
                "Effortless & refined",
                "Playful & expressive",
                "Minimal & calm",
              ].map((choice) => (
                <label key={choice}>
                  <input
                    required
                    type="radio"
                    name="style"
                    value={choice}
                    onChange={() => setAnswer(choice)}
                  />
                  <span>{choice}</span>
                </label>
              ))}
            </fieldset>
            <button type="submit">Create my style profile</button>
          </form>
        )}

        {status.kind !== "idle" && (
          <p className={`form-status is-${status.kind}`} role="status">
            {status.message}
          </p>
        )}
      </section>
    </main>
  )
}

export default function App() {
  const view = new URLSearchParams(window.location.search).get("view")
  return view ? <ToolPage view={view} /> : <MainExperience />
}
