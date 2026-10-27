import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, Trash2, X } from "lucide-react";
import { DiscoveredSection } from "@/components/discovered-section";
import { readAnnounced, takeFreshMatches, writeAnnounced } from "@/lib/scanner/notices";
import { getMarketScan } from "@/lib/scanner/scan.functions";
import type { DiscoveredToken, OutcomeCell, ScanSnapshot } from "@/lib/scanner/types";
import {
  mergeWatchlist,
  parseMintPaste,
  readWatchlist,
  WATCHLIST_LIMIT,
  writeWatchlist,
  type DuplicateLine,
  type RejectedLine,
  type WatchItem,
} from "@/lib/watchlist";

type AddReport = {
  added: number;
  duplicates: DuplicateLine[];
  rejected: RejectedLine[];
};

function noticeLabel(token: DiscoveredToken): string {
  return token.symbol ?? token.name ?? "A token";
}

function deviceAlertsAllowed(): boolean {
  return typeof Notification !== "undefined" && Notification.permission === "granted";
}

function postDeviceAlert(token: DiscoveredToken) {
  if (!deviceAlertsAllowed()) return;
  const label = noticeLabel(token);
  try {
    new Notification(`${label} passed the checks performed`, {
      body: "It is in the ranked feed. Momentum ranking, not a prediction.",
      tag: token.mint,
    });
  } catch {
    // The browser refused the notice. The on-page notice still shows.
  }
}

const STATUS_LABELS = ["Last scan", "Tokens scanned", "Hidden by gates", "Service errors"] as const;

