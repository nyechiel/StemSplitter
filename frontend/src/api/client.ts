export async function submitYouTube(url: string, model: string): Promise<{ job_id: string }> {
  const res = await fetch("/api/youtube", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, model }),
  });
  if (!res.ok) throw new Error("YouTube submission failed");
  return res.json();
}

export async function getJob(jobId: string) {
  const res = await fetch(`/api/jobs/${jobId}`);
  return res.json();
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function deleteJob(jobId: string): Promise<void> {
  await fetch(`/api/jobs/${jobId}`, { method: "DELETE" });
}

export function stemUrl(jobId: string, stemName: string): string {
  return `/api/jobs/${jobId}/stems/${stemName}`;
}

export function connectWebSocket(
  jobId: string,
  onMessage: (data: any) => void
): WebSocket {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${jobId}`);
  ws.onmessage = (e) => onMessage(JSON.parse(e.data));
  return ws;
}
