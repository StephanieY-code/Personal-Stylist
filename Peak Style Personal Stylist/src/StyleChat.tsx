import { FormEvent, useEffect, useRef, useState } from "react"

import { apiRequest, errorMessage } from "./api"

type ChatMessage = {
  role: "user" | "stylist"
  text: string
  styleSuggestion?: string
}

type ChatReply = { reply: string; styleSuggestion: string }

const GREETING =
  "Hi, I’m your Peak Style peacock! Choose a feeling from the list, or tell me about your style and I’ll help you put it into words."

const STARTERS = [
  "Help me find my style",
  "What colors go with my closet?",
  "How can I look put-together but comfy?",
]

// The backend accepts up to 40 messages, so only the most recent ones are sent.
const HISTORY_LIMIT = 39

function ArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}

export default function StyleChat({
  onStyleSaved,
}: {
  onStyleSaved: (style: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState("")
  const [thinking, setThinking] = useState(false)
  const [error, setError] = useState("")
  const [savedStyle, setSavedStyle] = useState("")
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Keep the newest message in view.
  useEffect(() => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [messages, thinking, error])

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || thinking) return

    const history: ChatMessage[] = [...messages, { role: "user", text: question }]
    setMessages(history)
    setDraft("")
    setError("")
    setThinking(true)

    // The chat sent to the backend has to start with one of your messages.
    let recent = history.slice(-HISTORY_LIMIT)
    if (recent[0].role === "stylist") recent = recent.slice(1)

    try {
      const result = await apiRequest<ChatReply>("/style-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: recent.map(({ role, text }) => ({ role, text })),
        }),
      })
      setMessages((current) => [
        ...current,
        { role: "stylist", text: result.reply, styleSuggestion: result.styleSuggestion },
      ])
    } catch (caught) {
      setError(errorMessage(caught, "The peacock lost its train of thought. Try again."))
    } finally {
      setThinking(false)
    }
  }

  const saveStyle = async (style: string) => {
    setError("")
    try {
      const data = new FormData()
      data.append("preference", style.slice(0, 200))
      await apiRequest<{ style: string }>("/style-profile", { method: "POST", body: data })
      setSavedStyle(style)
      onStyleSaved(style)
    } catch (caught) {
      setError(errorMessage(caught, "Could not save this style."))
    }
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void send(draft)
  }

  if (!open) {
    return (
      <div className="stylist-corner">
        <div className="speech-bubble">
          <p>{GREETING}</p>
          <button type="button" className="primary-link" onClick={() => setOpen(true)}>
            Let’s talk style <ArrowIcon />
          </button>
        </div>
        <img className="peacock" src="/assets/peacock.png" alt="The Peak Style peacock" />
      </div>
    )
  }

  const last = messages[messages.length - 1]
  const suggestion = !thinking && last?.role === "stylist" ? last.styleSuggestion : ""

  return (
    <div className="stylist-chat">
      <div className="chat-log" ref={logRef} aria-live="polite">
        <p className="chat-bubble is-stylist">{GREETING}</p>
        {messages.length === 0 && (
          <div className="idea-chips chat-starters" role="group" aria-label="Question ideas">
            {STARTERS.map((starter) => (
              <button type="button" key={starter} onClick={() => void send(starter)}>
                {starter}
              </button>
            ))}
          </div>
        )}
        {messages.map((message, index) => (
          <p key={index} className={`chat-bubble is-${message.role}`}>
            {message.text}
          </p>
        ))}
        {thinking && (
          <p className="chat-bubble is-stylist is-typing" aria-label="The peacock is typing">
            <span />
            <span />
            <span />
          </p>
        )}
        {suggestion &&
          (savedStyle === suggestion ? (
            <p className="chat-saved">Saved as your style ✓</p>
          ) : (
            <button type="button" className="save-style" onClick={() => void saveStyle(suggestion)}>
              Save “{suggestion}” as my style
            </button>
          ))}
        {error && (
          <p className="chat-error" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="chat-footer">
        <img
          className={`peacock is-small ${thinking ? "is-talking" : ""}`}
          src="/assets/peacock.png"
          alt=""
        />
        <form className="chat-input" onSubmit={submit}>
          <input
            ref={inputRef}
            type="text"
            value={draft}
            maxLength={1000}
            placeholder="Ask the peacock about style…"
            aria-label="Your message"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" disabled={thinking || !draft.trim()} aria-label="Send">
            <ArrowIcon />
          </button>
        </form>
      </div>
    </div>
  )
}
