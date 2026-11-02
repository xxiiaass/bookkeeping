// 统一的「本地日期」工具
// 注意：不要用 toISOString().slice(0,10) —— 那是 UTC 日期，
// 在东八区会导致 00:00~08:00 之间被算成前一天（快照/周期账/平账都会错位）。

export function localDate(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function localMonth(d = new Date()) {
  return localDate(d).slice(0, 7);
}
