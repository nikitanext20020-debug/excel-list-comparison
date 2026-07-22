import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { generateObject } from "ai"
import { z } from "zod"

export const maxDuration = 60

const sourceRowSchema = z.object({
  excelRow: z.number().int().positive(),
  columns: z.array(
    z.object({
      header: z.string(),
      value: z.string(),
    }),
  ),
})

const pairSchema = z.object({
  index: z.number().int().nonnegative(),
  left: sourceRowSchema,
  right: sourceRowSchema,
  matchReason: z.string(),
})

const requestSchema = z.object({
  pairs: z.array(pairSchema).min(1).max(20),
})

const resultSchema = z.object({
  index: z.number().int().nonnegative(),
  verdict: z.enum(["same", "different", "unsure"]),
  confidence: z.number().int().min(0).max(100),
  reason: z.string().min(1).max(600),
})

const responseSchema = z.object({
  results: z.array(resultSchema),
})

const SYSTEM_PROMPT = `Ты помощник по дедупликации списков людей. Даны две записи с одинаковым или похожим ФИО, но разными датами рождения. Определи, один это человек или разные. Признаки одного человека: совпадающий телефон (учти, что 8 и +7 в начале — одно и то же), совпадающий адрес/организация/другие поля, дата рождения различается похоже на опечатку (перестановка день/месяц, одна цифра, соседние клавиши). Признаки разных людей: полностью разные телефоны, адреса, организации, сильно разные даты. Если данных мало — отвечай unsure. Отвечай только по данным, ничего не выдумывай.

Для каждой пары верни объект с её исходным index, verdict (same, different или unsure), confidence от 0 до 100 и reason из 1–2 предложений по-русски. Не добавляй пары, которых нет во входе.`

export async function GET() {
  return Response.json({ enabled: Boolean(process.env.ROUTERAI_API_KEY) })
}

export async function POST(req: Request) {
  const apiKey = process.env.ROUTERAI_API_KEY
  if (!apiKey) {
    return Response.json({ error: "ROUTERAI_API_KEY не настроен." }, { status: 503 })
  }

  let payload: unknown
  try {
    payload = await req.json()
  } catch {
    return Response.json({ error: "Некорректный JSON-запрос." }, { status: 400 })
  }

  const parsed = requestSchema.safeParse(payload)
  if (!parsed.success) {
    return Response.json({ error: "Некорректный список спорных пар." }, { status: 400 })
  }

  try {
    const routerai = createOpenAICompatible({
      name: "routerai",
      apiKey,
      baseURL: "https://routerai.ru/api/v1",
    })

    const { object } = await generateObject({
      model: routerai("deepseek/deepseek-v4-flash"),
      schema: responseSchema,
      system: SYSTEM_PROMPT,
      prompt: JSON.stringify({ pairs: parsed.data.pairs }, null, 2),
      temperature: 0,
      maxOutputTokens: 4096,
    })

    return Response.json(object)
  } catch (error) {
    console.error("[judge-pairs] RouterAI request failed:", error instanceof Error ? error.message : error)
    return Response.json({ error: "Не удалось получить подсказку ИИ для этой партии пар." }, { status: 502 })
  }
}
