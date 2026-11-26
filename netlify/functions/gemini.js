// netlify/functions/gemini.js
const { requireAccess } = require('./lib/access');
const { quotaRpc } = require('./lib/quota');
const { randomUUID } = require('node:crypto');

const supportedCountries = new Map([
  ['MX', 'Mexico'],
  ['AR', 'Argentina'],
  ['BO', 'Bolivia'],
  ['BR', 'Brazil'],
  ['CL', 'Chile'],
  ['CO', 'Colombia'],
  ['EC', 'Ecuador'],
  ['PY', 'Paraguay'],
  ['PE', 'Peru'],
  ['UY', 'Uruguay'],
  ['VE', 'Venezuela']
])

exports.handler = async (event) => {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const access = await requireAccess(event, ['demo', 'full']);
  if (access.response) return access.response;
  
  const apiKey = process.env.GEMINI_API_KEY || process.env.GEMINIAPIKEY
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'GEMINI_API_KEY is not set in Netlify environment variables.' }) }
  }

  let base64, mimeType, country, fileName
  try {
    const body = JSON.parse(event.body || '{}')
    base64 = body.base64
    mimeType = body.mimeType || 'application/pdf'
    country = body.country
    fileName = String(body.fileName || 'Produktliste.pdf').slice(0, 240)
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) }
  }

  if (!base64) {
    return { statusCode: 400, body: JSON.stringify({ error: 'PDF data is required.' }) }
  }

  if (!country) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Country is required.' }) }
  }

  if (typeof country !== 'string' || !supportedCountries.has(country)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Dieses Zielland wird derzeit nicht unterstützt.' }) }
  }

  const countryName = supportedCountries.get(country)

  const prompt = `You are a customs tariff classification expert.
The attached file is a product list (PDF). Extract ALL products from it and classify each one for the selected country: ${countryName} (${country}).

Important:
- Return the tariff code relevant to ${countryName}.
- Also include the generic HS code when you can determine it.
- Use the country-specific tariff classification for ${countryName} (${country}); do not apply another country's tariff codes or duty rates.
- Write product names and categories in German.
- If the document lacks enough detail to determine a code or duty rate, use "Nicht bestimmt" for that field and set confidence to "low". Do not invent missing information.
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
      "hsCode": "XXXX.XX",
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

Use confidence "high", "medium", or "low" according to the available product details. Include all low-confidence products in summary.needsReview.`

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

    const reply = (statusCode, body) => ({
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  });

  let reservationId = null;

  try {
    if (access.accessLevel === 'demo') {
      reservationId = randomUUID();

      const hold = await quotaRpc('reserve_demo_tariff', {
        p_user_id: access.user.id,
        p_reservation_id: reservationId
      });

      if (hold.status === 'used') {
        return reply(409, {
          code: 'DEMO_LIMIT_REACHED',
          error:
            'Ihre Demo-Zollanalyse wurde bereits verwendet. ' +
            'Ihre gespeicherten Ergebnisse bleiben verfügbar.'
        });
      }

      if (hold.status === 'busy') {
        return reply(409, {
          code: 'DEMO_ANALYSIS_RUNNING',
          error:
            'Für Ihr Konto läuft bereits eine Zollanalyse. ' +
            'Bitte warten Sie auf das Ergebnis.'
        });
      }

      if (hold.status !== 'reserved') {
        throw new Error('Der Demozugang konnte nicht geprüft werden.');
      }
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(45000)
      }
    );

    const geminiData = await geminiRes.json();

    if (!geminiRes.ok) {
      const error = new Error(
        geminiData.error?.message || 'Die KI-Anfrage ist fehlgeschlagen.'
      );
      error.statusCode = geminiRes.status;
      throw error;
    }

    const candidate = geminiData.candidates?.[0];

    if (candidate?.finishReason !== 'STOP') {
      throw new Error(
        'Die Analyse war unvollständig. Bitte erneut versuchen.'
      );
    }

    const rawText = (candidate.content?.parts || [])
      .filter(part => !part.thought)
      .map(part => part.text || '')
      .join('\n')
      .replace(/```json|```/gi, '')
      .trim();

    let result;

    try {
      result = JSON.parse(rawText);
    } catch {
      throw new Error(
        'Die KI hat kein gültiges Analyseergebnis zurückgegeben. ' +
        'Bitte erneut versuchen.'
      );
    }

    const fields = [
      'name', 'tariffCode', 'hsCode', 'category', 'dutyRate'
    ];

    if (
      !result ||
      Array.isArray(result) ||
      !Array.isArray(result.products) ||
      !result.products.length ||
      result.products.some(product =>
        !product ||
        Array.isArray(product) ||
        fields.some(field => typeof product[field] !== 'string') ||
        !['high', 'medium', 'low'].includes(product.confidence)
      ) ||
      (result.country && result.country !== country)
    ) {
      throw new Error(
        'Es wurden keine vollständig strukturierten Produkte erkannt. ' +
        'Bitte prüfen Sie die Datei und versuchen Sie es erneut.'
      );
    }

    result.country = country;
    let analysisId = null;

    if (reservationId) {
      const saved = await quotaRpc('complete_demo_tariff', {
        p_user_id: access.user.id,
        p_reservation_id: reservationId,
        p_country: country,
        p_file_name: fileName,
        p_result: result
      });

      analysisId = saved.analysis_id;
    }

    return reply(200, {
      ...geminiData,
      candidates: [{
        ...candidate,
        content: {
          ...candidate.content,
          parts: [{ text: JSON.stringify(result) }]
        }
      }],
      analysisId
    });
  } catch (error) {
    if (reservationId) {
      try {
        await quotaRpc('release_demo_tariff', {
          p_user_id: access.user.id,
          p_reservation_id: reservationId
        });
      } catch {
        // Interrupted reservations expire after ten minutes.
        // Completed allowances cannot be released.
        console.error('Demo reservation cleanup could not be confirmed.');
      }
    }

    return reply(error.statusCode || 503, {
      error: ['AbortError', 'TimeoutError'].includes(error.name)
        ? 'Die Analyse hat zu lange gedauert. Bitte erneut versuchen.'
        : error.message || 'Die Analyse ist derzeit nicht verfügbar.'
    });
  }
};
