const state = {
  manifest: null,
  data: null,
  selectedVars: [],
  start: null,
  end: null,
  standardized: false,
};

const els = {
  datasetSelect: document.getElementById("datasetSelect"),
  viewSelect: document.getElementById("viewSelect"),
  standardizeControl: document.getElementById("standardizeControl"),
  standardizeToggle: document.getElementById("standardizeToggle"),
  variableList: document.getElementById("variableList"),
  startDate: document.getElementById("startDate"),
  endDate: document.getElementById("endDate"),
  resetRange: document.getElementById("resetRange"),
  title: document.getElementById("datasetTitle"),
  subtitle: document.getElementById("datasetSubtitle"),
  statStrip: document.getElementById("statStrip"),
  chartTitle: document.getElementById("chartTitle"),
  chartNote: document.getElementById("chartNote"),
  canvas: document.getElementById("mainCanvas"),
  table: document.getElementById("tableView"),
};

const colors = ["#0f766e", "#b45309", "#2563eb", "#be123c", "#7c3aed", "#15803d", "#c2410c", "#0e7490"];
const cnWeek = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const endogenousByDataset = {
  ETTh1: ["OT"],
  ETTh2: ["OT"],
  ETTm1: ["OT"],
  ETTm2: ["OT"],
  Weather: ["OT"],
  Electricity: ["channel_321"],
  Exchange: ["OT"],
  Traffic: ["channel_862"],
  NP: ["OT"],
  PJM: ["OT"],
  BE: ["OT"],
  FR: ["OT"],
  DE: ["OT"],
  Energy: ["Thermoelectric"],
  Colbun: ["Water_Level_daily_avg"],
  Rapel: ["Water_Level_daily_avg"],
  Sdwpfh1: ["Patv"],
  Sdwpfh2: ["Patv"],
  Sdwpfm1: ["Patv"],
  Sdwpfm2: ["Patv"],
};

function fmt(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
  const v = Number(n);
  if (Math.abs(v) >= 1000) return v.toLocaleString("zh-CN", { maximumFractionDigits: 1 });
  if (Math.abs(v) >= 1) return v.toLocaleString("zh-CN", { maximumFractionDigits: 3 });
  return v.toLocaleString("zh-CN", { maximumFractionDigits: 5 });
}

function day(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function resizeCanvas() {
  const rect = els.canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  els.canvas.width = Math.max(900, Math.floor(rect.width * dpr));
  els.canvas.height = Math.max(520, Math.floor(rect.height * dpr));
  return els.canvas.getContext("2d");
}

function clearCanvas() {
  els.canvas.classList.remove("hidden");
  els.table.classList.add("hidden");
  const ctx = resizeCanvas();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
  return ctx;
}

function showTable(html) {
  els.canvas.classList.add("hidden");
  els.table.classList.remove("hidden");
  els.table.innerHTML = html;
}

function chartArea(ctx) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  return { x: 72, y: 34, w: w - 112, h: h - 92 };
}

function drawAxes(ctx, area, xLabels = [], yLabel = "") {
  ctx.strokeStyle = "#d8ddd5";
  ctx.lineWidth = 1;
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  ctx.fillStyle = "#647067";
  ctx.font = "13px Microsoft YaHei, Segoe UI, sans-serif";
  xLabels.forEach((label, i) => {
    const x = area.x + (area.w * i) / Math.max(1, xLabels.length - 1);
    ctx.fillText(label, x - 36, area.y + area.h + 30);
  });
  if (yLabel) ctx.fillText(yLabel, 14, area.y + 16);
}

function getDateRangeMs() {
  const start = state.start ? new Date(state.start).getTime() : new Date(state.data.start).getTime();
  const end = state.end ? new Date(`${state.end}T23:59:59`).getTime() : new Date(state.data.end).getTime();
  return [start, end];
}

function filteredSeries(varName) {
  const [start, end] = getDateRangeMs();
  return (state.data.series[varName] || []).filter((d) => {
    const t = new Date(d.date).getTime();
    return t >= start && t <= end;
  });
}

