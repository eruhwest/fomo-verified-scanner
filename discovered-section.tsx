import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import type { DiscoveredToken, ScanSnapshot } from "@/lib/scanner/types";

function formatUsd(value: number | null, digits: number): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: digits })}`;
}

function formatPct(fraction: number): string {
  return `${(fraction * 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Unavailable";
  return value.toLocaleString();
}

function formatAge(createdAt: number | null): string {
  if (createdAt === null || !Number.isFinite(createdAt)) return "Unavailable";
  const delta = Date.now() - createdAt;
  if (delta < 0) return "Unavailable";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatSpan(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "Unavailable";
  const minutes = seconds / 60;
  if (minutes < 10) return `${minutes.toFixed(1)}m`;
  return `${Math.round(minutes)}m`;
}

function paceLine(token: DiscoveredToken): string {
  const clock = token.recentSeconds === 900 && token.baselineSeconds === 3600;
  if (clock) {
    return `${windowText(token, "m15", "15m")} · ${windowText(token, "h1", "1h")} · ${windowText(token, "h6", "6h")}`;
  }
  return `${windowText(token, "m15", `Newer ${formatSpan(token.recentSeconds)}`)} · ${windowText(token, "h1", `Sample ${formatSpan(token.baselineSeconds)}`)} · ${windowText(token, "h6", "6h")}`;
}

function windowText(token: DiscoveredToken, key: "m15" | "h1" | "h6", label: string): string {
  const counts = token.fomo[key];
  if (!counts) return `${label} Unavailable`;
  return `${label} ${counts.trades} buys / ${counts.buyers} buyers`;
}

function sourceText(token: DiscoveredToken): string {
  if (token.source === "list") return "From your list. Not in the latest Fomo window.";
  return "Traded via Fomo (not verified by this site).";
}

export function DiscoveredSection({
  snapshot,
  loaded,
  problem,
}: {
  snapshot: ScanSnapshot | null;
  loaded: boolean;
  problem: string | null;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(null), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  async function onCopy(mint: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(mint);
        setCopied(mint);
        return;
      }
    } catch {
      // Fall through to the selection copy.
    }
    const area = document.createElement("textarea");
    area.value = mint;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    setCopied(ok ? mint : null);
  }

  const tokens = snapshot?.discovered ?? [];

  return (
    <section aria-labelledby="feed-heading" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="feed-heading" className="text-lg font-semibold">
          Ranked feed
        </h2>
        <p className="font-mono text-xs text-faint tabular-nums">{loaded ? tokens.length : "—"}</p>
      </div>
      <p className="text-sm text-muted">
        Momentum ranking, not a prediction. High momentum can reverse quickly. A token is listed only
        when the earlier checks passed and the buyer, volume, and 1-hour price figures were all present.
        Missing data is left out.
      </p>
      {snapshot?.discoveryNote ? <p className="text-sm text-muted">{snapshot.discoveryNote}</p> : null}
      {problem ? (
        <p className="rounded-card border border-border bg-surface px-3 py-3 text-sm text-fg" role="alert">
          {problem} No new tokens were added from that failed request.
        </p>
      ) : null}
      {!loaded ? (
        <p className="rounded-card border border-dashed border-border px-4 py-5 text-sm text-muted">
          Scanning.
        </p>
      ) : tokens.length === 0 ? (
        <p className="rounded-card border border-dashed border-border px-4 py-5 text-sm text-muted">
          {snapshot?.tokensScanned
            ? "No token passed every check. A pool under $10,000, an authority, holder, sell-quote, or RugCheck failure stays hidden, and so does a token missing its buyer, volume, or 1-hour price figure."
            : snapshot?.bitqueryConfigured
              ? "No Fomo buy in the latest Helius read could be scored."
              : "Automatic discovery did not run, so there are no Fomo buyer counts to score. Nothing here is ranked."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {snapshot?.stale ? (
            <li className="text-sm text-down">
              Stale data. The latest refresh failed. Figures below are from the previous scan.
            </li>
          ) : null}
          {tokens.map((token, index) => (
            <li key={token.mint} className="rounded-card border border-border bg-surface px-3 py-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-base font-semibold text-fg">
                    <span className="mr-2 font-mono text-sm text-muted">#{index + 1}</span>
                    {token.symbol ?? "Unavailable"}
                    <span className="ml-2 font-normal text-muted">· {token.name ?? "Unavailable"}</span>
                  </p>
                  <p className="mt-1 text-xs text-muted">{sourceText(token)}</p>
                </div>
                <p className="shrink-0 text-right">
                  <span
                    className={`block font-mono text-lg tabular-nums ${token.lateChaser ? "text-down" : "text-up"}`}
                  >
                    {token.momentumScore.toFixed(1)}
                  </span>
                  <span className="block text-xs text-faint">score</span>
                </p>
              </div>
              <p className="mt-2 font-mono text-sm break-all text-fg">{token.mint}</p>
              <button
                type="button"
                onClick={() => void onCopy(token.mint)}
                className="mt-2 inline-flex min-h-11 items-center gap-2 rounded-card border border-border bg-bg px-3 text-sm text-fg"
              >
                {copied === token.mint ? (
                  <Check className="size-4" aria-hidden="true" />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
                {copied === token.mint ? "Copied" : "Copy"}
              </button>
              <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted">Age</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatAge(token.pairCreatedAt)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Price</dt>
                  <dd className="font-mono text-fg tabular-nums">
                    {formatUsd(token.priceUsd, token.priceUsd !== null && token.priceUsd < 0.01 ? 8 : 4)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Liquidity</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatUsd(token.liquidityUsd, 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">5-minute volume</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatUsd(token.volumeM5Usd, 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Pool buys, 5 min</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatCount(token.buysM5)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Pool sells, 5 min</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatCount(token.sellsM5)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Largest holder</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatPct(token.largestHolderPct)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Top 10 holders</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatPct(token.top10Pct)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Sell quote</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatPct(token.sellReturnPct)} back</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">1h price change</dt>
                  <dd
                    className={`font-mono tabular-nums ${token.priceChangeH1 > 0 ? "text-up" : token.priceChangeH1 < 0 ? "text-down" : "text-fg"}`}
                  >
                    {token.priceChangeH1 > 0 ? "+" : ""}
                    {token.priceChangeH1.toLocaleString(undefined, { maximumFractionDigits: 1 })}%
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">1h volume</dt>
                  <dd className="font-mono text-fg tabular-nums">{formatUsd(token.volumeH1Usd, 0)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">RugCheck score</dt>
                  <dd className="font-mono text-fg tabular-nums">{token.rugScore.toLocaleString()}</dd>
                </div>
              </dl>
              <p className="mt-3 text-xs text-muted">{paceLine(token)}</p>
              <p className="mt-2 text-xs text-faint">
                Mint authority revoked. Freeze authority absent. Holder figures use the 20 largest
                token accounts, grouped by owner, after the main pool, burn address, and known lockers
                are removed. The sell figure is a Jupiter quote, not a trade. The score is 40% buyer
                pace, 25% buy-count pace, 20% volume pace, and 15% pool buy share.{" "}
                {token.lateChaser
                  ? "1h price is up more than 80%, so this score is halved."
                  : "1h price is not above the 80% late-chaser limit."}{" "}
                Momentum ranking, not a prediction.
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                <a className="text-accent underline-offset-2 hover:underline" href={token.pairUrl} rel="noreferrer" target="_blank">
                  DexScreener
                </a>
                {token.socials.map((link) => (
                  <a
                    key={link.url}
                    className="text-accent underline-offset-2 hover:underline"
                    href={link.url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
