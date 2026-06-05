from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
DATASET_DIR = ROOT / "dataset" / "forecasting"
OUT_DIR = Path(__file__).resolve().parent / "public" / "data"

MAX_SERIES_POINTS = 900
MAX_HEATMAP_CELLS = 1200
MAX_CORR_VARS = 60
MAX_LAG_POINTS = 36
MAX_ANOMALIES = 80
MAX_CHANNELS = 120


def clean_number(value: object) -> float | None:
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except TypeError:
        pass
    number = float(value)
    if math.isfinite(number):
        return round(number, 6)
    return None


def sample_frame(frame: pd.DataFrame, max_points: int = MAX_SERIES_POINTS) -> pd.DataFrame:
    if len(frame) <= max_points:
        return frame
    indexes = np.linspace(0, len(frame) - 1, max_points).round().astype(int)
    return frame.iloc[np.unique(indexes)]


def json_records(frame: pd.DataFrame) -> list[dict[str, object]]:
    records: list[dict[str, object]] = []
    for row in frame.itertuples(index=False):
        records.append(
            {
                "date": row.date.isoformat(),
                "value": clean_number(row.data),
            }
        )
    return records


def infer_step_minutes(dates: pd.Series) -> float | None:
    values = dates.drop_duplicates().sort_values()
    if len(values) < 2:
        return None
    deltas = values.diff().dropna().dt.total_seconds() / 60
    if deltas.empty:
        return None
    return clean_number(deltas.median())


def variable_stats(group: pd.DataFrame) -> dict[str, object]:
    data = pd.to_numeric(group["data"], errors="coerce")
    quantiles = data.quantile([0.05, 0.25, 0.5, 0.75, 0.95])
    return {
        "count": int(data.count()),
        "mean": clean_number(data.mean()),
        "std": clean_number(data.std()),
        "min": clean_number(data.min()),
        "q05": clean_number(quantiles.loc[0.05]),
        "q25": clean_number(quantiles.loc[0.25]),
        "median": clean_number(quantiles.loc[0.5]),
        "q75": clean_number(quantiles.loc[0.75]),
        "q95": clean_number(quantiles.loc[0.95]),
        "max": clean_number(data.max()),
    }


def histogram(values: pd.Series, bins: int = 36) -> dict[str, list[float | int]]:
    clean = pd.to_numeric(values, errors="coerce").dropna()
    if clean.empty:
        return {"edges": [], "counts": []}
    counts, edges = np.histogram(clean.to_numpy(), bins=bins)
    return {
        "edges": [clean_number(x) for x in edges],
        "counts": [int(x) for x in counts],
    }


def make_heatmap(frame: pd.DataFrame, freq_hint: str) -> dict[str, object]:
    work = frame.copy()
    if len(work) > 1_000_000:
        work = pd.concat(
            [sample_frame(group.sort_values("date"), 5000) for _, group in work.groupby("cols", observed=True)],
            ignore_index=True,
        )
    work["weekday"] = work["date"].dt.dayofweek
    work["hour"] = work["date"].dt.hour
    work["month"] = work["date"].dt.month
    work["day"] = work["date"].dt.day

    if freq_hint in {"hourly", "other"}:
        grouped = work.groupby(["weekday", "hour"], observed=True)["data"].mean().reset_index()
        cells = [
            {
                "x": int(row.hour),
                "y": int(row.weekday),
                "value": clean_number(row.data),
            }
            for row in grouped.itertuples(index=False)
        ]
        return {
            "mode": "weekday_hour",
            "xLabel": "小时",
            "yLabel": "星期",
            "xValues": list(range(24)),
            "yValues": ["周一", "周二", "周三", "周四", "周五", "周六", "周日"],
            "cells": cells[:MAX_HEATMAP_CELLS],
        }

    grouped = work.groupby(["month", "day"], observed=True)["data"].mean().reset_index()
    cells = [
        {
            "x": int(row.day),
            "y": int(row.month),
            "value": clean_number(row.data),
        }
        for row in grouped.itertuples(index=False)
    ]
    return {
        "mode": "month_day",
        "xLabel": "日",
        "yLabel": "月",
        "xValues": list(range(1, 32)),
        "yValues": [str(i) for i in range(1, 13)],
        "cells": cells[:MAX_HEATMAP_CELLS],
    }


def pick_correlation_vars(stats: dict[str, dict[str, object]]) -> list[str]:
    ranked = sorted(
        stats,
        key=lambda col: float(stats[col].get("std") or 0),
        reverse=True,
    )
    if "OT" in stats:
        ranked = ["OT"] + [name for name in ranked if name != "OT"]
    return ranked[:MAX_CORR_VARS]


