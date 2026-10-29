/**
 * @file loadPresets.js
 * @description 按 UI 语言加载创建伴侣预设 JSON 与城市列表。
 * 供 pages-sub/create 使用；城市表见同目录 cities.json。
 * 
 * 注意：使用静态 import 而非动态 import，避免触发代码分割。
 * uni-app APP端构建时不支持 IIFE/UMD 格式与代码分割共存。
 */

// 静态导入所有语言预设（JSON文件体积小，不影响首包）
import zhPreset from "./presets/zh.json";
import enPreset from "./presets/en.json";
import jaPreset from "./presets/ja.json";
import koPreset from "./presets/ko.json";
import ptPreset from "./presets/pt.json";
import esPreset from "./presets/es.json";
import idPreset from "./presets/id.json";
import arPreset from "./presets/ar.json";
import faPreset from "./presets/fa.json";
import ruPreset from "./presets/ru.json";
import bgPreset from "./presets/bg.json";
import trPreset from "./presets/tr.json";
import citiesData from "./cities.json";

/** 各语言预设人设映射表 */
const PRESETS = {
  zh: zhPreset,
  en: enPreset,
  ja: jaPreset,
  ko: koPreset,
  pt: ptPreset,
  es: esPreset,
  id: idPreset,
  ar: arPreset,
  fa: faPreset,
  ru: ruPreset,
  bg: bgPreset,
  tr: trPreset,
};

/**
 * 加载指定语言的预设人设列表；未知语言回退 zh
 * @param {string} lang
 * @returns {any[]}
 */
export function loadPresetPersonas(lang) {
  const key = (lang || "zh").split("-")[0];
  return PRESETS[key] ?? PRESETS.zh;
}

/**
 * 加载 cities.json 中对应语言的城市数组
 * @param {string} lang
 * @returns {string[]}
 */
export function loadCitiesByLang(lang) {
  const key = (lang || "zh").split("-")[0];
  return citiesData[key] ?? citiesData.zh ?? [];
}
