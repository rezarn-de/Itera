const BASE_URL = 'https://fhwdlgjrgdoaerjfqflb.supabase.co';
const PUBLIC_KEY = 'sb_publishable_a8XKwDCsVxq9w3an9TbjbQ_8-qRvWPg';

function deny(statusCode, error) {
  return {
    response: {
      statusCode,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ ok: false, error })
    }
  };
}

async function requireAccess(event, allowed = ['demo', 'full']) {
  const authorization =
    event.headers?.authorization ||
    event.headers?.Authorization ||
    '';

  if (!/^Bearer\s+\S+$/i.test(authorization)) {
    return deny(401, 'Bitte melden Sie sich an.');
  }

  const url = (process.env.SUPABASE_URL || BASE_URL).replace(/\/$/, '');

  const headers = {
    apikey: process.env.SUPABASE_PUBLISHABLE_KEY || PUBLIC_KEY,
    Authorization: authorization
  };

  try {
    const authResponse = await fetch(url + '/auth/v1/user', {
      headers,
      signal: AbortSignal.timeout(8000)
    });

    if (!authResponse.ok) {
      return deny(
        [401, 403].includes(authResponse.status) ? 401 : 503,
        'Die Anmeldung konnte nicht bestätigt werden. Bitte erneut anmelden.'
      );
    }

    const user = await authResponse.json();

    if (!user.id || user.is_anonymous) {
      return deny(401, 'Bitte melden Sie sich an.');
    }

    const accessResponse = await fetch(
      url +
        '/rest/v1/account_access?select=access_level&user_id=eq.' +
        encodeURIComponent(user.id),
      {
        headers,
        signal: AbortSignal.timeout(8000)
      }
    );

    if (!accessResponse.ok) {
      return deny(503, 'Der Zugriff konnte nicht geprüft werden.');
    }

    const rows = await accessResponse.json();

    if (
      !Array.isArray(rows) ||
      rows.length !== 1 ||
      !['demo', 'full'].includes(rows[0].access_level)
    ) {
      return deny(403, 'Für dieses Konto ist kein Zugang eingerichtet.');
    }

    const accessLevel = rows[0].access_level;

    if (!allowed.includes(accessLevel)) {
      return deny(403, 'In der Vollversion verfügbar.');
    }

    return { user, accessLevel };
  } catch {
    return deny(503, 'Die Zugriffsprüfung ist derzeit nicht erreichbar.');
  }
}

module.exports = { requireAccess };