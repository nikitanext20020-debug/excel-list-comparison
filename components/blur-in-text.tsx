"use client"

/**
 * Аналог Magic UI TextAnimate (animation="blurInUp", by="character"):
 * каждый символ появляется из размытия снизу с каскадной задержкой.
 */
export function BlurInText({
  text,
  className,
  charDelay = 45,
}: {
  text: string
  className?: string
  charDelay?: number
}) {
  return (
    <span className={className} aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <span
          key={i}
          aria-hidden="true"
          className="anim-blur-char"
          style={{ animationDelay: `${0.3 + i * (charDelay / 1000)}s` }}
        >
          {ch === " " ? "\u00A0" : ch}
        </span>
      ))}
    </span>
  )
}
