import { ArrowsClockwiseIcon, DownloadSimpleIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useT } from "../i18n";
import { downloadTrack } from "../lib/api";
import { cn } from "../lib/format";
import type { Track } from "../lib/types";
import { toast } from "../stores/ui";

export function TrackDownloadButton({
  track,
  size = "sm",
  hoverOnly = false,
  className,
}: {
  track: Track;
  size?: "sm" | "md";
  hoverOnly?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  const t = useT();

  const download = async () => {
    if (busy) return;
    setBusy(true);
    toast(t.toasts.downloadStarted(track.title));
    try {
      await downloadTrack(track);
      toast(t.toasts.downloadReady(track.title));
    } catch {
      toast(t.toasts.downloadFailed(track.title), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={(event) => {
        event.stopPropagation();
        void download();
      }}
      aria-label={busy ? t.trackList.preparingX(track.title) : t.trackList.downloadX(track.title)}
      title={busy ? t.trackList.preparing : t.trackList.download}
      className={cn(
        "relative z-10 grid shrink-0 place-items-center rounded-full text-fg-2 transition-[background-color,color,opacity,transform] hover:bg-surface-3 hover:text-fg active:scale-90 disabled:cursor-wait",
        size === "sm" ? "size-8" : "size-10",
        hoverOnly && !busy && "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
        className,
      )}
    >
      {busy ? <ArrowsClockwiseIcon size={size === "sm" ? 18 : 20} className="animate-spin" /> : <DownloadSimpleIcon size={size === "sm" ? 18 : 20} />}
    </button>
  );
}
