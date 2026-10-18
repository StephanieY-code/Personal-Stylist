import { FormEvent, useState } from "react"

import { apiRequest, errorMessage, initialStatus, Status } from "./api"

function Heart() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 2.9 4.5 6.6 4.5c2.2 0 3.6 1.2 5.4 3.2 1.8-2 3.2-3.2 5.4-3.2 3.7 0 5.7 3.9 4.2 7.3C19.5 16.4 12 21 12 21z" />
    </svg>
  )
}

const RATING_WORDS = ["", "Not for me", "It’s okay", "I like it", "I really like it", "I love it"]

/** Rate Peak Style from 1 to 5 hearts and leave an optional comment. */
export default function Feedback() {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [message, setMessage] = useState("")
  const [status, setStatus] = useState<Status>(initialStatus)

  const shown = hovered || rating

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!rating) {
      setStatus({ kind: "error", message: "Tap a heart to give your rating." })
      return
    }
    setStatus({ kind: "loading", message: "Sending your feedback…" })
    try {
      const result = await apiRequest<{ message: string }>("/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, message }),
      })
      setStatus({ kind: "success", message: result.message })
    } catch (error) {
      setStatus({
        kind: "error",
        message: errorMessage(error, "Could not send your feedback."),
      })
    }
  }

  if (status.kind === "success") {
    return (
      <>
        <div className="tool-intro">
          <p className="eyebrow">Feedback</p>
          <h1>Thank you!</h1>
          <p>{status.message} It helps us make Peak Style better.</p>
        </div>
        <div className="feedback-thanks" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((heart) => (
            <span key={heart} className={heart <= rating ? "is-on" : ""}>
              <Heart />
            </span>
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="tool-intro">
        <p className="eyebrow">Feedback</p>
        <h1>How are we doing?</h1>
        <p>Tell us how you like Peak Style. Every rating and note is read.</p>
      </div>

      <form className="tool-form feedback-form" onSubmit={submit}>
        <fieldset>
          <legend>Your rating</legend>
          <div className="heart-rating" onMouseLeave={() => setHovered(0)}>
            {[1, 2, 3, 4, 5].map((heart) => (
              <button
                type="button"
                key={heart}
                className={heart <= shown ? "is-on" : ""}
                aria-label={`${heart} heart${heart > 1 ? "s" : ""}`}
                aria-pressed={rating === heart}
                onMouseEnter={() => setHovered(heart)}
                onFocus={() => setHovered(heart)}
                onBlur={() => setHovered(0)}
                onClick={() => setRating(heart)}
              >
                <Heart />
              </button>
            ))}
          </div>
          <p className="heart-rating-word" aria-live="polite">
            {shown ? RATING_WORDS[shown] : "Tap a heart"}
          </p>
        </fieldset>

        <label className="own-words">
          <span>Anything you’d like to tell us? (optional)</span>
          <textarea
            rows={5}
            maxLength={2000}
            placeholder="What do you love? What should we change?"
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>

        <button type="submit" disabled={status.kind === "loading"}>
          Send feedback
        </button>
        {status.kind !== "idle" && (
          <p className={`form-status is-${status.kind}`} role="status">
            {status.message}
          </p>
        )}
      </form>
    </>
  )
}
