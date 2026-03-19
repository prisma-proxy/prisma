import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile } from "@tauri-apps/plugin-fs";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Save a JSON-serializable value via native "Save As" dialog. */
export async function downloadJson(data: unknown, filename: string): Promise<void> {
  const path = await save({
    defaultPath: filename,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (!path) return; // user cancelled
  await writeTextFile(path, JSON.stringify(data, null, 2));
}

/** Save a text string via native "Save As" dialog. */
export async function downloadText(text: string, filename: string): Promise<void> {
  const ext = filename.split(".").pop() ?? "txt";
  const path = await save({
    defaultPath: filename,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return;
  await writeTextFile(path, text);
}

/** Open a file picker for .json files and return the parsed content. */
export async function pickJsonFile(): Promise<unknown> {
  const selected = await open({
    filters: [{ name: "JSON", extensions: ["json"] }],
    multiple: false,
  });
  if (!selected) throw new Error("No file selected");
  const text = await readTextFile(selected);
  return JSON.parse(text);
}