def make_wide(frame: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    subset = frame[frame["cols"].isin(columns)]
    if len(subset) > 1_500_000:
        subset = pd.concat(
            [sample_frame(group.sort_values("date"), 6000) for _, group in subset.groupby("cols", observed=True)],
            ignore_index=True,
        )
    return subset.pivot_table(index="date", columns="cols", values="data", aggfunc="mean").sort_index()


def make_correlation(wide: pd.DataFrame) -> dict[str, object]:
    corr = wide.corr(min_periods=max(5, min(50, len(wide) // 8)))
    matrix = []
    for row_name in corr.index:
        matrix.append([clean_number(value) for value in corr.loc[row_name].to_list()])
    return {"variables": [str(x) for x in corr.columns], "matrix": matrix}


def make_lag(wide: pd.DataFrame, variables: list[str]) -> dict[str, object]:
    target = "OT" if "OT" in wide.columns else variables[0]
    target_series = wide[target]
    rows = []
    for var in variables[: min(12, len(variables))]:
        series = wide[var]
        values = []
        for lag in range(0, MAX_LAG_POINTS + 1):
            values.append(clean_number(series.shift(lag).corr(target_series)))
        rows.append({"variable": var, "target": target, "values": values})
    return {"target": target, "lags": list(range(0, MAX_LAG_POINTS + 1)), "series": rows}


def make_anomalies(frame: pd.DataFrame, variables: list[str]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for var in variables[: min(12, len(variables))]:
        group = frame[frame["cols"] == var].sort_values("date")
        if len(group) < 20:
            continue
        values = pd.to_numeric(group["data"], errors="coerce")
        window = min(max(len(group) // 40, 24), 240)
        rolling_mean = values.rolling(window, min_periods=max(6, window // 4)).mean()
        rolling_std = values.rolling(window, min_periods=max(6, window // 4)).std()
        scores = ((values - rolling_mean) / rolling_std.replace(0, np.nan)).abs()
        top = scores.sort_values(ascending=False).head(MAX_ANOMALIES)
        for idx, score in top.items():
            if pd.isna(score):
                continue
            row = group.loc[idx]
            rows.append(
                {
                    "variable": var,
                    "date": row["date"].isoformat(),
                    "value": clean_number(row["data"]),
                    "score": clean_number(score),
                }
            )
    rows.sort(key=lambda item: float(item.get("score") or 0), reverse=True)
    return rows[:MAX_ANOMALIES]


def make_channel_overview(stats: dict[str, dict[str, object]]) -> dict[str, object]:
    channels = []
    for name, item in stats.items():
        channels.append(
            {
                "variable": name,
                "mean": item["mean"],
                "std": item["std"],
                "min": item["min"],
                "max": item["max"],
            }
        )
    channels.sort(key=lambda item: float(item.get("std") or 0), reverse=True)
    return {"channels": channels[:MAX_CHANNELS]}


def process_file(path: Path, meta_row: dict[str, object] | None) -> dict[str, object]:
    df = pd.read_csv(path)
    required = {"date", "data", "cols"}
    if not required.issubset(df.columns):
        raise ValueError(f"{path.name} 缺少必要列: {required - set(df.columns)}")

    df = df[["date", "data", "cols"]].copy()
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    df["data"] = pd.to_numeric(df["data"], errors="coerce")
    df["cols"] = df["cols"].astype(str)
    df = df.dropna(subset=["date", "data", "cols"]).sort_values(["cols", "date"])

    freq_hint = str(meta_row.get("freq") if meta_row else "unknown")
    variables = [str(x) for x in df["cols"].drop_duplicates().to_list()]
    step_minutes = infer_step_minutes(df["date"])

    stats: dict[str, dict[str, object]] = {}
    series: dict[str, list[dict[str, object]]] = {}
    hists: dict[str, dict[str, list[float | int]]] = {}
    for var, group in df.groupby("cols", observed=True):
        ordered = group.sort_values("date")
        stats[str(var)] = variable_stats(ordered)
        if len(series) < MAX_CHANNELS:
            series[str(var)] = json_records(sample_frame(ordered))
            hists[str(var)] = histogram(ordered["data"])

    corr_vars = pick_correlation_vars(stats)
    wide = make_wide(df, corr_vars)
    correlation = make_correlation(wide)
    lag = make_lag(wide, corr_vars) if corr_vars else {"target": None, "lags": [], "series": []}
    heatmap_source_var = "OT" if "OT" in variables else variables[0]
    heatmap = make_heatmap(df[df["cols"] == heatmap_source_var], freq_hint)
    anomalies = make_anomalies(df, corr_vars)
    channel_overview = make_channel_overview(stats)

    dataset = {
        "name": path.stem,
        "file": path.name,
        "freq": freq_hint,
        "rows": int(len(df)),
        "variables": variables,
        "visibleVariables": list(series.keys()),
        "start": df["date"].min().isoformat(),
        "end": df["date"].max().isoformat(),
        "stepMinutes": step_minutes,
        "stats": stats,
        "series": series,
        "histograms": hists,
        "heatmapVariable": heatmap_source_var,
        "heatmap": heatmap,
        "correlation": correlation,
        "lag": lag,
        "anomalies": anomalies,
        "channelOverview": channel_overview,
    }
    return dataset


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    meta_path = DATASET_DIR / "FORECAST_META.csv"
    meta = {}
    if meta_path.exists():
        meta_df = pd.read_csv(meta_path)
        meta = {row["file_name"]: row.to_dict() for _, row in meta_df.iterrows()}

    manifest = []
    for csv_path in sorted(DATASET_DIR.glob("*.csv")):
        if csv_path.name == "FORECAST_META.csv":
            continue
        print(f"Processing {csv_path.name}...")
        dataset = process_file(csv_path, meta.get(csv_path.name))
        output_name = f"{csv_path.stem}.json"
        (OUT_DIR / output_name).write_text(
            json.dumps(dataset, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        manifest.append(
            {
                "name": dataset["name"],
                "file": output_name,
                "source": csv_path.name,
                "freq": dataset["freq"],
                "rows": dataset["rows"],
                "variables": len(dataset["variables"]),
                "start": dataset["start"],
                "end": dataset["end"],
            }
        )

    (OUT_DIR / "manifest.json").write_text(
        json.dumps({"datasets": manifest}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"Generated {len(manifest)} dataset summaries in {OUT_DIR}")


if __name__ == "__main__":
    main()
