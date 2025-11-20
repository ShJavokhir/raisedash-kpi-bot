import { format, subDays, startOfWeek, endOfWeek, startOfMonth, endOfMonth, subMonths, subWeeks, startOfQuarter, startOfYear } from 'date-fns';

export type DatePreset =
  | 'today'
  | 'yesterday'
  | 'thisWeek'
  | 'lastWeek'
  | 'thisMonth'
  | 'lastMonth'
  | 'last7Days'
  | 'last30Days'
  | 'last90Days'
  | 'quarterToDate'
  | 'yearToDate'
  | 'custom';

export interface DateRange {
  startDate: Date;
  endDate: Date;
  preset: DatePreset;
}

/**
 * Get date range based on preset
 */
export function getDateRangeFromPreset(preset: DatePreset, customStart?: Date, customEnd?: Date): DateRange {
  const now = new Date();
  now.setHours(23, 59, 59, 999); // End of today

  switch (preset) {
    case 'today': {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'yesterday': {
      const yesterday = subDays(now, 1);
      const start = new Date(yesterday);
      start.setHours(0, 0, 0, 0);
      const end = new Date(yesterday);
      end.setHours(23, 59, 59, 999);
      return { startDate: start, endDate: end, preset };
    }

    case 'thisWeek': {
      const start = startOfWeek(now, { weekStartsOn: 1 }); // Monday
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'lastWeek': {
      const lastWeekEnd = endOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      const lastWeekStart = startOfWeek(subWeeks(now, 1), { weekStartsOn: 1 });
      lastWeekStart.setHours(0, 0, 0, 0);
      lastWeekEnd.setHours(23, 59, 59, 999);
      return { startDate: lastWeekStart, endDate: lastWeekEnd, preset };
    }

    case 'thisMonth': {
      const start = startOfMonth(now);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'lastMonth': {
      const lastMonthEnd = endOfMonth(subMonths(now, 1));
      const lastMonthStart = startOfMonth(subMonths(now, 1));
      lastMonthStart.setHours(0, 0, 0, 0);
      lastMonthEnd.setHours(23, 59, 59, 999);
      return { startDate: lastMonthStart, endDate: lastMonthEnd, preset };
    }

    case 'last7Days': {
      const start = subDays(now, 6); // 6 days ago + today = 7 days
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'last30Days': {
      const start = subDays(now, 29); // 29 days ago + today = 30 days
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'last90Days': {
      const start = subDays(now, 89); // 89 days ago + today = 90 days
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'quarterToDate': {
      const start = startOfQuarter(now);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'yearToDate': {
      const start = startOfYear(now);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset };
    }

    case 'custom': {
      if (!customStart || !customEnd) {
        // Default to last 30 days if custom dates not provided
        const start = subDays(now, 29);
        start.setHours(0, 0, 0, 0);
        return { startDate: start, endDate: now, preset };
      }
      return { startDate: customStart, endDate: customEnd, preset };
    }

    default:
      // Default to last 30 days
      const start = subDays(now, 29);
      start.setHours(0, 0, 0, 0);
      return { startDate: start, endDate: now, preset: 'last30Days' };
  }
}

/**
 * Format date range for display
 */
export function formatDateRange(range: DateRange): string {
  const { startDate, endDate } = range;
  const startFormatted = format(startDate, 'MMM d, yyyy');
  const endFormatted = format(endDate, 'MMM d, yyyy');

  if (startFormatted === endFormatted) {
    return startFormatted;
  }

  return `${startFormatted} - ${endFormatted}`;
}

/**
 * Get preset label for display
 */
export function getPresetLabel(preset: DatePreset): string {
  const labels: Record<DatePreset, string> = {
    today: 'Today',
    yesterday: 'Yesterday',
    thisWeek: 'This Week',
    lastWeek: 'Last Week',
    thisMonth: 'This Month',
    lastMonth: 'Last Month',
    last7Days: 'Last 7 Days',
    last30Days: 'Last 30 Days',
    last90Days: 'Last 90 Days',
    quarterToDate: 'Quarter to Date',
    yearToDate: 'Year to Date',
    custom: 'Custom Range',
  };
  return labels[preset];
}

/**
 * Convert Date to ISO 8601 string in UTC
 */
export function toISOString(date: Date): string {
  return date.toISOString();
}

/**
 * Get user's timezone
 */
export function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Common timezone options
 */
export const COMMON_TIMEZONES = [
  { value: 'UTC', label: 'UTC (Coordinated Universal Time)' },
  { value: 'America/New_York', label: 'EST (Eastern Standard Time)' },
  { value: 'America/Chicago', label: 'CST (Central Standard Time)' },
  { value: 'America/Denver', label: 'MST (Mountain Standard Time)' },
  { value: 'America/Los_Angeles', label: 'PST (Pacific Standard Time)' },
  { value: 'America/Anchorage', label: 'AKST (Alaska Standard Time)' },
  { value: 'Pacific/Honolulu', label: 'HST (Hawaii Standard Time)' },
  { value: 'Europe/London', label: 'GMT (Greenwich Mean Time)' },
  { value: 'Europe/Paris', label: 'CET (Central European Time)' },
  { value: 'Europe/Moscow', label: 'MSK (Moscow Standard Time)' },
  { value: 'Asia/Dubai', label: 'GST (Gulf Standard Time)' },
  { value: 'Asia/Kolkata', label: 'IST (India Standard Time)' },
  { value: 'Asia/Shanghai', label: 'CST (China Standard Time)' },
  { value: 'Asia/Tokyo', label: 'JST (Japan Standard Time)' },
  { value: 'Australia/Sydney', label: 'AEDT (Australian Eastern Daylight Time)' },
];

/**
 * Format seconds to human readable duration
 */
export function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0s';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);

  return parts.join(' ');
}

/**
 * Format minutes to human readable duration
 */
export function formatMinutesToDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes < 0) return '0m';

  const hours = Math.floor(minutes / 60);
  const mins = Math.floor(minutes % 60);

  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}
