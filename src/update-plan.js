import { createHash } from "node:crypto";
import { diffLines } from "diff";
import { hasConfigAssignments, mergeLuaConfig } from "./lua-config.js";

const forcedNames = new Set(["fxmanifest.lua", "__resource.lua"]);
const normalizePath = (value) => {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (normalized.startsWith("/") || normalized.split("/").includes("..")) { const error = new Error("Invalid file path in update payload"); error.statusCode = 422; throw error; }
  return normalized;
};
const isConfig = (file, oldContent, newContent) => {
  if (!file.toLowerCase().endsWith(".lua")) return false;
  const namedAsConfig = file.toLowerCase().split("/").some((part) => /^(config|configs|settings|api[-_]?keys?|credentials|webhooks?|secrets?)(\.|$)/.test(part));
  return namedAsConfig || (hasConfigAssignments(oldContent) && hasConfigAssignments(newContent));
};
const isForced = (file) => forcedNames.has(file.toLowerCase().split("/").at(-1)) || file.toLowerCase().endsWith(".fxap");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function lineDiff(oldText, newText) {
  return diffLines(oldText, newText).map((part) => ({ type: part.added ? "added" : part.removed ? "removed" : "unchanged", value: part.value, count: part.count ?? 0 }));
}

export function createUpdatePlan(oldFiles, newFiles, { preserveConfigs = true } = {}) {
  const oldMap = new Map(oldFiles.map((file) => [normalizePath(file.path), file]));
  const newMap = new Map(newFiles.map((file) => [normalizePath(file.path), file]));
  const paths = [...new Set([...oldMap.keys(), ...newMap.keys()])].sort();
  const files = [];
  for (const path of paths) {
    const oldFile = oldMap.get(path); const newFile = newMap.get(path);
    if (!newFile) { files.push({ path, action: "delete", strategy: "replace", oldContent: oldFile.content ?? null, newContent: null, outputContent: null, encoding: oldFile.encoding, diff: oldFile.encoding === "utf8" ? lineDiff(oldFile.content || "", "") : [] }); continue; }
    if (!oldFile) { files.push({ path, action: "add", strategy: "replace", oldContent: null, newContent: newFile.content ?? null, outputContent: newFile.content, encoding: newFile.encoding, diff: newFile.encoding === "utf8" ? lineDiff("", newFile.content || "") : [] }); continue; }
    if ((oldFile.hash && newFile.hash && oldFile.hash === newFile.hash) || sha256(oldFile.content || "") === sha256(newFile.content || "")) { files.push({ path, action: "unchanged", strategy: "replace", encoding: newFile.encoding }); continue; }
    const readable = oldFile.encoding === "utf8" && newFile.encoding === "utf8";
    let outputContent = newFile.content; let strategy = readable ? "replace" : "binary-replace"; let warning = null;
    if (preserveConfigs && !isForced(path) && readable && isConfig(path, oldFile.content, newFile.content)) {
      try { outputContent = mergeLuaConfig(oldFile.content, newFile.content); strategy = "preserve-config"; }
      catch { outputContent = oldFile.content; strategy = "preserve-old"; warning = "Configuration could not be parsed; the installed file was preserved."; }
    }
    files.push({ path, action: "modify", strategy, warning, encoding: newFile.encoding, oldContent: readable ? oldFile.content : null, newContent: readable ? newFile.content : null, outputContent, diff: readable ? lineDiff(oldFile.content, outputContent) : [] });
  }
  const changed = files.filter((file) => file.action !== "unchanged");
  return { summary: { total: files.length, changed: changed.length, added: changed.filter((x) => x.action === "add").length, modified: changed.filter((x) => x.action === "modify").length, deleted: changed.filter((x) => x.action === "delete").length, preservedConfigs: changed.filter((x) => x.strategy === "preserve-config" || x.strategy === "preserve-old").length }, files };
}
