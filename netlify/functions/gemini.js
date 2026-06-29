// netlify/functions/gemini.js

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY is not set in Netlify environment variables.' }) }
  }

  let base64, mimeType, country
  try {
    const body = JSON.parse(event.body || '{}')
    base64 = body.base64
    mimeType = body.mimeType || 'application/pdf'
    country = body.country
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }
  }

  if (!base64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'PDF data is required.' }) }
  }

  if (!country) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Country is required.' }) }
  }

  if (country !== 'MX') {
    return { statusCode: 400, body: JSON.stringify({ error: 'Only Mexico is supported for now.' }) }
  }

  const countryName = 'Mexico'

  const prompt = `You are a customs tariff classification expert.
The attached file is a product list (PDF). Extract ALL products from it and classify each one for the selected country: ${countryName} (${country}).

Important:
- Return the tariff code relevant to ${countryName}.
- Also include the generic HS code when you can determine it.
- Use the best available country-specific tariff classification for Mexico.
- If a product cannot be confidently classified, set confidence to "low".
- Respond ONLY with a valid JSON object — no markdown, no explanation, no extra text.

Use this exact format:
{
  "country": "${country}",
  "countryName": "${countryName}",
  "products": [
    {
      "name": "Product name",
      "tariffCode": "country-specific tariff code",
      "hsCode": "XXXX.XX.XX",
      "category": "Category name",
      "dutyRate": "X%",
      "confidence": "high|medium|low"
    }
  ],
  "summary": {
    "total": N,
    "categories": N,
    "matched": N,
    "needsReview": N
  }
}

If the country-specific tariff code cannot be determined with confidence, still provide the best likely result and set confidence to "low".`

  const requestBody = {
    contents: [
      {
        parts: [
          {
            inline_data: {
              mime_type: mimeType,
              data: base64
            }
          },
          {
            text: prompt
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8192
    }
  }

  try {
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    )

    const geminiData = await geminiRes.json()

    if (!geminiRes.ok) {
      return {
        statusCode: geminiRes.status,
        body: JSON.stringify({ error: geminiData.error?.message || 'Gemini API error' })
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(geminiData)
    }

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || 'Internal server error' })
    }
  }
}
