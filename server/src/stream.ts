import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import type { FastifyReply, FastifyRequest } from "fastify";
import { msg } from "./i18n.js";
import { HttpError } from "./types.js";
import { invalidate, resolveDirectStream, resolveStreams, type StreamFormat } from "./ytdlp.js";

const PASS_HEADERS = ["content-length", "content-range", "accept-ranges", "last-modified"];

function downloadFilename(name: string, mime: string): string {
  const base = name
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "Musike track";
  const ext = mime === "audio/mpeg" ? "mp3" : mime === "audio/webm" ? "webm" : "m4a";
  return `${base}.${ext}`;
}

function encodedFilename(name: string): string {
  return encodeURIComponent(name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * Proxies a googlevideo stream, forwarding Range so the browser can seek natively.
 * googlevideo URLs are bound to the IP that resolved them, so the bytes must flow through this server.
 */
export async function proxyStream(
  req: FastifyRequest,
  reply: FastifyReply,
  id: string,
  kind: "audio" | "video",
  downloadName?: string,
) {
  const pick = async (fresh: boolean): Promise<StreamFormat> => {
    if (fresh) invalidate(id);
    const resolved = await resolveStreams(id);
    const fmt = kind === "audio" ? resolved.audio : resolved.video;
    if (!fmt) throw new HttpError(404, msg("noSdVideo"));
    return fmt;
  };

  const controller = new AbortController();
  reply.raw.on("close", () => {
    if (!reply.raw.writableFinished) controller.abort();
  });

  const request = async (fmt: StreamFormat) => {
    const headers: Record<string, string> = { ...fmt.headers };
    const range = req.headers.range;
    if (typeof range === "string") headers.Range = range;
    return fetch(fmt.url, { headers, signal: controller.signal });
  };

  let fmt = await pick(false);
  let upstream = await request(fmt);
  // Expired or rejected URL: resolve again once.
  if (upstream.status === 403 || upstream.status === 410) {
    await upstream.body?.cancel();
    fmt = await pick(true);
    upstream = await request(fmt);
  }
  // yt-dlp can successfully extract a URL that YouTube then refuses. A second yt-dlp extraction usually returns
  // the same kind of URL, so use the independent YouTube API fallback before giving up on audio playback.
  if (kind === "audio" && (upstream.status === 403 || upstream.status === 410)) {
    await upstream.body?.cancel();
    const direct = await resolveDirectStream(id).catch(() => null);
    if (direct) {
      fmt = direct.audio;
      upstream = await request(fmt);
    }
  }
  if (!upstream.ok || !upstream.body) {
    throw new HttpError(502, msg("streamRefused", { status: upstream.status }), "maybe_outdated");
  }

  reply.code(upstream.status);
  reply.header("content-type", fmt.mime);
  reply.header("cache-control", "no-store");
  if (downloadName) {
    const filename = downloadFilename(downloadName, fmt.mime);
    const ext = path.extname(filename).slice(1);
    reply.header("content-disposition", `attachment; filename="Musike.${ext}"; filename*=UTF-8''${encodedFilename(filename)}`);
  }
  for (const h of PASS_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) reply.header(h, v);
  }
  if (!upstream.headers.get("accept-ranges")) reply.header("accept-ranges", "bytes");

  const body = Readable.fromWeb(upstream.body as any);
  body.on("error", () => body.destroy());
  return reply.send(body);
}

/** Serves a local file with byte-range support (used for cached HD video). */
export async function serveFile(req: FastifyRequest, reply: FastifyReply, file: string, mime: string, downloadName?: string) {
  const { size } = await stat(file);
  const range = typeof req.headers.range === "string" ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;

  reply.header("content-type", mime);
  reply.header("accept-ranges", "bytes");
  reply.header("cache-control", "no-store");
  if (downloadName) {
    const filename = downloadFilename(downloadName, mime);
    const ext = path.extname(filename).slice(1);
    reply.header("content-disposition", `attachment; filename="Musike.${ext}"; filename*=UTF-8''${encodedFilename(filename)}`);
  }

  if (!range) {
    reply.header("content-length", size);
    return reply.send(createReadStream(file));
  }

  let start = range[1] ? Number(range[1]) : NaN;
  let end = range[2] ? Number(range[2]) : size - 1;
  if (Number.isNaN(start)) {
    // suffix range: bytes=-N
    start = Math.max(0, size - end);
    end = size - 1;
  }
  end = Math.min(end, size - 1);
  if (start > end || start >= size) {
    reply.code(416).header("content-range", `bytes */${size}`);
    return reply.send();
  }

  reply.code(206);
  reply.header("content-range", `bytes ${start}-${end}/${size}`);
  reply.header("content-length", end - start + 1);
  return reply.send(createReadStream(file, { start, end }));
}
