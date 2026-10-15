// Paths inside a project, as LaTeX writes them.

/** `path`, a project path, as written from the project folder `folder` ("" for the project's own). */
export function relativeTo(folder: string, path: string): string {
  const from = folder.split("/").filter(Boolean);
  const to = path.split("/");
  let same = 0;
  while (same < from.length && same < to.length - 1 && from[same] === to[same]) same++;
  return [...Array(from.length - same).fill(".."), ...to.slice(same)].join("/");
}
