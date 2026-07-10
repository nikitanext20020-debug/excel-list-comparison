"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type Msg = { role: "user" | "assistant"; content: string }

/* компактный рендер markdown: **жирный**, списки, код — в стиле пузыря */
function Markdown({ children }: { children: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
          p: ({ children }) => <p className="my-1 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-1 list-disc pl-4">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 list-decimal pl-4">{children}</ol>,
          li: ({ children }) => <li className="my-0.5">{children}</li>,
          code: ({ children }) => (
            <code className="rounded bg-background/70 px-1 py-0.5 font-mono text-[12px]">{children}</code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  )
}

/* сообщение агента с анимацией набора: текст проявляется посимвольно, затем рендерится markdown */
function AssistantBubble({ content, animate }: { content: string; animate: boolean }) {
  const [shown, setShown] = useState(animate ? "" : content)

  useEffect(() => {
    if (!animate) {
      setShown(content)
      return
    }
    setShown("")
    let i = 0
    // шаг набора: несколько символов за тик, чтобы длинные ответы не тянулись слишком долго
    const step = Math.max(1, Math.round(content.length / 240))
    const id = setInterval(() => {
      i += step
      setShown(content.slice(0, i))
      if (i >= content.length) clearInterval(id)
    }, 16)
    return () => clearInterval(id)
  }, [content, animate])

  const typing = animate && shown.length < content.length

  return (
    <div className="max-w-[85%] self-start rounded-lg border border-border bg-card px-3 py-2 text-sm leading-relaxed text-card-foreground">
      <Markdown>{shown}</Markdown>
      {typing && <span className="typing-caret" aria-hidden="true" />}
    </div>
  )
}

/* Safari (macOS) и все браузеры на iOS/iPadOS не декодируют альфа-канал
   VP9 в webm — фон видео там становится чёрным квадратом. Для них показываем
   статичную картинку робота с настоящей прозрачностью. */
function isAppleWebKit(): boolean {
  const ua = navigator.userAgent
  const isIOS =
    /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS в десктопном режиме притворяется макбуком, но у него есть тач
    (ua.includes("Macintosh") && navigator.maxTouchPoints > 1)
  const isSafariMac = ua.includes("Safari") && !/Chrome|Chromium|Edg|OPR|Android/.test(ua)
  return isIOS || isSafariMac
}

/* робот: в самом видеофайле уже склеены прямой и обратный проходы
   (пинг-понг), поэтому обычный нативный loop даёт идеально плавный
   бесконечный цикл. На Safari/iOS вместо видео — прозрачный webp. */
function RobotVideo() {
  const videoRef = useRef<HTMLVideoElement>(null)
  // до монтирования показываем статичную картинку (она работает везде),
  // после — включаем видео только там, где поддерживается альфа-канал
  const [useVideo, setUseVideo] = useState(false)

  useEffect(() => {
    if (!isAppleWebKit()) setUseVideo(true)
  }, [])

  useEffect(() => {
    if (!useVideo) return
    // страховка: если браузер заблокировал autoplay — пробуем запустить вручную
    const v = videoRef.current
    if (v?.paused) v.play().catch(() => {})
  }, [useVideo])

  if (!useVideo) {
    return (
      <img
        src="/images/robot-static.webp"
        width={240}
        height={240}
        alt="ИИ-робот помощник"
        className="h-[240px] w-auto object-contain drop-shadow-[0_0_28px_rgba(91,150,255,0.35)]"
      />
    )
  }

  return (
    <video
      ref={videoRef}
      src="/videos/robot-pingpong.webm"
      autoPlay
      loop
      muted
      playsInline
      width={240}
      height={240}
      aria-label="ИИ-робот помощник"
      className="h-[240px] w-[240px] object-contain"
    />
  )
}

export function AiAssistant({ context }: { context?: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [animateIdx, setAnimateIdx] = useState<number>(-1)
  const listRef = useRef<HTMLDivElement>(null)

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setError(null)
    setInput("")
    const next: Msg[] = [...messages, { role: "user", content: text }]
    setMessages(next)
    setBusy(true)
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next, context }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Ошибка запроса.")
      } else {
        setMessages((m) => {
          setAnimateIdx(m.length) // индекс нового ответа агента (добавляется в конец массива m)
          return [...m, { role: "assistant", content: data.answer }]
        })
      }
    } catch {
      setError("Нет соединения с сервером.")
    } finally {
      setBusy(false)
      setTimeout(() => listRef.current?.scrollTo({ top: 99999, behavior: "smooth" }), 50)
    }
  }

  return (
    <section aria-label="ИИ-помощник" className="mx-auto max-w-5xl px-4 pb-14 xl:px-0">
      <div className="glass-card glow-primary-soft flex flex-col gap-6 rounded-2xl border border-primary/25 p-6 md:flex-row md:items-center md:p-8">
        {/* Текст и кнопка */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <h2 className="text-lg font-bold" style={{ color: "var(--chart-1)" }}>
            ИИ-помощник по сверке
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Помощник видит имена из загруженных файлов и результаты сверки: объяснит, почему строка попала в «спорные»,
            сравнит ФИО с учётом опечаток, подскажет настройки — и ответит на любой другой вопрос.
          </p>
          {!open && (
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="btn-lift glow-primary w-fit rounded-lg bg-primary px-6 py-2.5 text-sm font-bold text-primary-foreground hover:opacity-95"
            >
              Вызвать агента
            </button>
          )}

          {open && (
            <div className="flex flex-col gap-3">
              <div
                ref={listRef}
                className="max-h-64 min-h-24 overflow-y-auto rounded-lg border border-border bg-background/50 p-3"
              >
                {messages.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Например: «Иванова Анна Петровна и Иванова Анна Петрова — это один человек?» или «Почему строка
                    попала в спорные?»
                  </p>
                )}
                <div className="flex flex-col gap-2">
                  {messages.map((m, i) =>
                    m.role === "user" ? (
                      <div
                        key={i}
                        className="max-w-[85%] self-end whitespace-pre-wrap rounded-lg bg-primary px-3 py-2 text-sm leading-relaxed text-primary-foreground"
                      >
                        {m.content}
                      </div>
                    ) : (
                      <AssistantBubble key={i} content={m.content} animate={i === animateIdx} />
                    ),
                  )}
                  {busy && (
                    <div className="flex items-center gap-1 self-start px-1 py-1" aria-label="агент печатает">
                      <span className="dot-typing" />
                      <span className="dot-typing" style={{ animationDelay: "0.15s" }} />
                      <span className="dot-typing" style={{ animationDelay: "0.3s" }} />
                    </div>
                  )}
                </div>
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <div className="flex gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) send()
                  }}
                  placeholder="Ваш вопрос агенту…"
                  aria-label="Вопрос агенту"
                  className="min-w-0 flex-1 rounded-lg border border-input bg-background/60 px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button
                  type="button"
                  onClick={send}
                  disabled={busy || !input.trim()}
                  className="btn-lift rounded-lg bg-primary px-4 py-2 text-sm font-bold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Спросить
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Робот — бесконечный пинг-понг: вперёд, затем плавно назад */}
        <div className="robot-stage anim-float-slow shrink-0 self-center">
          <RobotVideo />
        </div>
      </div>
    </section>
  )
}
