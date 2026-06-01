exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY not configured' }) }

  let answers
  try { answers = JSON.parse(event.body || '{}') } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) }
  }

  const origin = answers.hq_country || 'Deutschland'
  const target = answers.target_market || 'Lateinamerika'

  const prompt = `You are an expert cross-border market entry advisor specializing in industrial and commercial cooperation between ${origin} and ${target}.

A company based in ${origin} is assessing its readiness to enter or operate in ${target}. Based on their diagnostic survey answers below, provide a structured analysis in JSON format.

Be SPECIFIC to the ${origin} → ${target} corridor:
- Reference real regulatory, cultural and operational challenges specific to this country pair
- Take into account the company size, industry, international experience and current phase from the answers
- Base your dimension scores directly on the 1-5 Likert scale answers provided (higher average = higher score)
- Give concrete, actionable recommendations relevant to this exact market corridor
- Write everything in German

Return ONLY valid JSON with this exact structure — no markdown, no explanation, only JSON:
{
  "origin": "${origin}",
  "target": "${target}",
  "overall_score": <integer 0-100>,
  "readiness_level": "<one of: Nicht bereit | Teilweise bereit | Bereit | Sehr bereit>",
  "dimensions": [
    {
      "name": "Marktreife",
      "score": <integer 0-100>,
      "risk_level": "<one of: hoch | mittel | niedrig>",
      "gaps": ["<specific gap 1>", "<specific gap 2>"],
      "solutions": ["<specific action 1>", "<specific action 2>"]
    },
    {
      "name": "Organisatorische Passung",
      "score": <integer 0-100>,
      "risk_level": "<one of: hoch | mittel | niedrig>",
      "gaps": ["<specific gap 1>", "<specific gap 2>"],
      "solutions": ["<specific action 1>", "<specific action 2>"]
    },
    {
      "name": "Entscheidungsstrukturen",
      "score": <integer 0-100>,
      "risk_level": "<one of: hoch | mittel | niedrig>",
      "gaps": ["<specific gap 1>", "<specific gap 2>"],
      "solutions": ["<specific action 1>", "<specific action 2>"]
    },
    {
      "name": "Regulierung & Compliance",
      "score": <integer 0-100>,
      "risk_level": "<one of: hoch | mittel | niedrig>",
      "gaps": ["<specific gap 1>", "<specific gap 2>"],
      "solutions": ["<specific action 1>", "<specific action 2>"]
    },
    {
      "name": "Kultur & Kommunikation",
      "score": <integer 0-100>,
      "risk_level": "<one of: hoch | mittel | niedrig>",
      "gaps": ["<specific gap 1>", "<specific gap 2>"],
      "solutions": ["<specific action 1>", "<specific action 2>"]
    }
  ],
  "priority_actions": ["<action 1>", "<action 2>", "<action 3>"],
  "market_entry_recommendation": "<detailed paragraph in German specific to ${origin} → ${target}>"
}

Company survey answers:
${JSON.stringify(answers, null, 2)}`

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 4096 }
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    )
    const data = await r.json()
    if (!r.ok) return { statusCode: r.status, body: JSON.stringify({ error: data.error?.message || 'Gemini API error' }) }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(data) }
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) }
  }
}
