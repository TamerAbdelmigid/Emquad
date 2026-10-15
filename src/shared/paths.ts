// Paths inside a project, as LaTeX writes them.

/** `path`, a project path, as written from the project folder `folder` ("" for the project's own). */
export function relativeTo(folder: string, path: string): string {
  const from = folder.split("/").filter(Boolean);
  const to = path.split("/");
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  return [...Array(from.length - same).fill(".."), ...to.slice(same)].join("/");
}

/**
 * A path written in a file of the project folder `folder`, as a project path; null when it is
 * absolute or leads out of the project.
 */
export function resolveFrom(folder: string, written: string): string | null {
  if (/^([a-zA-Z]:)?[\\/]/.test(written)) return null;
  const parts = folder.split("/").filter(Boolean);
  for (const part of written.split(/[\\/]/)) {
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else if (part && part !== ".") parts.push(part);
  }
  return parts.join("/");
}
