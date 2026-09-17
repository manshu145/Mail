import { createReadStream } from "node:fs";

export async function* iterateCsvFileRows(path: string): AsyncGenerator<string[]> {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 256 * 1024 });
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let pendingQuote = false;
  let pendingCR = false;

  const emitRow = () => {
    row.push(cell);
    cell = "";
    const output = row;
    row = [];
    return output.some((value) => value.length) ? output : null;
  };

  for await (const chunkValue of stream) {
    const chunk = String(chunkValue);
    for (let i = 0; i < chunk.length; i++) {
      const char = chunk[i];

      if (pendingCR) {
        pendingCR = false;
        if (char === "\n") continue;
      }

      if (pendingQuote) {
        pendingQuote = false;
        if (char === '"') { cell += '"'; continue; }
        quoted = false;
      }

      if (char === '"') {
        if (quoted) {
          if (i + 1 < chunk.length) {
            if (chunk[i + 1] === '"') { cell += '"'; i++; }
            else quoted = false;
          } else pendingQuote = true;
        } else quoted = true;
        continue;
      }

      if (char === "," && !quoted) {
        row.push(cell);
        cell = "";
        continue;
      }

      if ((char === "\n" || char === "\r") && !quoted) {
        const output = emitRow();
        if (char === "\r" && i + 1 >= chunk.length) pendingCR = true;
        else if (char === "\r" && chunk[i + 1] === "\n") i++;
        if (output) yield output;
        continue;
      }

      cell += char;
    }
  }

  if (pendingQuote) quoted = false;
  if (cell.length || row.length) {
    const output = emitRow();
    if (output) yield output;
  }
}
