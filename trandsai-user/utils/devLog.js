/**
 * @file utils/devLog.js
 * @description Development-only console helpers (no-op in production).
 */

const isDev =
  typeof process !== "undefined" &&
  process.env &&
  process.env.NODE_ENV === "development";

/** console.log gated to development */
export const devLog = (...args) => {
  if (isDev) console.log(...args);
};

/** console.warn gated to development */
export const devWarn = (...args) => {
  if (isDev) console.warn(...args);
};
