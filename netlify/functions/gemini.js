// netlify/functions/gemini.js
// Secure proxy — keeps the Gemini API key server-side via Netlify env variable

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY is not set in Netlify environment variables.' }) }
  }

  let base64, mimeType
  try {
    const body = JSON.parse(event.body)
    base64   = body.base64
    mimeType = body.mimeType || 'application/pdf'
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }
  }

  const prompt = `You are a customs tariff classification expert. 
The attached file is a product list (PDF). Extract ALL products from it and classify each one with the correct HS (Harmonized System) tariff code.

Respond ONLY with a valid JSON object — no markdown, no explanation, no extra text. Use this exact format:
{
  "products": [
    {
      "name": "Product name",
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

Use standard 8-digit HS codes where possible. If a product cannot be confidently classified, set confidence to "low".`

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
