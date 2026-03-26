import type { ReactNode } from "react";

/** Highlight a TOML value (string, number, boolean, array). */
function highlightValue(val: string): ReactNode {
  const trimmed = val.trim();
  // Quoted strings
  if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed))
    return <span className="text-amber-600 dark:text-amber-400">{val}</span>;
  // Booleans
  if (/^(true|false)$/i.test(trimmed))
    return <span className="text-sky-600 dark:text-sky-400">{val}</span>;
  // Numbers
  if (/^-?\d/.test(trimmed))
    return <span className="text-orange-600 dark:text-orange-400">{val}</span>;
  // Arrays / inline tables
  if (trimmed.startsWith("[") || trimmed.startsWith("{"))
    return <span className="text-teal-600 dark:text-teal-400">{val}</span>;
  return <>{val}</>;
}

/** Apply TOML syntax highlighting to a single line. Returns React nodes. */
export function highlightToml(line: string): ReactNode {
  if (!line) return line;

  // Comments
  if (/^\s*#/.test(line))
    return <span className="text-muted-foreground italic">{line}</span>;

  // Section headers: [section] or [[array]]
  if (/^\s*\[{1,2}[^\]]*]{1,2}\s*$/.test(line))
    return <span className="text-blue-500 dark:text-blue-400 font-semibold">{line}</span>;

  // Key = Value
  const kv = line.match(/^(\s*)([\w.\-]+)(\s*=\s*)(.*)/);
  if (kv) {
    return (
      <>
        {kv[1]}
        <span className="text-purple-600 dark:text-purple-400">{kv[2]}</span>
        <span className="text-muted-foreground">{kv[3]}</span>
        {highlightValue(kv[4])}
      </>
    );
  }

  return <>{line}</>;
}
