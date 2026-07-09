"use client"

import { useRef, useState } from "react"

type Msg = { role: "user" | "assistant"; content: string }

export function AiAssistant({ context }: { context?: string }) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
        setMessages((m) => [...m, { role: "assistant", content: data.answer }])
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
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed ${
                        m.role === "user"
                          ? "self-end bg-primary text-primary-foreground"
                          : "self-start border border-border bg-card text-card-foreground"
                      }`}
                    >
                      {m.content}
                    </div>
                  ))}
                  {busy && <div className="self-start text-xs text-muted-foreground">агент печатает…</div>}
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

        {/* Робот — зацикленное видео (вперёд-назад одним файлом, без рывка на стыке);
            mix-blend-screen убирает чёрный фон видео на любой платформе, включая Safari/Mac */}
        <div className="shrink-0 self-center">
          <video
            src="/videos/robot-loop.webm"
            autoPlay
            loop
            muted
            playsInline
            width={230}
            height={230}
            aria-label="ИИ-робот помощник"
            className="anim-float-slow h-[230px] w-[230px] object-cover mix-blend-screen"
          />
        </div>
      </div>
    </section>
  )
}
