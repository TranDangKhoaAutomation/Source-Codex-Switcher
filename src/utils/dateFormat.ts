export type DateInput = Date | string | number;

function validDate(value: DateInput): Date | null {
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function part(value: number): string {
    return String(value).padStart(2, '0');
}

/** Vietnamese display order: day/month/year. */
export function formatViDate(value: DateInput): string {
    const date = validDate(value);
    if (!date) return '—';
    return `${part(date.getDate())}/${part(date.getMonth() + 1)}/${date.getFullYear()}`;
}

/** Vietnamese display order with local 24-hour time. */
export function formatViDateTime(value: DateInput, includeSeconds = false): string {
    const date = validDate(value);
    if (!date) return '—';
    const seconds = includeSeconds ? `:${part(date.getSeconds())}` : '';
    return `${formatViDate(date)} ${part(date.getHours())}:${part(date.getMinutes())}${seconds}`;
}

/** Compact date/time for tables and charts: dd/MM HH:mm. */
export function formatViShortDateTime(value: DateInput): string {
    const date = validDate(value);
    if (!date) return '—';
    return `${part(date.getDate())}/${part(date.getMonth() + 1)} ${part(date.getHours())}:${part(date.getMinutes())}`;
}

export function formatViDayMonth(value: DateInput): string {
    const date = validDate(value);
    if (!date) return '—';
    return `${part(date.getDate())}/${part(date.getMonth() + 1)}`;
}
