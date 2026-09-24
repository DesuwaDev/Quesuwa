// Follow-up links for tickets are remembered in this browser only.
import { storage } from './storage.js';

const STORE = 'quesuwa.tickets';

export const ticketLink = (id, key) => `${window.location.origin}/t/${id}#k=${encodeURIComponent(key)}`;
export const savedTickets = () => (storage.getJSON(STORE) || []).filter(item => item && typeof item.id === 'string' && typeof item.key === 'string');

export function rememberTicket({ id, key, title }) {
  const list = savedTickets().filter(item => item.id !== id);
  const previous = savedTickets().find(item => item.id === id);
  list.unshift({ id, key, title: title || previous?.title || '', createdAt: previous?.createdAt || new Date().toISOString() });
  storage.setJSON(STORE, list.slice(0, 50));
}

export function forgetTicket(id) {
  storage.setJSON(STORE, savedTickets().filter(item => item.id !== id));
}

// The key travels in the URL fragment, so it never reaches server logs or referrers.
export function keyFromLocation() {
  const match = /(?:^|[#&])k=([^&]+)/.exec(window.location.hash);
  if (!match) return '';
  try { return decodeURIComponent(match[1]); } catch { return ''; }
}

// Accepts a full follow-up link or just the key.
export function parseTicketInput(value, id) {
  const text = value.trim();
  const link = /\/t\/([0-9a-f-]{36})#k=([^&\s]+)/i.exec(text);
  if (link) return { id: link[1], key: decodeURIComponent(link[2]) };
  return text ? { id, key: text } : null;
}