function selectedAvailable() {
  return state.selectedVars.filter((name) => state.data.visibleVariables.includes(name));
}

function isEndogenous(name) {
  return (endogenousByDataset[state.data.name] || []).includes(name);
}

function standardizeValue(varName, value) {
  if (!state.standardized || value === null || value === undefined) return value;
  const stats = state.data.stats[varName] || {};
  const mean = Number(stats.mean);
  const std = Number(stats.std);
  if (!Number.isFinite(mean) || !Number.isFinite(std) || std === 0) return value;
  return (Number(value) - mean) / std;
}

function nonStandardizableVars(vars) {
  if (!state.standardized) return [];
  return vars.filter((name) => {
    const stats = state.data.stats[name] || {};
    const std = Number(stats.std);
    return !Number.isFinite(Number(stats.mean)) || !Number.isFinite(std) || std === 0;
  });
}

async function loadManifest() {
  const res = await fetch("./public/data/manifest.json");
  state.manifest = await res.json();
  els.datasetSelect.innerHTML = state.manifest.datasets
    .map((d) => `<option value="${d.file}">${d.name}</option>`)
    .join("");
}

async function loadDataset(file) {
  const res = await fetch(`./public/data/${file}`);
  state.data = await res.json();
  state.selectedVars = state.data.visibleVariables.slice(0, Math.min(4, state.data.visibleVariables.length));
  state.start = day(state.data.start);
  state.end = day(state.data.end);
  syncControls();
  render();
}

function syncControls() {
  els.title.textContent = state.data.name;
  els.subtitle.textContent = `${state.data.freq} · ${state.data.start.slice(0, 10)} 至 ${state.data.end.slice(0, 10)}`;
  els.startDate.value = state.start;
  els.endDate.value = state.end;
  els.startDate.min = day(state.data.start);
  els.startDate.max = day(state.data.end);
  els.endDate.min = day(state.data.start);
  els.endDate.max = day(state.data.end);
  els.standardizeToggle.checked = state.standardized;

  const hidden = Math.max(0, state.data.variables.length - state.data.visibleVariables.length);
  els.variableList.innerHTML = state.data.visibleVariables
    .map((name) => {
      const checked = state.selectedVars.includes(name) ? "checked" : "";
      const endogenousClass = isEndogenous(name) ? " endogenous-var" : "";
      return `<label class="check-row"><input type="checkbox" value="${name}" ${checked} /> <span class="${endogenousClass.trim()}">${name}</span></label>`;
    })
    .join("") + (hidden ? `<div class="check-row"><span>另有 ${hidden} 个通道在高维概览中展示</span></div>` : "");

  els.statStrip.innerHTML = [
    ["行数", state.data.rows.toLocaleString("zh-CN")],
    ["变量", state.data.variables.length],
    ["采样间隔", state.data.stepMinutes ? `${fmt(state.data.stepMinutes)} 分钟` : "-"],
    ["可绘制变量", state.data.visibleVariables.length],
  ]
    .map(([label, value]) => `<div class="stat"><b>${value}</b><span>${label}</span></div>`)
    .join("");
}

function render() {
  if (!state.data) return;
  const view = els.viewSelect.value;
  els.standardizeControl.classList.toggle("hidden", view !== "series");
  const titles = {
    series: ["时间序列", seriesNote()],
    seasonality: ["季节性热力图", `使用 ${state.data.heatmapVariable} 的均值聚合。`],
    distribution: ["分布与箱线摘要", "对当前选中变量展示直方图、分位数和箱线摘要。"],
    correlation: ["相关性矩阵", "变量过多时选取波动最大的变量和 OT。"],
    lag: ["滞后相关", "展示当前变量相对目标变量的 lag 相关变化。"],
    periodicity: ["周期性分析", "基于完整 CSV 预处理结果，比较小时、星期、月份与候选滞后周期。"],
    anomaly: ["异常点", "基于滚动 z-score 的高分异常候选。"],
    channels: ["高维通道概览", "按标准差排序展示通道均值与波动。"],
  };
  els.chartTitle.textContent = titles[view][0];
  els.chartNote.textContent = titles[view][1];
  if (view === "series") drawSeries();
  if (view === "seasonality") drawHeatmap();
  if (view === "distribution") drawDistribution();
  if (view === "correlation") drawCorrelation();
  if (view === "lag") drawLag();
  if (view === "periodicity") renderPeriodicity();
  if (view === "anomaly") renderAnomalies();
  if (view === "channels") renderChannels();
}

