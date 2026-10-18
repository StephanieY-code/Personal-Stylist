import { useState } from "react"

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * The welcome artwork. The logo, heart and peacock are separate images laid over
 * hero-base.png at the exact spots they occupy in the original c0fd1.png, so each can move.
 */
export default function HeroArt() {
  const [logo, setLogo] = useState<"resting" | "falling" | "returning">("resting")
  const [standing, setStanding] = useState(false)

  const goToCloset = () =>
    document.getElementById("closet")?.scrollIntoView({ behavior: "smooth" })

  const dropLogo = () => {
    if (logo !== "resting") return
    if (reducedMotion()) {
      goToCloset()
      return
    }
    setLogo("falling")
  }

  const logoLanded = () => {
    if (logo === "falling") {
      goToCloset()
      // Float the logo back into place once the page has moved on.
      window.setTimeout(() => setLogo("returning"), 900)
    } else if (logo === "returning") {
      setLogo("resting")
    }
  }

  return (
    <div className="hero-stage">
      <img src="/assets/hero-base.png" alt="" className="slide-art" />

      <button
        type="button"
        className={`hero-logo is-${logo}`}
        onClick={dropLogo}
        onAnimationEnd={logoLanded}
        aria-label="Peak Style – go to my closet"
      >
        <img src="/assets/logo-emblem.png" alt="" />
      </button>

      <a className="hero-heart" href="?view=feedback" aria-label="Rate Peak Style and leave feedback">
        <img src="/assets/heart.png" alt="" />
      </a>

      <button
        type="button"
        className={`hero-peacock ${standing ? "is-standing" : ""}`}
        onClick={() => setStanding((current) => !current)}
        aria-label={standing ? "Let the peacock sit down" : "Make the peacock stand up"}
        aria-pressed={standing}
      >
        <img src="/assets/peacock.png" alt="" />
      </button>
    </div>
  )
}
