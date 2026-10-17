"""Command line: python -m mbi <command>

  daily        ingest any new sessions, compute, classify (run after ~6:30 PM IST)
  backfill     --from YYYY-MM-DD [--to] [--fallback] [--rebuild]
  recompute    [--from] [--to] [--states-only]   (offline, from the archive)
  universe     --refresh | --diff [A] [B] | --show [VERSION]
  consolidate  rebuild data/prices/prices_all.parquet
  compare      --date A --date B [--ema 20]
  export-stock SYMBOL [--adjusted]           (CSV to stdout)
  export-history                            (CSV to stdout, parquet fallback)
  day-detail   --date D                       (per-stock table for /stocks)
  classify-preview --config PATH              (JSON: how many states would change)
  demo         [--days 300]                   (synthetic data for UI testing)
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime
from pathlib import Path

import pandas as pd

from . import paths, pipeline, store, universe
from .classifier import STATES
from .status import StatusStore

log = logging.getLogger("mbi")

MUTATING = {"daily", "backfill", "recompute", "universe", "consolidate", "demo"}


def setup_logging(command: str, to_file: bool) -> str | None:
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s", "%Y-%m-%d %H:%M:%S")
    sh = logging.StreamHandler(sys.stderr)
    sh.setFormatter(fmt)
    root.addHandler(sh)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("yfinance").setLevel(logging.WARNING)
    if not to_file:
        return None
    d = paths.logs_dir()
    d.mkdir(parents=True, exist_ok=True)
    logs = sorted(d.glob("mbi_*.log"))
    for old in logs[:-49]:
        try:
            old.unlink()
        except OSError:
            pass
    f = d / f"mbi_{datetime.now():%Y%m%d_%H%M%S}_{command}.log"
    fh = logging.FileHandler(f, encoding="utf-8")
    fh.setFormatter(fmt)
    root.addHandler(fh)
    return str(f.relative_to(paths.data_dir())).replace("\\", "/")


def _d(s: str) -> date:
    return date.fromisoformat(s)


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="mbi", description="Market Breadth Indicator (India)")
    sub = p.add_subparsers(dest="command", required=True)

    s = sub.add_parser("daily")
    s.add_argument("--date", type=_d, help="treat this as the latest session (default: today after 6:30 PM IST)")
    s.add_argument("--offline", action="store_true", help="no network: recompute from the archive only")

    s = sub.add_parser("backfill")
    s.add_argument("--from", dest="start", type=_d, required=True)
    s.add_argument("--to", dest="end", type=_d)
    s.add_argument("--fallback", action="store_true", help="use NSE API / yfinance when a bhavcopy is missing")
    s.add_argument("--rebuild", action="store_true", help="re-download and replace archived days in range")
    s.add_argument("--no-nanocap", action="store_true")

    s = sub.add_parser("recompute")
    s.add_argument("--from", dest="start", type=_d)
    s.add_argument("--to", dest="end", type=_d)
    s.add_argument("--states-only", action="store_true", help="only re-run the classifier")

    s = sub.add_parser("universe")
    g = s.add_mutually_exclusive_group(required=True)
    g.add_argument("--refresh", action="store_true")
    g.add_argument("--diff", nargs="*", metavar="VERSION", help="diff two versions (default: last two; 'seed' allowed)")
    g.add_argument("--show", nargs="?", const="latest", metavar="VERSION")
    s.add_argument("--amfi-file", help="optional AMFI average market cap xlsx for nanocap ranking")
    s.add_argument("--nanocap-only", action="store_true")
    s.add_argument("--offline", action="store_true")

    sub.add_parser("consolidate")

    s = sub.add_parser("compare")
    s.add_argument("--date", dest="dates", type=_d, action="append", required=True)
    s.add_argument("--ema", type=int, default=20, choices=(10, 20, 50))
    s.add_argument("--json", action="store_true")

    s = sub.add_parser("export-stock")
    s.add_argument("symbol")
    s.add_argument("--adjusted", action="store_true")

    s = sub.add_parser("print-config", help="print regime_config.json (writes defaults if missing)")
    s.add_argument("--defaults", action="store_true")

    sub.add_parser("export-history", help="history CSV to stdout (falls back to the parquet copy)")

    s = sub.add_parser("day-detail")
    s.add_argument("--date", type=_d, required=True)

    s = sub.add_parser("classify-preview")
    s.add_argument("--config", required=True)

    s = sub.add_parser("demo")
    s.add_argument("--days", type=int, default=300)
    s.add_argument("--seed", type=int, default=7)
    s.add_argument("--force", action="store_true")
    return p


# --------------------------------------------------------------------------- commands

def cmd_compare(args) -> int:
    hist = store.read_history()
    if len(args.dates) != 2:
        print("compare needs exactly two --date values", file=sys.stderr)
        return 2
    a, b = args.dates
    cols = ["n_valid", "n_high", "n_low", "vol_ratio", "vol_regime", "pct_ema10", "pct_ema20", "pct_ema50",
            f"state_ema{args.ema}"]
    out = []
    for bucket in store.ALL_BUCKETS:
        ra = hist[(hist["date"] == a) & (hist["bucket"] == bucket)]
        rb = hist[(hist["date"] == b) & (hist["bucket"] == bucket)]
        row = {"bucket": bucket}
        for c in cols:
            va = ra[c].iloc[0] if len(ra) else None
            vb = rb[c].iloc[0] if len(rb) else None
            row[f"{c}@A"] = va
            row[f"{c}@B"] = vb
            try:
                row[f"{c} Δ"] = round(float(vb) - float(va), 3)
            except (TypeError, ValueError):
                pass
        out.append(row)
    if args.json:
        print(json.dumps(pipeline.records(pd.DataFrame(out)), indent=2))
        return 0
    print(f"A = {a}   B = {b}   (EMA{args.ema} state)")
    df = pd.DataFrame(out).set_index("bucket").T
    with pd.option_context("display.max_rows", 200, "display.width", 200):
        print(df.to_string())
    return 0


def cmd_export_stock(args) -> int:
    sym = args.symbol.upper()
    df = store.load_prices()
    df = df[df["symbol"] == sym].sort_values("date")
    if args.adjusted:
        from . import adjust
        df = adjust.adjust_ohlcv(df, adjust.load_splits(write_report=False))
    sys.stdout.write(df.to_csv(index=False, lineterminator="\n"))
    return 0 if len(df) else 1


def cmd_universe(args, status: StatusStore) -> int:
    if args.refresh:
        client = pipeline.make_client()
        v = universe.build_or_refresh(client, status, today=date.today(), amfi_file=args.amfi_file,
                                      nanocap_only=args.nanocap_only, offline=args.offline)
        df = universe.load_version(v)
        print(f"universe {v}: {df['bucket'].value_counts().to_dict()}")
        for w in (status.data.get("universe") or {}).get("warnings", []):
            print(f"  warning: {w}")
        return 0
    if args.show is not None:
        versions = universe.list_versions()
        if not versions:
            print("no universe versions yet")
            return 1
        v = versions[-1] if args.show == "latest" else _d(args.show)
        df = universe.load_version(v)
        print(df.to_string(index=False))
        return 0
    versions = universe.list_versions()

    def load(x: str) -> tuple[str, pd.DataFrame]:
        if x == "seed":
            return "seed", universe.load_seed()
        return x, universe.load_version(_d(x))

    names = list(args.diff or [])
    if not names:
        if len(versions) >= 2:
            names = [versions[-2].isoformat(), versions[-1].isoformat()]
        elif versions:
            names = ["seed", versions[-1].isoformat()]
        else:
            print("no universe versions yet")
            return 1
    if len(names) == 1:
        names = [names[0], versions[-1].isoformat()]
    (na, a), (nb, b) = load(names[0]), load(names[1])
    d = universe.diff(a, b)
    print(f"diff {na} -> {nb}")
    for k in ("promoted", "demoted", "added", "removed"):
        print(f"\n{k.upper()} ({len(d[k])})")
        for r in d[k]:
            print("  " + "  ".join(f"{kk}={vv}" for kk, vv in r.items()))
    return 0


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    mutating = args.command in MUTATING and not (args.command == "universe" and not args.refresh)
    log_file = setup_logging(args.command, to_file=mutating)

    if args.command == "compare":
        return cmd_compare(args)
    if args.command == "export-stock":
        return cmd_export_stock(args)
    if args.command == "print-config":
        from .classifier import DEFAULT_CONFIG, load_config
        print(json.dumps(DEFAULT_CONFIG if args.defaults else load_config(), indent=2))
        return 0
    if args.command == "export-history":
        sys.stdout.write(store.read_history().to_csv(index=False, lineterminator="\n"))
        return 0
    if args.command == "classify-preview":
        print(json.dumps(pipeline.classify_preview(args.config)))
        return 0
    if args.command == "day-detail":
        ok = pipeline.day_detail(StatusStore(autosave=False), args.date)
        print(json.dumps({"ok": ok, "path": str(paths.day_detail_file(args.date))}))
        return 0 if ok else 1

    status = StatusStore()
    if mutating:
        status.run_started(" ".join(["mbi"] + (argv if argv is not None else sys.argv[1:])), log_file)
    try:
        if args.command == "daily":
            res = pipeline.daily(status, target=args.date, offline=args.offline)
            outcomes = [r["outcome"] for r in res["ingested"]]
            summary = f"sessions fetched: {outcomes or 'none new'}; computed {res['computed']} session(s)"
            if res["network_down"]:
                summary += "; network down - showing stored data"
        elif args.command == "backfill":
            counts = pipeline.backfill(status, args.start, args.end, fallback=args.fallback,
                                       rebuild=args.rebuild, build_nanocap=not args.no_nanocap)
            summary = f"backfill {args.start}..{args.end or 'latest'}: {counts}"
        elif args.command == "recompute":
            n = pipeline.recompute(status, args.start, args.end, states_only=args.states_only)
            summary = f"recomputed {n} {'rows (states only)' if args.states_only else 'session(s)'}"
        elif args.command == "universe":
            rc = cmd_universe(args, status)
            summary = "universe command"
            if not mutating:
                return rc
        elif args.command == "consolidate":
            p = store.consolidate()
            summary = f"wrote {p}"
        elif args.command == "demo":
            from .demo import build_demo
            summary = build_demo(status, days=args.days, seed=args.seed, force=args.force)
        else:  # pragma: no cover
            raise SystemExit(f"unknown command {args.command}")
        log.info(summary)
        print(summary)
        if mutating:
            status.run_finished(True, summary)
        return 0
    except KeyboardInterrupt as e:
        if mutating:
            status.run_finished(False, "interrupted", e)
        return 130
    except Exception as e:  # noqa: BLE001 - spec 9: record crash, keep earlier data
        log.exception("%s failed", args.command)
        if mutating:
            status.run_finished(False, None, e)
        return 1


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
