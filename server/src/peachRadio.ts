import { config } from "./config.js";
import type { Track } from "./types.js";

export type PeachAction =
  | "play"
  | "enqueue"
  | "enqueue-next"
  | "pause"
  | "resume"
  | "skip"
  | "stop"
  | "state"
  | "volume"
  | "remove"
  | "clear"
  | "jump";

function unavailable(message: string, statusCode = 503) {
  return Object.assign(new Error(message), { statusCode });
}

export async function peachCommand(action: PeachAction, track?: Track, percent?: number, index?: number) {
  if (!config.peachRadioUrl || !config.peachRadioToken) {
    throw unavailable("Peach Radio is not configured on this server.");
  }

  const body: Record<string, unknown> = { action };
  if (track) {
    Object.assign(body, {
      id: track.id,
      title: track.title,
      artist: track.artist,
      duration: track.duration,
      thumb: track.thumb,
      url: `https://www.youtube.com/watch?v=${track.id}`,
    });
  }
  if (percent !== undefined) body.percent = percent;
  if (index !== undefined) body.index = index;

  let response: Response;
  try {
    response = await fetch(`${config.peachRadioUrl}/radio/music`, {
      method: "POST",
      headers: { authorization: `Bearer ${config.peachRadioToken}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    throw unavailable(`Could not reach Peach Radio: ${(error as Error).message}`);
  }

  const result = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw unavailable(result.error || `Peach Radio returned ${response.status}.`, response.status);
  return result;
}
