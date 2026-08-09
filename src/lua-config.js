import luaparse from "luaparse/luaparse.js";

const isNode = (value) => value && typeof value === "object" && typeof value.type === "string";
const nodes = (value) => Array.isArray(value) ? value.filter(isNode) : [];
const rangeOf = (node) => {
  if (!Array.isArray(node.range) || node.range.length !== 2) throw new Error(`Node ${node.type} has no range`);
  return node.range;
};
const identifier = (node) => isNode(node) && node.type === "Identifier" && typeof node.name === "string" ? node.name : undefined;

function keyName(node, source) {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier") return identifier(node);
  if (node.type === "NumericLiteral") return String(node.value);
  if (node.type === "StringLiteral") return typeof node.value === "string" ? node.value : `raw:${source.slice(...rangeOf(node))}`;
}

function configPath(node, source) {
  if (!isNode(node)) return undefined;
  if (node.type === "Identifier") return [node.name];
  if (node.type === "MemberExpression") { const base = configPath(node.base, source); const name = identifier(node.identifier); return base && name ? [...base, name] : undefined; }
  if (node.type === "IndexExpression") { const base = configPath(node.base, source); const key = keyName(node.index, source); return base && key !== undefined ? [...base, key] : undefined; }
}

function indexValue(entries, path, value, source) {
  entries.set(path.join("\0"), { path, value, range: rangeOf(value) });
  if (value.type !== "TableConstructorExpression" || !Array.isArray(value.fields)) return;
  let position = 0;
  for (const field of value.fields) {
    const key = field.type === "TableValue" ? String(++position) : keyName(field.key, source);
    if (key !== undefined && isNode(field.value)) indexValue(entries, [...path, key], field.value, source);
  }
}

function walk(statements, visit) {
  for (const statement of statements) {
    visit(statement); walk(nodes(statement.body), visit);
    for (const clause of nodes(statement.clauses)) walk(nodes(clause.body), visit);
  }
}

export function parseConfig(source) {
  const parseableSource = source.replace(/`([^`\r\n]*)`/g, (_match, value) => `"${" ".repeat(value.length)}"`);
  const chunk = luaparse.parse(parseableSource, { luaVersion: "LuaJIT", comments: false, ranges: true });
  const entries = new Map();
  walk(nodes(chunk.body), (statement) => {
    if (statement.type !== "AssignmentStatement") return;
    const variables = nodes(statement.variables); const values = nodes(statement.init);
    variables.forEach((variable, index) => { const path = configPath(variable, source); const value = values[index]; if (path?.length && value) indexValue(entries, path, value, source); });
  });
  return { source, entries };
}

export function hasConfigAssignments(source) {
  try { return parseConfig(source).entries.size > 0; } catch { return false; }
}

export function mergeLuaConfig(oldSource, newSource) {
  const oldConfig = parseConfig(oldSource); const newConfig = parseConfig(newSource); const replacements = [];
  for (const [path, next] of newConfig.entries) {
    if (replacements.some((item) => next.range[0] >= item.start && next.range[1] <= item.end)) continue;
    const previous = oldConfig.entries.get(path); if (!previous) continue;
    const oldTable = previous.value.type === "TableConstructorExpression"; const newTable = next.value.type === "TableConstructorExpression";
    if (oldTable && newTable) continue;
    replacements.push({ start: next.range[0], end: next.range[1], text: oldSource.slice(previous.range[0], previous.range[1]) });
  }
  replacements.sort((a, b) => b.start - a.start);
  return replacements.reduce((result, item) => result.slice(0, item.start) + item.text + result.slice(item.end), newSource);
}
