const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_COUNTRY = process.env.SYNC_COUNTRY || 'MX';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async () => {
  try {
    validateEnv();

    const approvedSources = await getApprovedSources(DEFAULT_COUNTRY);

    if (!approvedSources.length) {
      return jsonResponse(200, {
        ok: true,
        message: `No active approved sources found for ${DEFAULT_COUNTRY}`,
        country: DEFAULT_COUNTRY,
        checked: 0,
        changed: 0,
      });
    }

    const results = [];

    for (const source of approvedSources) {
      const result = await processSource(source);
      results.push(result);
    }

    const changedCount = results.filter(r => r.changed).length;
    const errorCount = results.filter(r => !r.ok).length;

    return jsonResponse(200, {
      ok: true,
      country: DEFAULT_COUNTRY,
      checked: results.length,
      changed: changedCount,
      errors: errorCount,
      results,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error.message || 'Unknown sync error',
    });
  }
};

function validateEnv() {
  if (!SUPABASE_URL) throw new Error('Missing SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY');
}

async function getApprovedSources(countryCode) {
  const { data, error } = await supabase
    .from('approved_sources')
    .select('id, country_code, name, url, parser_type, active')
    .eq('active', true)
    .eq('country_code', countryCode);

  if (error) throw new Error(`Failed to load approved_sources: ${error.message}`);
  return data || [];
}

async function processSource(source) {
  try {
    const response = await fetch(source.url, {
      headers: {
        'User-Agent': 'Iteras Tariff Sync/1.0',
        'Accept': 'text/html,application/pdf,application/xml,text/plain,*/*',
      },
    });

    const contentType = response.headers.get('content-type') || '';
    const fetchedAt = new Date().toISOString();

    if (!response.ok) {
      await logFetchFailure(source.id, fetchedAt, `HTTP ${response.status}`);
      return {
        ok: false,
        source_id: source.id,
        source_name: source.name,
        changed: false,
        status: response.status,
        error: `HTTP ${response.status}`,
      };
    }

    const rawBody = await response.text();
    const normalizedText = normalizeText(rawBody);
    const contentHash = sha256(normalizedText);

    const previous = await getLatestSnapshot(source.id);
    const changed = !previous || previous.content_hash !== contentHash;

    const snapshotId = await insertSnapshot({
      sourceId: source.id,
      fetchedAt,
      contentHash,
      rawText: normalizedText,
      sourceUrl: source.url,
      contentType,
      changed,
    });

    await updateSourceHeartbeat(source.id, {
      last_checked_at: fetchedAt,
      last_status: 'ok',
      last_hash: contentHash,
    });

    if (changed) {
      await createPendingVersion({
        countryCode: source.country_code,
        sourceId: source.id,
        snapshotId,
      });
    }

    return {
      ok: true,
      source_id: source.id,
      source_name: source.name,
      changed,
      snapshot_id: snapshotId,
    };
  } catch (error) {
    await logFetchFailure(source.id, new Date().toISOString(), error.message);

    return {
      ok: false,
      source_id: source.id,
      source_name: source.name,
      changed: false,
      error: error.message,
    };
  }
}

async function getLatestSnapshot(sourceId) {
  const { data, error } = await supabase
    .from('tariff_source_snapshots')
    .select('id, content_hash, fetched_at')
    .eq('source_id', sourceId)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`Failed to load latest snapshot: ${error.message}`);
  return data || null;
}

async function insertSnapshot({ sourceId, fetchedAt, contentHash, rawText, sourceUrl, contentType, changed }) {
  const { data, error } = await supabase
    .from('tariff_source_snapshots')
    .insert({
      source_id: sourceId,
      fetched_at: fetchedAt,
      content_hash: contentHash,
      raw_text: rawText,
      source_url: sourceUrl,
      content_type: contentType,
      changed,
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to insert snapshot: ${error.message}`);
  return data.id;
}

async function createPendingVersion({ countryCode, sourceId, snapshotId }) {
  const versionLabel = `auto-${countryCode}-${new Date().toISOString()}`;

  const { error } = await supabase
    .from('tariff_versions')
    .insert({
      country_code: countryCode,
      source_id: sourceId,
      snapshot_id: snapshotId,
      version_label: versionLabel,
      status: 'pending_review',
    });

  if (error) throw new Error(`Failed to create pending version: ${error.message}`);
}

async function updateSourceHeartbeat(sourceId, fields) {
  const payload = { id: sourceId, ...fields };

  const { error } = await supabase
    .from('approved_sources')
    .upsert(payload, { onConflict: 'id' });

  if (error) throw new Error(`Failed to update approved source heartbeat: ${error.message}`);
}

async function logFetchFailure(sourceId, fetchedAt, message) {
  await supabase
    .from('tariff_source_snapshots')
    .insert({
      source_id: sourceId,
      fetched_at: fetchedAt,
      content_hash: null,
      raw_text: null,
      source_url: null,
      content_type: null,
      changed: false,
      error_message: message,
    });
}

function normalizeText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
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
