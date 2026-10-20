/**
 * Primitive predicates shared by local authoring and publication contracts.
 *
 * These checks are deliberately side-effect free so domain records, export
 * packages, and public manifests can use the same boundary rules.
 */

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const ISO_DATETIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u;
export const PROCESSED_JPEG_PATTERN = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u;

export function isUuid(value) {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/**
 * Accepts canonical UTC ISO-8601 datetimes used by the Stage 2 contracts and
 * rejects dates that Date.parse would otherwise normalize (for example,
 * February 30th).
 */
export function isIsoDateTime(value) {
  if (typeof value !== 'string' || !ISO_DATETIME_PATTERN.test(value)) return false;

  const [, year, month, day, hours, minutes, seconds, fraction = ''] = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/u,
  );
  const milliseconds = Number(fraction.padEnd(3, '0') || 0);
  const timestamp = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hours),
    Number(minutes),
    Number(seconds),
    milliseconds,
  );
  const date = new Date(timestamp);

  return !Number.isNaN(timestamp)
    && date.getUTCFullYear() === Number(year)
    && date.getUTCMonth() === Number(month) - 1
    && date.getUTCDate() === Number(day)
    && date.getUTCHours() === Number(hours)
    && date.getUTCMinutes() === Number(minutes)
    && date.getUTCSeconds() === Number(seconds)
    && date.getUTCMilliseconds() === milliseconds;
}

export function isSupportedDate(value) {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && !Number.isNaN(new Date(value).getTime());
  }
  return isIsoDateTime(value);
}

export function isProcessedJpeg(value) {
  return typeof value === 'string' && PROCESSED_JPEG_PATTERN.test(value);
}

export function isSafeObjectKey(value) {
  if (typeof value !== 'string' || value.length === 0 || value.startsWith('/') || value.includes('\\')) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
    && !/[\u0000-\u001f\u007f]/u.test(value);
}
