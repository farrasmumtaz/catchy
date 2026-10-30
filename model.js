export function sipAddress(value, domain) {
  const target = value.trim().replace(/^sip:/, '');
  if (!/^[a-zA-Z0-9_.+%-]+(?:@[a-zA-Z0-9.-]+(?::\d+)?)?$/.test(target)) throw new Error('Username atau alamat SIP tidak valid.');
  if (!target.includes('@') && !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(domain)) throw new Error('Isi domain SIP terlebih dahulu.');
  return `sip:${target.includes('@') ? target : `${target}@${domain}`}`;
}

export function readHistory(raw) {
  try {
    const data = JSON.parse(raw || '{}');
    if (!data || Array.isArray(data) || typeof data !== 'object') return {};
    return Object.fromEntries(Object.entries(data).filter(([, messages]) =>
      Array.isArray(messages)).map(([key, messages]) => [key, messages.filter(msg =>
      msg && typeof msg.text === 'string' && typeof msg.mine === 'boolean' &&
      Number.isFinite(msg.time) && (msg.state === undefined || typeof msg.state === 'string'))]));
  } catch { return {}; }
}

export function parseIceServers(value) {
  const servers = JSON.parse(value || '[]');
  if (!Array.isArray(servers) || servers.some(server => {
    if (!server || typeof server !== 'object') return true;
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return !urls.length || urls.some(url => typeof url !== 'string' ||
      !/^(stun|stuns|turn|turns):[^\s]+$/.test(url)) ||
      (server.username !== undefined && typeof server.username !== 'string') ||
      (server.credential !== undefined && typeof server.credential !== 'string');
  })) throw new Error('ICE servers harus berupa array dengan URL stun:, stuns:, turn:, atau turns:.');
  return servers;
}

export function mergeMessages(current, incoming) {
  return [...new Map([...current, ...incoming].map(message => [message.id, message])).values()]
    .sort((a, b) => a.id - b.id);
}
