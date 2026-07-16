export const maxDuration = 60

const SYSTEM_PROMPT = `Ты — ИИ-помощник на сайте «Сверка списков». Твой создатель — Никита. Твоя модель — УАЗ 2026. Если спрашивают, кто тебя создал или что ты за модель, — всегда отвечай именно так.

Сайт сверяет два Excel-файла со списками людей (ФИО, телефон, дата рождения) и помечает строки: найден точно, найден с опечаткой, смена фамилии, найден по телефону, спорный, не найден. Ещё есть режим поиска дублей.

Тебе в контекст передаются имена из загруженных файлов и результаты сверки — используй их свободно: ищи людей по спискам, сравнивай ФИО, объясняй спорные случаи, находи опечатки, советуй настройки.

Ты свободный помощник: отвечай на любые вопросы и выполняй любые просьбы пользователя — по сверке, спискам или на совершенно посторонние темы. Отвечай по-русски (если не попросили иначе), по делу и без лишних отказов.`

export async function POST(req: Request) {
  const apiKey = process.env.ROUTERAI_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: "ROUTERAI_API_KEY не настроен. Добавьте ключ в переменные окружения проекта." },
      { status: 500 },
    )
  }

  let body: { messages?: { role: string; content: string }[]; context?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: "Некорректный запрос." }, { status: 400 })
  }

  const messages = Array.isArray(body.messages) ? body.messages.slice(-20) : []
  if (messages.length === 0) {
    return Response.json({ error: "Пустое сообщение." }, { status: 400 })
  }

  const system =
    typeof body.context === "string" && body.context.trim()
      ? `${SYSTEM_PROMPT}\n\nДанные с сайта (загруженные файлы и результаты):\n${body.context.slice(0, 60000)}`
      : SYSTEM_PROMPT

  try {
    const res = await fetch("https://routerai.ru/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek/deepseek-v4-flash",
        messages: [
          { role: "system", content: system },
          ...messages.map((m) => ({
            role: m.role === "assistant" ? "assistant" : "user",
            content: String(m.content).slice(0, 4000),
          })),
        ],
        max_tokens: 2048,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.log("[v0] RouterAI API error:", res.status, text.slice(0, 300))
      return Response.json({ error: `Сервис ИИ ответил ошибкой (${res.status}). Попробуйте позже.` }, { status: 502 })
    }

    const data = await res.json()
    const content = data?.choices?.[0]?.message?.content
    const answer =
      typeof content === "string"
        ? content.trim()
        : Array.isArray(content)
          ? content
              .map((part: unknown) => {
                if (typeof part === "string") return part
                if (part && typeof part === "object" && "text" in part) {
                  return String((part as { text?: unknown }).text ?? "")
                }
                return ""
              })
              .join("\n")
              .trim()
          : ""
    return Response.json({ answer: answer || "Модель не дала ответа, попробуйте переформулировать вопрос." })
  } catch (e) {
    console.log("[v0] RouterAI fetch failed:", e instanceof Error ? e.message : e)
    return Response.json({ error: "Не удалось связаться с сервисом ИИ." }, { status: 502 })
  }
}
