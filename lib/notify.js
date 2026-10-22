// Messages to a camp's channels (Telegram, Bale, Eitaa bots or any webhook, e.g. an SMS gateway).
// Fire-and-forget: a slow or failing channel never delays or breaks the request that triggered it.
const API = {
    telegram: process.env.NOTIFY_TELEGRAM_API || 'https://api.telegram.org',
    bale: process.env.NOTIFY_BALE_API || 'https://tapi.bale.ai',
    eitaa: process.env.NOTIFY_EITAA_API || 'https://eitaayar.ir/api'
};
const TIMEOUT_MS = 5000;

async function post(url, body, form = false) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, form
            ? { method: 'POST', body: new URLSearchParams(body), signal: ctrl.signal }
            : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
    } finally {
        clearTimeout(t);
    }
}

export function sendToChannel(ch, payload) {
    const text = payload.text;
    if (ch.type === 'webhook') return post(ch.url, payload);
    if (ch.type === 'eitaa') return post(`${API.eitaa}/${ch.token}/sendMessage`, { chat_id: ch.chatId, text }, true);
    return post(`${API[ch.type]}/bot${ch.token}/sendMessage`, { chat_id: ch.chatId, text });
}

export function notifyChannels(camp, event, text) {
    const n = camp.notify || {};
    if (!Array.isArray(n.channels) || !n.channels.length) return;
    if (n.events && n.events[event] === false) return;
    const payload = { event, campId: camp.id, title: camp.title || '', text: `🏆 ${camp.title || ''}\n${text}` };
    for (const ch of n.channels) {
        sendToChannel(ch, payload).catch(e => console.warn(`[notify] ${ch.type} failed for camp ${camp.id}: ${e.message}`));
    }
}

// Standings as a short message (top N).
export function standingsText(camp, n = 5) {
    const teams = [...camp.teams].sort((a, b) => b.score - a.score).slice(0, n);
    const medals = ['🥇', '🥈', '🥉'];
    return teams.map((t, i) => `${medals[i] || (i + 1) + '.'} ${t.name}: ${t.score}`).join('\n');
}
