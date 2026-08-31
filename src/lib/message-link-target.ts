function decodeLocalPath(value: string): string {
  try {
    return decodeURIComponent(value.replace(/%2f/giu, "%252F").replace(/%5c/giu, "%255C"))
  } catch {
    return value
  }
}

const LINE_REFERENCE_SUFFIX = /:(\d+)(?::\d+)?$/u

export interface LocalFileLinkTarget {
  path: string
  line: number | null
}

/**
 * Agent messages frequently reference code as `path/to/file.ts:line[:column]`.
 * The suffix is not part of the file name, so strip it and expose the line —
 * but only when the base name carries an extension dot, keeping genuinely
 * colon-named files like `report:2024` intact.
 */
function splitLineReferenceSuffix(path: string): LocalFileLinkTarget {
  const match = LINE_REFERENCE_SUFFIX.exec(path)
  if (!match || match.index === 0) {
    return { line: null, path }
  }
  const base = path.slice(0, match.index)
  const separator = Math.max(base.lastIndexOf("/"), base.lastIndexOf("\\"))
  if (!base.slice(separator + 1).includes(".")) {
    return { line: null, path }
  }
  const line = Number.parseInt(match[1], 10)
  return { line: Number.isSafeInteger(line) && line > 0 ? line : null, path: base }
}

export function localFileTargetFromMessageLink(rawValue: string): LocalFileLinkTarget | null {
  const value = rawValue.trim()
  if (!value) {
    return null
  }
  if (/^file:/iu.test(value)) {
    try {
      const url = new URL(value)
      if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) {
        return null
      }
      const path = decodeLocalPath(url.pathname)
      return splitLineReferenceSuffix(/^\/[A-Za-z]:\//u.test(path) ? path.slice(1) : path)
    } catch {
      return null
    }
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(value) || value.startsWith("\\\\")) {
    return splitLineReferenceSuffix(decodeLocalPath(value))
  }
  return null
}

export function localFilePathFromMessageLink(rawValue: string): string | null {
  return localFileTargetFromMessageLink(rawValue)?.path ?? null
}
