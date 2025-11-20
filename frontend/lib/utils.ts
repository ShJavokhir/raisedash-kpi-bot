import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merge className strings with tailwind-merge to handle conflicts
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a date string to a human-readable format
 */
export function formatDate(dateString: string | null): string {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    return new Intl.DateTimeFormat('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  } catch (e) {
    return dateString;
  }
}

/**
 * Format a date string to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string | null): string {
  if (!dateString) return 'N/A';

  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffSec < 60) return 'just now';
    if (diffMin < 60) return `${diffMin} minute${diffMin !== 1 ? 's' : ''} ago`;
    if (diffHour < 24) return `${diffHour} hour${diffHour !== 1 ? 's' : ''} ago`;
    if (diffDay < 7) return `${diffDay} day${diffDay !== 1 ? 's' : ''} ago`;

    return formatDate(dateString);
  } catch (e) {
    return dateString;
  }
}

/**
 * Calculate duration between two dates in human-readable format
 */
export function calculateDuration(startDate: string | null, endDate: string | null): string {
  if (!startDate || !endDate) return 'N/A';

  try {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = end.getTime() - start.getTime();
    const diffSec = Math.floor(diffMs / 1000);
    const diffMin = Math.floor(diffSec / 60);
    const diffHour = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHour / 24);

    if (diffDay > 0) return `${diffDay}d ${diffHour % 24}h`;
    if (diffHour > 0) return `${diffHour}h ${diffMin % 60}m`;
    if (diffMin > 0) return `${diffMin}m`;
    return `${diffSec}s`;
  } catch (e) {
    return 'N/A';
  }
}

/**
 * Format incident status to human-readable text
 */
export function formatIncidentStatus(status: string): string {
  const statusMap: Record<string, string> = {
    'Awaiting_Department': 'Awaiting Department',
    'Awaiting_Claim': 'Awaiting Claim',
    'In_Progress': 'In Progress',
    'Awaiting_Summary': 'Awaiting Summary',
    'Resolved': 'Resolved',
    'Closed': 'Closed',
  };

  return statusMap[status] || status;
}

/**
 * Get status badge color
 */
export function getStatusColor(status: string): string {
  const colorMap: Record<string, string> = {
    'Awaiting_Department': 'bg-yellow-100 text-yellow-800',
    'Awaiting_Claim': 'bg-orange-100 text-orange-800',
    'In_Progress': 'bg-blue-100 text-blue-800',
    'Awaiting_Summary': 'bg-purple-100 text-purple-800',
    'Resolved': 'bg-green-100 text-green-800',
    'Closed': 'bg-gray-100 text-gray-800',
  };

  return colorMap[status] || 'bg-gray-100 text-gray-800';
}

/**
 * Truncate text to a maximum length
 */
export function truncate(text: string, maxLength: number = 50): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

/**
 * Generate a secure random access key
 */
export function generateAccessKey(length: number = 32): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  const randomValues = new Uint8Array(length);
  crypto.getRandomValues(randomValues);

  for (let i = 0; i < length; i++) {
    result += chars[randomValues[i] % chars.length];
  }

  return result;
}
