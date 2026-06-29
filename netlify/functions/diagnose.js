exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true })
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({ ok: false, error: 'Method not allowed' })
    };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ ok: false, error: 'GEMINI_API_KEY not configured' })
    };
  }

  let answers;
  try {
    answers = JSON.parse(event.body || '{}');
  } catch {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({ ok: false, error: 'Invalid JSON body' })
    };
  }

  const pick = (...values) => values.find(v => typeof v === 'string' && v.trim()) || '';
  const origin = pick(answers.hqcountry, answers.hq_country, answers.origin) || 'Deutschland';
  const target = pick(answers.targetmarket, answers.target_market, answers.target) || 'Lateinamerika';

  const prompt = `
Du bist ein Experte für grenzüberschreitenden Markteintritt und internationale Zusammenarbeit zwischen ${origin} und ${target}.

Analysiere die folgenden Fragebogenantworten und gib AUSSCHLIESSLICH gültiges JSON zurück.
Keine Markdown-Blöcke, keine Einleitung, keine Erklärungen, kein Text außerhalb des JSON.

Nutze GENAU diese Struktur und GENAU diese Schlüssel:
{
  "origin": "${origin}",
  "target": "${target}",
  "overallscore": 0,
  "readinesslevel": "",
  "dimensions": [
    {
      "name": "Marktreife",
      "score": 0,
      "risklevel": "",
      "gaps": ["", ""],
      "solutions": ["", ""]
    },
    {
      "name": "Organisatorische Passung",
      "score": 0,
      "risklevel": "",
      "gaps": ["", ""],
      "solutions": ["", ""]
    },
    {
      "name": "Entscheidungsstrukturen",
      "score": 0,
      "risklevel": "",
      "gaps": ["", ""],
      "solutions": ["", ""]
    },
    {
      "name": "Regulierung & Compliance",
      "score": 0,
      "risklevel": "",
      "gaps": ["", ""],
      "solutions": ["", ""]
    },
    {
      "name": "Kultur & Kommunikation",
      "score": 0,
      "risklevel": "",
      "gaps": ["", ""],
      "solutions": ["", ""]
    }
  ],
  "priorityactions": ["", "", ""],
  "marketentryrecommendation": ""
}

Regeln:
- Antworte vollständig auf Deutsch.
- overallscore und jeder score müssen ganze Zahlen von 0 bis 100 sein.
- risklevel darf nur "hoch", "mittel" oder "niedrig" sein.
- dimensions muss genau 5 Objekte enthalten.
- gaps und solutions müssen Arrays mit mindestens 2 präzisen Einträgen sein.
- priorityactions muss genau 3 Einträge enthalten.
- Schreibe konkrete, umsetzbare Aussagen bezogen auf ${origin} und ${target}.
- Gib nur JSON zurück.

Fragebogenantworten:
${JSON.stringify(answers, null, 2)}
`.trim();

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 4096
    }
  };

  function extractText(data) {
    return data?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || '')
      .join('\n')
      .trim() || '';
  }

  function extractJsonBlock(text) {
    const cleaned = String(text || '').replace(/```json|```/gi, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    return cleaned.slice(start, end + 1);
  }

  function toScore(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function toRisk(value) {
    const v = String(value || '').toLowerCase();
    if (v.includes('hoch')) return 'hoch';
    if (v.includes('nied')) return 'niedrig';
    return 'mittel';
  }

  function toStringArray(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    const arr = value.map(v => String(v || '').trim()).filter(Boolean);
    return arr.length ? arr : fallback;
  }

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      }
    );

    const data = await r.json().catch(() => ({}));

    if (!r.ok) {
      return {
        statusCode: r.status,
        headers,
        body: JSON.stringify({
          ok: false,
          error: data?.error?.message || 'Gemini API error'
        })
      };
    }

    const text = extractText(data);
    const jsonText = extractJsonBlock(text);

    if (!jsonText) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: 'Die KI hat kein gültiges JSON zurückgegeben. Bitte erneut versuchen.'
        })
      };
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
    } catch {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          ok: false,
          error: 'Die KI-Antwort war unvollständig oder ungültig. Bitte erneut versuchen.'
        })
      };
    }

    const targetNames = [
      'Marktreife',
      'Organisatorische Passung',
      'Entscheidungsstrukturen',
      'Regulierung & Compliance',
      'Kultur & Kommunikation'
    ];

    const normalizedDimensions = targetNames.map((name, index) => {
      const d = Array.isArray(parsed.dimensions) ? (parsed.dimensions[index] || {}) : {};
      return {
        name,
        score: toScore(d.score, 0),
        risklevel: toRisk(d.risklevel || d.risk_level),
        gaps: toStringArray(d.gaps, [
          'Weitere Analyse erforderlich',
          'Antworten müssen vertieft werden'
        ]).slice(0, 4),
        solutions: toStringArray(d.solutions, [
          'Priorisierte Maßnahmen definieren',
          'Verantwortlichkeiten festlegen'
        ]).slice(0, 4)
      };
    });

    const result = {
      origin: String(parsed.origin || origin),
      target: String(parsed.target || target),
      overallscore: toScore(parsed.overallscore ?? parsed.overall_score, 0),
      readinesslevel: String(
        parsed.readinesslevel ||
        parsed.readiness_level ||
        'Weitere Prüfung erforderlich'
      ),
      dimensions: normalizedDimensions,
      priorityactions: toStringArray(
        parsed.priorityactions ?? parsed.priority_actions,
        [
          'Die größten Risiken priorisieren',
          'Interne Verantwortlichkeiten klären',
          'Konkrete nächste Schritte definieren'
        ]
      ).slice(0, 3),
      marketentryrecommendation: String(
        parsed.marketentryrecommendation ??
        parsed.market_entry_recommendation ??
        'Eine vertiefte Bewertung und ein priorisierter Maßnahmenplan werden empfohlen.'
      )
    };

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, result })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: e.message || 'Unexpected server error'
      })
    };
  }
};
