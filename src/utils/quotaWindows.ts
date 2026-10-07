const ONE_DAY_SECONDS = 24 * 60 * 60;

export interface QuotaWindowSource {
    five_hour_left: number;
    five_hour_reset?: string;
    five_hour_reset_at?: number | null;
    primary_window_seconds?: number | null;
    weekly_left: number;
    weekly_reset?: string;
    weekly_reset_at?: number | null;
    secondary_window_seconds?: number | null;
}

/**
 * Normalize the upstream window shape for display. Some plans expose only one
 * seven-day primary window instead of the usual 5-hour + weekly pair.
 */
export function quotaWindowView(source: QuotaWindowSource | null | undefined) {
    if (!source) {
        return {
            hasFiveHour: false,
            hasWeekly: false,
            weeklyOnly: false,
            fiveHourLeft: 0,
            fiveHourReset: '',
            fiveHourResetAt: undefined,
            weeklyLeft: 0,
            weeklyReset: '',
            weeklyResetAt: undefined,
        };
    }

    const primarySeconds = source.primary_window_seconds;
    const secondarySeconds = source.secondary_window_seconds;
    const primaryIsWeekly = typeof primarySeconds === 'number' && primarySeconds >= ONE_DAY_SECONDS;
    const hasPrimary = primarySeconds !== null && primarySeconds !== undefined;
    const hasSecondary = secondarySeconds !== null && secondarySeconds !== undefined;
    const hasFiveHour = hasPrimary && !primaryIsWeekly;
    const hasWeekly = hasSecondary || primaryIsWeekly;

    return {
        hasFiveHour,
        hasWeekly,
        weeklyOnly: !hasFiveHour && hasWeekly,
        fiveHourLeft: source.five_hour_left,
        fiveHourReset: source.five_hour_reset ?? '',
        fiveHourResetAt: source.five_hour_reset_at ?? undefined,
        weeklyLeft: primaryIsWeekly ? source.five_hour_left : source.weekly_left,
        weeklyReset: primaryIsWeekly ? (source.five_hour_reset ?? '') : (source.weekly_reset ?? ''),
        weeklyResetAt: primaryIsWeekly
            ? (source.five_hour_reset_at ?? undefined)
            : (source.weekly_reset_at ?? undefined),
    };
}