function formatAdded(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function copyWithSelection(text: string): boolean {
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "0";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.focus();
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  document.body.removeChild(area);
  return ok;
}

function reportMessage(report: AddReport): string {
  const parts = [`Added ${report.added}.`];
  if (report.duplicates.length) {
    parts.push(`${report.duplicates.length} already in the list.`);
  }
  if (report.rejected.length) {
    parts.push(`${report.rejected.length} rejected.`);
  }
  return parts.join(" ");
}

function outcomeText(cell: OutcomeCell): string {
  if (cell.state === "pending") return "Not due";
  if (cell.state === "waiting") return "Not recorded yet";
  if (cell.state === "missing") return "Unavailable";
  const pct = cell.changePct * 100;
  const sign = pct > 0 ? "+" : "";
  return `${sign}${pct.toFixed(2)}%`;
}

function outcomeClass(cell: OutcomeCell): string {
  if (cell.state !== "set") return "text-fg";
  if (cell.changePct > 0) return "text-up";
  if (cell.changePct < 0) return "text-down";
  return "text-fg";
}

function outcomePrice(cell: OutcomeCell): string {
  if (cell.state !== "set") return "";
  const digits = cell.priceUsd < 0.01 ? 8 : 4;
  return `$${cell.priceUsd.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

export function ScannerHome() {
  const pasteId = useId();
  const [ready, setReady] = useState(false);
  const [items, setItems] = useState<WatchItem[]>([]);
  const [draft, setDraft] = useState("");
  const [report, setReport] = useState<AddReport | null>(null);
  const [storageNote, setStorageNote] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [snapshot, setSnapshot] = useState<ScanSnapshot | null>(null);
  const [scanLoaded, setScanLoaded] = useState(false);
  const [scanProblem, setScanProblem] = useState<string | null>(null);
  const [notices, setNotices] = useState<DiscoveredToken[]>([]);
  const [deviceAlert, setDeviceAlert] = useState<"unknown" | "default" | "granted" | "denied">("unknown");
  const announcedRef = useRef<Set<string> | null>(null);
  const mintKey = items.map((item) => item.mint).join(",");

  useEffect(() => {
    setItems(readWatchlist(window.localStorage));
    announcedRef.current = readAnnounced(window.localStorage);
    if (typeof Notification !== "undefined") setDeviceAlert(Notification.permission);
    else setDeviceAlert("denied");
    setReady(true);
  }, []);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useEffect(() => {
    if (!ready) return;
    let cancel = false;
    const mints = mintKey ? mintKey.split(",") : [];
    async function load() {
      try {
        const next = await getMarketScan({ data: { mints } });
        if (cancel) return;
        setSnapshot(next);
        setScanProblem(null);
        setScanLoaded(true);
      } catch {
        if (cancel) return;
        setScanProblem("The scan request failed.");
        setScanLoaded(true);
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), 60_000);
    return () => {
      cancel = true;
      window.clearInterval(timer);
    };
  }, [ready, mintKey]);

  useEffect(() => {
    if (!ready || !scanLoaded || scanProblem || !snapshot || !announcedRef.current) return;
    const fresh = takeFreshMatches(announcedRef.current, snapshot.discovered);
    try {
      writeAnnounced(window.localStorage, announcedRef.current);
    } catch {
      // The notice still shows if this browser cannot store the list.
    }
    if (fresh.length === 0) return;
    setNotices((current) => {
      const known = new Set(current.map((token) => token.mint));
      return [...fresh.filter((token) => !known.has(token.mint)), ...current].slice(0, 5);
    });
    for (const token of fresh) postDeviceAlert(token);
  }, [ready, scanLoaded, scanProblem, snapshot]);

  async function allowDeviceAlerts() {
    if (typeof Notification === "undefined") {
      setDeviceAlert("denied");
      return;
    }
    const result = await Notification.requestPermission();
    setDeviceAlert(result);
  }

  function persist(next: WatchItem[]) {
    setItems(next);
    const result = writeWatchlist(window.localStorage, next);
    setStorageNote(result.ok ? null : result.reason);
  }

  function onAdd() {
    const parsed = parseMintPaste(
      draft,
      items.map((item) => item.mint),
    );
    if (parsed.accepted.length > 0) {
      persist(mergeWatchlist(items, parsed.accepted, new Date().toISOString()));
    }
    setReport({
      added: parsed.accepted.length,
      duplicates: parsed.duplicates,
      rejected: parsed.rejected,
    });
    setDraft(parsed.rejected.map((line) => line.value).join("\n"));
    setConfirmClear(false);
  }

  async function onCopy(mint: string) {
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mint);
        setCopied(mint);
        return;
      }
    } catch {
      // Older browsers and locked webviews reject the async clipboard API.
    }
    if (copyWithSelection(mint)) {
      setCopied(mint);
      return;
    }
    setCopied(null);
    setCopyError(mint);
  }

  function onRemove(mint: string) {
    persist(items.filter((item) => item.mint !== mint));
    if (copied === mint) setCopied(null);
    if (copyError === mint) setCopyError(null);
  }

  function onClear() {
    if (!confirmClear) {
      setConfirmClear(true);
      return;
    }
    persist([]);
    setConfirmClear(false);
    setReport(null);
  }

  const canAdd = draft.trim().length > 0;
  const live = report ? reportMessage(report) : "";
  const discoveredByMint = new Map((snapshot?.discovered ?? []).map((token) => [token.mint, token]));
  const statusValues: Record<(typeof STATUS_LABELS)[number], string> = {
    "Last scan": !scanLoaded
      ? "Scanning"
      : snapshot?.stale
        ? "Stale data"
        : snapshot?.scannedAt
          ? new Date(snapshot.scannedAt).toLocaleString(undefined, {
              hour: "numeric",
              minute: "2-digit",
              month: "short",
              day: "numeric",
            })
          : "Unavailable",
    "Tokens scanned": scanLoaded && snapshot ? String(snapshot.tokensScanned) : "Unavailable",
    "Hidden by gates": scanLoaded && snapshot ? String(snapshot.hiddenByGates) : "Unavailable",
    "Service errors": scanLoaded && snapshot ? String(snapshot.serviceErrors.length) : "Unavailable",
  };

  return (
    <div className="min-h-screen bg-bg text-fg">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-4">
          <h1 className="sr-only">Fomo Verified Scanner</h1>
          <img
            src="/x-banner.jpg"
            alt=""
            className="w-full rounded-card border border-border"
            width={1200}
            height={264}
          />
          <p className="max-w-2xl text-base text-muted">
            One feed. Tokens traded via Fomo (not verified by this site) are collected, then hidden
            unless every check passes. Momentum ranking, not a prediction.
          </p>
        </header>

        <aside className="border-l-2 border-accent bg-surface px-4 py-3" role="note">
          <p className="text-sm font-medium text-fg">
            Passing these checks does not prevent losses. Most memecoins lose value.
          </p>
        </aside>

        <section aria-label="Scan status">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-4">
            {STATUS_LABELS.map((label) => (
              <div key={label} className="bg-surface px-3 py-3">
                <dt className="text-xs text-muted">{label}</dt>
                <dd className="mt-1 font-mono text-sm text-fg tabular-nums">{statusValues[label]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-sm text-faint">
            {snapshot
              ? `The server reuses a result for ${snapshot.intervalMinutes} minutes. This page reloads it every 60 seconds. A pool under $10,000, an active mint or freeze authority, a holder above 3%, a top 10 above 25%, a sell quote under 80%, a RugCheck warning, or a missing buyer, volume, or 1-hour price figure hides the token.`
              : "The first server scan is running. A failed check hides a token. It is never shown."}
          </p>
          {snapshot && snapshot.serviceErrors.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-muted">
              {snapshot.serviceErrors.map((error) => (
                <li key={`${error.source}-${error.message}`}>
                  {error.source}: {error.message}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        <DiscoveredSection snapshot={snapshot} loaded={scanLoaded} problem={scanProblem} />
        <p className="text-sm text-muted">
          A notice stays on this page when a token newly passes the checks. It is not repeated while that token remains in the feed.
        </p>
        {deviceAlert === "default" ? (
          <button
            type="button"
            onClick={() => void allowDeviceAlerts()}
            className="inline-flex min-h-11 items-center justify-center self-start rounded-card border border-border bg-surface px-4 text-sm font-medium text-fg"
          >
            Also alert this device
          </button>
        ) : null}

        <section aria-labelledby="list-heading" className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h2 id="list-heading" className="text-lg font-semibold">
              Optional list
            </h2>
            <p className="text-sm text-muted">
              Paste one mint per line. This browser stores the list on this device only. Each line is
              checked for Solana address format, then de-duplicated. Saved mints are sent to the server
              for the same checks as the feed. A valid address is not a pass. Without Fomo buyer counts
              from the Helius read, a pasted mint cannot be scored.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <label htmlFor={pasteId} className="text-sm font-medium text-fg">
              Mint addresses
            </label>
            <textarea
              id={pasteId}
              value={draft}
              rows={6}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="One mint address per line"
              onChange={(event) => {
                setDraft(event.target.value);
                setReport(null);
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canAdd) {
                  event.preventDefault();
                  onAdd();
                }
              }}
              className="min-h-36 w-full resize-y rounded-card border border-border bg-bg px-3 py-3 font-mono text-base text-fg placeholder:text-faint"
            />
            <p className="text-xs text-faint">
              Up to {WATCHLIST_LIMIT} addresses. Ctrl+Enter or Cmd+Enter adds them.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onAdd}
              disabled={!canAdd}
              className="inline-flex min-h-11 items-center justify-center rounded-card bg-accent px-4 text-sm font-medium text-accent-fg disabled:opacity-40"
            >
              Add to list
            </button>
            {items.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="inline-flex min-h-11 items-center justify-center rounded-card border border-border bg-surface px-4 text-sm font-medium text-fg"
              >
                {confirmClear ? "Confirm clear" : "Clear list"}
              </button>
            ) : null}
            {confirmClear ? (
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="inline-flex min-h-11 items-center justify-center px-3 text-sm text-muted"
              >
                Cancel
              </button>
            ) : null}
          </div>

          <p className="sr-only" aria-live="polite">
            {live}
          </p>

          {storageNote ? (
            <p className="rounded-card border border-border bg-surface px-3 py-3 text-sm text-fg" role="alert">
              {storageNote}
            </p>
          ) : null}

          {report ? (
            <div className="rounded-card border border-border bg-surface px-3 py-3 text-sm" aria-live="polite">
              <p className="font-medium text-fg">{reportMessage(report)}</p>
              {report.duplicates.length > 0 ? (
                <ul className="mt-2 flex flex-col gap-1 text-muted">
                  {report.duplicates.map((item) => (
                    <li key={`dup-${item.line}-${item.mint}`}>
                      Line {item.line}: already in the list.
                    </li>
                  ))}
                </ul>
              ) : null}
              {report.rejected.length > 0 ? (
                <ul className="mt-2 flex max-h-40 flex-col gap-1 overflow-auto text-muted">
                  {report.rejected.map((item) => (
                    <li key={`bad-${item.line}-${item.value}`}>
                      Line {item.line}: {item.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium text-fg">
              Saved in this browser{" "}
              <span className="font-mono font-normal text-faint tabular-nums">· {ready ? items.length : "—"}</span>
            </h3>
            {!ready ? (
              <p className="text-sm text-muted">Reading the list saved in this browser.</p>
            ) : items.length === 0 ? (
              <p className="rounded-card border border-dashed border-border px-4 py-5 text-sm text-muted">
                No mints saved. The list is empty until you add one.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {items.map((item) => {
                  const ranked = discoveredByMint.get(item.mint);
                  return (
                  <li key={item.mint} className="rounded-card border border-border bg-surface px-3 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="font-mono text-sm break-all text-fg">{item.mint}</p>
                      <p className="shrink-0 text-xs text-faint">
                        {ranked ? "In the ranked feed" : scanLoaded ? "Hidden or waiting" : "Waiting"}
                      </p>
                    </div>
                    <p className="mt-1 text-xs text-muted">Added {formatAdded(item.addedAt)}</p>
                    <p className="mt-1 text-xs text-faint">
                      {ranked
                        ? `Ranked above at ${ranked.momentumScore.toFixed(1)}. Momentum ranking, not a prediction.`
                        : "Hidden. A check failed, a required figure was missing, or a service did not answer. It is not in the ranked feed."}
                    </p>
                    {copyError === item.mint ? (
                      <p className="mt-2 text-xs text-down">
                        Copy failed. Select the address and copy it manually.
                      </p>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void onCopy(item.mint)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-card border border-border bg-bg px-3 text-sm text-fg"
                      >
                        {copied === item.mint ? (
                          <Check className="size-4" aria-hidden="true" />
                        ) : (
                          <Copy className="size-4" aria-hidden="true" />
                        )}
                        {copied === item.mint ? "Copied" : "Copy"}
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemove(item.mint)}
                        className="inline-flex min-h-11 items-center gap-2 rounded-card border border-border bg-bg px-3 text-sm text-fg"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                        Remove
                      </button>
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <footer className="flex flex-col gap-3 border-t border-border pt-5 text-sm text-muted">
          <div>
            <h2 className="text-base font-semibold text-fg">Outcome tracker</h2>
            <p className="mt-1">
              When a token first reaches the ranked feed, its price is stored. Later scans fill the
              1-hour, 6-hour, and 24-hour prices, each only inside its own window. A missed window
              stays empty. These figures are historical, not a prediction. Tokens that never passed
              the checks are absent, which is survivorship bias.
            </p>
          </div>
          {!scanLoaded ? (
            <p>Reading the record.</p>
          ) : (snapshot?.outcomes?.length ?? 0) === 0 ? (
            <p className="rounded-card border border-dashed border-border px-4 py-5">
              Not recording yet. No ranked token has an entry price. Nothing is stored.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {snapshot?.outcomes?.map((row) => (
                <li key={row.mint} className="rounded-card border border-border bg-surface px-3 py-3">
                  <p className="font-medium text-fg">
                    {row.symbol ?? "Unavailable"}
                    <span className="ml-2 font-normal text-muted">· {row.name ?? "Unavailable"}</span>
                  </p>
                  <p className="mt-1 font-mono text-xs break-all text-fg">{row.mint}</p>
                  <p className="mt-1 text-xs text-faint">
                    Entry{" "}
                    {row.entryPriceUsd.toLocaleString(undefined, {
                      style: "currency",
                      currency: "USD",
                      maximumFractionDigits: row.entryPriceUsd < 0.01 ? 8 : 4,
                    })}{" "}
                    · {formatAdded(row.seenAt)}
                  </p>
                  <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    {(
                      [
                        ["1 hour", row.h1],
                        ["6 hours", row.h6],
                        ["24 hours", row.h24],
                      ] as const
                    ).map(([label, cell]) => (
                      <div key={label}>
                        <dt className="text-muted">{label}</dt>
                        <dd className={`font-mono tabular-nums ${outcomeClass(cell)}`}>{outcomeText(cell)}</dd>
                        {cell.state === "set" ? (
                          <dd className="font-mono text-faint tabular-nums">{outcomePrice(cell)}</dd>
                        ) : null}
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
          <p className="text-faint">
            Mint, freeze, holder, sell-quote, RugCheck, and momentum checks are connected. Outcome
            prices are stored in a file on this server, not in a database. A host that wipes its disk
            between requests will not keep the later prices. There is no wallet, no swap, and no account.
          </p>
        </footer>
      </main>
      {notices.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-3" role="status" aria-live="assertive">
          <ul className="mx-auto flex w-full max-w-3xl flex-col gap-2">
            {notices.map((token) => (
              <li key={token.mint} className="rounded-card border border-border bg-surface px-3 py-3 shadow-lg">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-medium text-fg">
                    {noticeLabel(token)} passed the checks performed
                  </p>
                  <button
                    type="button"
                    onClick={() => setNotices((current) => current.filter((item) => item.mint !== token.mint))}
                    className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-card text-muted"
                    aria-label={`Dismiss notice for ${noticeLabel(token)}`}
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
                <p className="font-mono text-xs break-all text-muted">{token.mint}</p>
                <p className="mt-1 text-xs text-faint">
                  Score {token.momentumScore.toFixed(1)}. Momentum ranking, not a prediction.
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
