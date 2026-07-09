export const maxDuration = 60

const SYSTEM_PROMPT = `Ты — помощник в приложении «Сверка списков». Приложение сверяет два Excel-файла со списками людей (ФИО, телефон, дата рождения) и помечает строки: найден, найден с опечаткой, спорный, не найден, а также ищет дубли.

Твоя задача — помогать оператору перепроверять результат сверки:
- объяснять, почему строка могла попасть в «спорные» или «не найдены»;
- подсказывать, похожи ли два ФИО с учётом опечаток, ё/е, перестановки слов, смены фамилии;
- советовать, какую строгость сверки выбрать;
- отвечать на вопросы о работе приложения.

Отвечай кратко и по-русски. Если данных не хватает — попроси прислать конкретные строки.`

export async function POST(req: Request) {
  const apiKey = process.env.OPENMODEL_API_KEY
  if (!apiKey) {
    return Response.json(
      { error: "OPENMODEL_API_KEY не настроен. Добавьте ключ в переменные окружения проекта." },
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
      ? `${SYSTEM_PROMPT}\n\nТекущая сводка последней сверки:\n${body.context.slice(0, 4000)}`
      : SYSTEM_PROMPT

  try {
    // OpenModel отдаёт deepseek-v4-flash по Anthropic-протоколу «messages»
    const res = await fetch("https://api.openmodel.ai/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        system,
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content).slice(0, 4000),
        })),
        max_tokens: 2048,
      }),
    })

    if (!res.ok) {
      const text = await res.text()
      console.log("[v0] OpenModel API error:", res.status, text.slice(0, 300))
      return Response.json({ error: `Сервис ИИ ответил ошибкой (${res.status}). Попробуйте позже.` }, { status: 502 })
    }

    const data = await res.json()
    // Модель «думающая»: content содержит блоки thinking и text — берём только text
    const blocks: { type: string; text?: string }[] = Array.isArray(data?.content) ? data.content : []
    const answer = blocks
      .filter((b) => b.type === "text" && b.text)
      .map((b) => b.text)
      .join("\n")
      .trim()
    return Response.json({ answer: answer || "Модель не дала ответа, попробуйте переформулировать вопрос." })
  } catch (e) {
    console.log("[v0] OpenModel fetch failed:", e instanceof Error ? e.message : e)
    return Response.json({ error: "Не удалось связаться с сервисом ИИ." }, { status: 502 })
  }
}
