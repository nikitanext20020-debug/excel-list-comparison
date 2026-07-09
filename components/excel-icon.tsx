/**
 * Анимированная иконка Excel-таблицы: лист с зелёной плашкой X,
 * строки данных проявляются по очереди, галочка сверки прорисовывается штрихом.
 * Все анимации отключаются при prefers-reduced-motion.
 */
export function ExcelIcon({ size = 56, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden="true"
      className={`anim-float ${className}`}
    >
      {/* лист документа */}
      <rect x="14" y="6" width="38" height="52" rx="4" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      {/* загнутый уголок */}
      <path d="M44 6 L52 14 L44 14 Z" fill="var(--secondary)" />
      {/* строки данных, мигающие по очереди */}
      <g stroke="var(--primary)" strokeWidth="3" strokeLinecap="round">
        <line className="anim-row" x1="22" y1="26" x2="44" y2="26" />
        <line className="anim-row" x1="22" y1="34" x2="40" y2="34" />
        <line className="anim-row" x1="22" y1="42" x2="44" y2="42" />
      </g>
      {/* зелёная плашка Excel */}
      <rect x="6" y="30" width="22" height="22" rx="4" fill="#1d7a45" />
      <path
        d="M12 36 L22 46 M22 36 L12 46"
        stroke="#ffffff"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {/* галочка сверки, рисующаяся штрихом */}
      <circle cx="48" cy="48" r="10" fill="var(--primary)" opacity="0.15" />
      <path
        className="anim-check"
        d="M43 48 L47 52 L54 44"
        stroke="var(--primary)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  )
}
