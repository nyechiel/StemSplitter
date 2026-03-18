export interface HistoryEntry {
  jobId: string;
  title: string;
  stems: string[];
  date: string;
  analysis?: Record<string, any>;
  sourceUrl?: string;
  labels?: string[];
}

function extractVideoId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0];
    if (u.searchParams.has("v")) return u.searchParams.get("v");
  } catch {}
  return null;
}

export function findBySource(sourceUrl: string): HistoryEntry | undefined {
  const history = getHistory();
  const videoId = extractVideoId(sourceUrl);
  return history.find((h) => {
    if (!h.sourceUrl) return false;
    if (h.sourceUrl === sourceUrl) return true;
    if (videoId) {
      const hId = extractVideoId(h.sourceUrl);
      return hId === videoId;
    }
    return false;
  });
}

const STORAGE_KEY = "stemsplitter_history";

export function getHistory(): HistoryEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export function addToHistory(entry: HistoryEntry) {
  const history = getHistory().filter((h) => h.jobId !== entry.jobId);
  history.unshift(entry);
  // Keep last 50 entries
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 50)));
}

export function updateHistoryEntry(jobId: string, updates: { labels?: string[]; title?: string }) {
  const history = getHistory();
  const entry = history.find((h) => h.jobId === jobId);
  if (entry) {
    if (updates.labels !== undefined) entry.labels = updates.labels;
    if (updates.title !== undefined) entry.title = updates.title;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }
}

export function reorderHistory(fromJobId: string, toJobId: string) {
  const history = getHistory();
  const fromIdx = history.findIndex((h) => h.jobId === fromJobId);
  const toIdx = history.findIndex((h) => h.jobId === toJobId);
  if (fromIdx === -1 || toIdx === -1) return;
  const [item] = history.splice(fromIdx, 1);
  history.splice(toIdx, 0, item);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}

export function removeFromHistory(jobId: string) {
  const history = getHistory().filter((h) => h.jobId !== jobId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
}
