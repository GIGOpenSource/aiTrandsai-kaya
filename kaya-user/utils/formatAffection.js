/**
 * @description 亲密度数值展示格式化：统一小数精度并去除无意义尾随零。
 */

/**
 * 将亲密度数值格式化为展示字符串。
 * @param {unknown} value - 亲密度原始值（数字或可转为数字的字符串）
 * @returns {string} 格式化后的展示文本，无效值返回 "0"
 */
export function formatAffectionDisplay(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "0";
  const rounded = Math.round(n * 1000) / 1000;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
