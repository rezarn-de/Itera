async function quotaRpc(name, args) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!key) {
    throw new Error('Die Demo-Begrenzung ist noch nicht eingerichtet.');
  }

  const url = (
    process.env.SUPABASE_URL ||
    'https://fhwdlgjrgdoaerjfqflb.supabase.co'
  ).replace(/\/$/, '');

  const response = await fetch(url + '/rest/v1/rpc/' + name, {
    method: 'POST',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(10000)
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      'Der Demo-Status konnte nicht gespeichert werden. Bitte erneut versuchen.'
    );
  }

  return data;
}

module.exports = { quotaRpc };