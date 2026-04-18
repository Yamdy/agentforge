/**
 * Path manipulation utility functions
 */

/**
 * Join multiple path segments into a single path
 */
export function join(...segments: string[]): string {
  return segments
    .map((segment, index) => {
      if (index === 0) {
        return segment.endsWith('/') ? segment.slice(0, -1) : segment;
      }
      return segment.startsWith('/') ? segment.slice(1) : segment;
    })
    .filter(Boolean)
    .join('/');
}

/**
 * Get the file extension from a path
 */
export function extname(path: string): string {
  const lastDot = path.lastIndexOf('.');
  if (lastDot === -1 || lastDot === path.length - 1) {
    return '';
  }
  return path.slice(lastDot);
}

/**
 * Get the filename without extension
 */
export function basename(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  const filename = lastSlash === -1 ? path : path.slice(lastSlash + 1);
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1) {
    return filename;
  }
  return filename.slice(0, lastDot);
}

/**
 * Get the directory name from a path
 */
export function dirname(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  if (lastSlash === -1) {
    return '.';
  }
  return path.slice(0, lastSlash) || '/';
}
