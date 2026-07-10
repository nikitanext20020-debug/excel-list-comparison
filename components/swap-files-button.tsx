"use client"

/* Кнопка «Поменять местами» — две встречные стрелки с плавной анимацией
   (анимация move-right/move-left и стили .swap-* заданы в globals.css) */
export function SwapFilesButton({
  onClick,
  disabled,
  className = "",
}: {
  onClick: () => void
  disabled?: boolean
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title="Поменять файлы местами"
      className={`swap-btn btn-lift group inline-flex items-center gap-2 rounded-full border border-primary/40 bg-card px-3 py-1.5 text-xs font-medium text-primary transition-all hover:border-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      <svg
        viewBox="0 0 160 160"
        width="18"
        height="18"
        aria-hidden="true"
        className="shrink-0"
        fill="none"
        stroke="currentColor"
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <g className="swap-arrow-top">
          <path d="M24 52H126" />
          <path d="M105 30l22 22-22 22" />
        </g>
        <g className="swap-arrow-bottom">
          <path d="M136 108H34" />
          <path d="M55 86l-22 22 22 22" />
        </g>
      </svg>
      Поменять местами
      <span className="sr-only">: файл 1 станет файлом 2, и наоборот</span>
    </button>
  )
}