function seriesNote() {
  if (!state.standardized) return "折线已抽样；筛选时间范围后会同步缩放。";
  const skipped = nonStandardizableVars(selectedAvailable());
  const suffix = skipped.length ? `；${skipped.slice(0, 3).join("、")} 缺少有效标准差，保留原值。` : "";
  return `当前显示 z-score，便于比较不同量纲变量${suffix}`;
}

function drawSeries() {
  const ctx = clearCanvas();
  const area = chartArea(ctx);
  const vars = selectedAvailable();
  const allPoints = vars.flatMap((name) =>
    filteredSeries(name)
      .map((p) => standardizeValue(name, p.value))
      .filter((v) => v !== null && Number.isFinite(Number(v)))
  );
  if (!allPoints.length) return drawMessage(ctx, "当前时间范围内没有可绘制数据");
  const minY = Math.min(...allPoints);
  const maxY = Math.max(...allPoints);
  const [start, end] = getDateRangeMs();
  drawAxes(ctx, area, [day(start), day(end)], state.standardized ? "z-score" : "值");

  vars.forEach((name, idx) => {
    const points = filteredSeries(name);
    let started = false;
    ctx.beginPath();
    ctx.strokeStyle = colors[idx % colors.length];
    ctx.lineWidth = 2;
    points.forEach((p) => {
      const value = standardizeValue(name, p.value);
      if (value === null || !Number.isFinite(Number(value))) return;
      const x = area.x + ((new Date(p.date).getTime() - start) / Math.max(1, end - start)) * area.w;
      const y = area.y + area.h - ((value - minY) / Math.max(1e-12, maxY - minY)) * area.h;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    drawLegend(ctx, name, colors[idx % colors.length], area.x + 10, area.y + 20 + idx * 24);
  });
}

function drawHeatmap() {
  const ctx = clearCanvas();
  const area = chartArea(ctx);
  const hm = state.data.heatmap;
  const cells = hm.cells.filter((c) => c.value !== null);
  const min = Math.min(...cells.map((c) => c.value));
  const max = Math.max(...cells.map((c) => c.value));
  const cols = hm.xValues.length;
  const rows = hm.yValues.length;
  const cw = area.w / cols;
  const ch = area.h / rows;
  cells.forEach((c) => {
    const xIdx = hm.xValues.indexOf(c.x);
    const yIdx = hm.mode === "weekday_hour" ? c.y : hm.yValues.indexOf(String(c.y));
    ctx.fillStyle = heatColor((c.value - min) / Math.max(1e-12, max - min));
    ctx.fillRect(area.x + xIdx * cw, area.y + yIdx * ch, cw + 1, ch + 1);
  });
  ctx.fillStyle = "#1e2420";
  ctx.font = "12px Microsoft YaHei, Segoe UI, sans-serif";
  hm.yValues.forEach((label, i) => ctx.fillText(label, area.x - 42, area.y + i * ch + ch * 0.65));
  hm.xValues.forEach((label, i) => {
    if (i % Math.ceil(cols / 12) === 0) ctx.fillText(String(label), area.x + i * cw, area.y + area.h + 24);
  });
}

function drawDistribution() {
  const ctx = clearCanvas();
  const vars = selectedAvailable().slice(0, 4);
  if (!vars.length) return drawMessage(ctx, "请选择至少一个变量");
  const area = chartArea(ctx);
  const paneW = area.w / vars.length;
  vars.forEach((name, idx) => {
    const hist = state.data.histograms[name];
    const stats = state.data.stats[name];
    const x0 = area.x + idx * paneW + 18;
    const w = paneW - 36;
    const maxCount = Math.max(...hist.counts, 1);
    ctx.fillStyle = colors[idx % colors.length];
    hist.counts.forEach((count, i) => {
      const bw = w / hist.counts.length;
      const h = (count / maxCount) * (area.h * 0.58);
      ctx.globalAlpha = 0.75;
      ctx.fillRect(x0 + i * bw, area.y + area.h * 0.62 - h, Math.max(1, bw - 1), h);
    });
    ctx.globalAlpha = 1;
    const boxY = area.y + area.h * 0.76;
    const mapX = (v) => x0 + ((v - stats.min) / Math.max(1e-12, stats.max - stats.min)) * w;
    ctx.strokeStyle = "#1e2420";
    ctx.strokeRect(mapX(stats.q25), boxY - 18, Math.max(2, mapX(stats.q75) - mapX(stats.q25)), 36);
    ctx.beginPath();
    ctx.moveTo(mapX(stats.min), boxY);
    ctx.lineTo(mapX(stats.max), boxY);
    ctx.moveTo(mapX(stats.median), boxY - 22);
    ctx.lineTo(mapX(stats.median), boxY + 22);
    ctx.stroke();
    ctx.fillStyle = "#1e2420";
    ctx.font = "13px Microsoft YaHei, Segoe UI, sans-serif";
    ctx.fillText(name, x0, area.y + area.h + 34);
    ctx.fillText(`均值 ${fmt(stats.mean)} · σ ${fmt(stats.std)}`, x0, area.y + area.h + 52);
  });
}

function drawCorrelation() {
  const ctx = clearCanvas();
  const area = chartArea(ctx);
  const corr = state.data.correlation;
  const n = corr.variables.length;
  if (!n) return drawMessage(ctx, "没有相关矩阵数据");
  const cell = Math.min(area.w, area.h) / n;
  const x0 = area.x + 22;
  const y0 = area.y + 10;
  corr.matrix.forEach((row, y) => {
    row.forEach((v, x) => {
      ctx.fillStyle = corrColor(v);
      ctx.fillRect(x0 + x * cell, y0 + y * cell, cell + 1, cell + 1);
    });
  });
  ctx.fillStyle = "#1e2420";
  ctx.font = n > 25 ? "10px Microsoft YaHei, Segoe UI, sans-serif" : "12px Microsoft YaHei, Segoe UI, sans-serif";
  corr.variables.forEach((name, i) => {
    if (n <= 30 || i % Math.ceil(n / 30) === 0) {
      ctx.fillText(name.slice(0, 10), x0 + i * cell, y0 + n * cell + 18);
      ctx.fillText(name.slice(0, 10), x0 - 58, y0 + i * cell + cell * 0.8);
    }
  });
}

function drawLag() {
  const ctx = clearCanvas();
  const area = chartArea(ctx);
  const selected = new Set(selectedAvailable());
  const rows = state.data.lag.series.filter((row) => selected.size === 0 || selected.has(row.variable)).slice(0, 8);
  if (!rows.length) return drawMessage(ctx, "当前变量没有滞后相关数据");
  drawAxes(ctx, area, ["lag 0", `lag ${state.data.lag.lags.at(-1)}`], "相关");
  rows.forEach((row, idx) => {
    ctx.beginPath();
    ctx.strokeStyle = colors[idx % colors.length];
    ctx.lineWidth = 2;
    row.values.forEach((v, i) => {
      const x = area.x + (i / Math.max(1, row.values.length - 1)) * area.w;
      const y = area.y + area.h - (((v || 0) + 1) / 2) * area.h;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    drawLegend(ctx, `${row.variable} → ${row.target}`, colors[idx % colors.length], area.x + 10, area.y + 20 + idx * 24);
  });
}

function renderAnomalies() {
  const selected = new Set(selectedAvailable());
  const rows = state.data.anomalies.filter((row) => selected.size === 0 || selected.has(row.variable)).slice(0, 60);
  showTable(`<table><thead><tr><th>变量</th><th>时间</th><th>值</th><th>异常分数</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${r.variable}</td><td>${r.date.replace("T", " ")}</td><td>${fmt(r.value)}</td><td>${fmt(r.score)}</td></tr>`)
    .join("")}</tbody></table>`);
}

function renderPeriodicity() {
  const periodicity = state.data.periodicity;
  if (!periodicity || !Array.isArray(periodicity.variables)) {
    showTable('<div class="empty-state">请重新运行预处理生成周期性摘要</div>');
    return;
  }
  const selected = new Set(selectedAvailable());
  if (!selected.size) {
    showTable('<div class="empty-state">请选择至少一个变量</div>');
    return;
  }
  const rows = periodicity.variables.filter((row) => selected.has(row.variable)).slice(0, 8);
  if (!rows.length) {
    showTable('<div class="empty-state">当前变量没有周期性摘要</div>');
    return;
  }
  showTable(`<table><thead><tr><th>变量</th><th>最强周期</th><th>小时强度</th><th>星期强度</th><th>月份强度</th><th>自相关峰值</th></tr></thead><tbody>${rows
    .map((r) => {
      const best = r.autocorrelation && r.autocorrelation.best;
      const strengths = r.strengths || {};
      const bestText = best && best.correlation !== null ? `${best.label} (${fmt(best.correlation)})` : "-";
      return `<tr><td>${r.variable}</td><td>${r.strongestCycle || "-"}</td><td>${fmt(strengths.hour)}</td><td>${fmt(strengths.weekday)}</td><td>${fmt(strengths.month)}</td><td>${bestText}</td></tr>`;
    })
    .join("")}</tbody></table>`);
}

function renderChannels() {
  const rows = state.data.channelOverview.channels;
  showTable(`<table><thead><tr><th>通道</th><th>均值</th><th>标准差</th><th>最小值</th><th>最大值</th></tr></thead><tbody>${rows
    .map((r) => `<tr><td>${r.variable}</td><td>${fmt(r.mean)}</td><td>${fmt(r.std)}</td><td>${fmt(r.min)}</td><td>${fmt(r.max)}</td></tr>`)
    .join("")}</tbody></table>`);
}

function drawLegend(ctx, label, color, x, y) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 10, 14, 14);
  ctx.fillStyle = "#1e2420";
  ctx.font = "13px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.fillText(label, x + 20, y + 2);
}

function drawMessage(ctx, message) {
  ctx.fillStyle = "#647067";
  ctx.font = "18px Microsoft YaHei, Segoe UI, sans-serif";
  ctx.fillText(message, 80, 90);
}

function heatColor(t) {
  const clamped = Math.max(0, Math.min(1, t));
  const r = Math.round(238 - clamped * 204);
  const g = Math.round(242 - clamped * 114);
  const b = Math.round(230 - clamped * 77);
  return `rgb(${r},${g},${b})`;
}

function corrColor(v) {
  if (v === null || v === undefined) return "#f1f5f2";
  const t = (v + 1) / 2;
  const r = Math.round(190 * (1 - t) + 15 * t);
  const g = Math.round(18 * (1 - t) + 118 * t);
  const b = Math.round(60 * (1 - t) + 110 * t);
  return `rgb(${r},${g},${b})`;
}

els.datasetSelect.addEventListener("change", () => loadDataset(els.datasetSelect.value));
els.viewSelect.addEventListener("change", render);
els.standardizeToggle.addEventListener("change", () => {
  state.standardized = els.standardizeToggle.checked;
  render();
});
els.variableList.addEventListener("change", () => {
  state.selectedVars = [...els.variableList.querySelectorAll("input:checked")].map((input) => input.value);
  render();
});
els.startDate.addEventListener("change", () => {
  state.start = els.startDate.value;
  render();
});
els.endDate.addEventListener("change", () => {
  state.end = els.endDate.value;
  render();
});
els.resetRange.addEventListener("click", () => {
  state.start = day(state.data.start);
  state.end = day(state.data.end);
  syncControls();
  render();
});
window.addEventListener("resize", render);

loadManifest()
  .then(() => loadDataset(state.manifest.datasets[0].file))
  .catch((error) => {
    const ctx = clearCanvas();
    drawMessage(ctx, `数据加载失败：${error.message}`);
  });
