const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_COUNTRY = process.env.SYNC_COUNTRY || 'MX';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  try {
    validateEnv();

    const version = await getLatestPendingVersion(DEFAULT_COUNTRY);

    if (!version) {
      return jsonResponse(200, {
        ok: true,
        message: `No pending_review version found for ${DEFAULT_COUNTRY}`,
      });
    }

    const snapshot = await getSnapshot(version.snapshot_id);
    const source = await getSource(version.source_id);

    if (!snapshot || !snapshot.raw_text) {
      throw new Error('Snapshot missing raw_text');
    }

    const parsedRows = parseSnapshot(snapshot.raw_text, source.parser_type, DEFAULT_COUNTRY, source.id, version.id);

    if (!parsedRows.length) {
      await updateVersion(version.id, {
        status: 'parse_failed',
        parsed_at: new Date().toISOString(),
        parsed_count: 0,
      });

      return jsonResponse(200, {
        ok: false,
        message: 'No tariff rows parsed from snapshot',
        version_id: version.id,
        source_id: source.id,
      });
    }

    await deleteExistingLines(version.id);
    await insertTariffLines(parsedRows);

    await updateVersion(version.id, {
      status: 'parsed_review_needed',
      parsed_at: new Date().toISOString(),
      parsed_count: parsedRows.length,
    });

    return jsonResponse(200, {
      ok: true,
      version_id: version.id,
      source_id: source.id,
      parsed_count: parsedRows.length,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error.message || 'Unknown parse error',
    });
  }
};

function validateEnv() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}

async function getLatestPendingVersion(countryCode) {
  const { data, error } = await supabase
    .from('tariff_versions')
    .select('id, country_code, source_id, snapshot_id, status, created_at')
    .eq('country_code', countryCode)
    .eq('status', 'pending_review')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load pending version: ${error.message}`);
  return data || null;
}

async function getSnapshot(snapshotId) {
  const { data, error } = await supabase
    .from('tariff_source_snapshots')
    .select('id, raw_text, content_type, source_url')
    .eq('id', snapshotId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load snapshot: ${error.message}`);
  return data || null;
}

async function getSource(sourceId) {
  const { data, error } = await supabase
    .from('approved_sources')
    .select('id, name, url, parser_type, country_code')
    .eq('id', sourceId)
    .maybeSingle();

  if (error) throw new Error(`Failed to load source: ${error.message}`);
  return data || null;
}

async function deleteExistingLines(versionId) {
  const { error } = await supabase
    .from('tariff_lines')
    .delete()
    .eq('version_id', versionId);

  if (error) throw new Error(`Failed to delete old tariff lines: ${error.message}`);
}

async function insertTariffLines(rows) {
  const chunkSize = 500;

  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);

    const { error } = await supabase
      .from('tariff_lines')
      .upsert(chunk, { onConflict: 'version_id,tariff_code,raw_line' });

    if (error) throw new Error(`Failed to insert tariff lines: ${error.message}`);
  }
}

async function updateVersion(versionId, fields) {
  const { error } = await supabase
    .from('tariff_versions')
    .update(fields)
    .eq('id', versionId);

  if (error) throw new Error(`Failed to update version: ${error.message}`);
}

function parseSnapshot(rawText, parserType, countryCode, sourceId, versionId) {
  const text = cleanText(rawText);

  switch (parserType) {
    case 'mx_tigie_html':
    case 'mx_tigie_pdf':
    default:
      return extractMexicanTariffLines(text, countryCode, sourceId, versionId);
  }
}

function extractMexicanTariffLines(text, countryCode, sourceId, versionId) {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.length > 5);

  const results = [];
  const seen = new Set();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const codeMatch = line.match(/\b(\d{4}\.\d{2}\.\d{2})\b/);
    if (!codeMatch) continue;

    const tariffCode = codeMatch[1];
    const digitsOnly = tariffCode.replace(/\D/g, '');
    const hsCode = digitsOnly.slice(0, 6);

    let description = line.replace(tariffCode, '').trim();
    let dutyRate = null;

    const percentMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (percentMatch) {
      dutyRate = `${percentMatch[1]}%`;
      description = description.replace(percentMatch[0], '').trim();
    }

    if ((!description || description.length < 8) && lines[i + 1] && !/\b\d{4}\.\d{2}\.\d{2}\b/.test(lines[i + 1])) {
      description = `${description} ${lines[i + 1]}`.trim();
    }

    description = normalizeSpaces(description)
      .replace(/^[\-\–\—:;,.]+/, '')
      .trim();

    const uniqueKey = `${versionId}::${tariffCode}::${line}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);

    results.push({
      version_id: versionId,
      source_id: sourceId,
      country_code: countryCode,
      tariff_code: tariffCode,
      hs_code: hsCode || null,
      description: description || null,
      duty_rate: dutyRate,
      raw_line: line,
    });
  }

  return results;
}

function cleanText(input) {
  return String(input || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/p>|<\/div>|<\/tr>|<\/li>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\r/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeSpaces(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  };
}
