/**
 * Export utilities for generating CSV and other export formats from report data
 */

/**
 * Convert an array of objects to CSV format
 */
export function convertToCSV(data: any[], headers?: string[]): string {
  if (!data || data.length === 0) return '';

  // Use provided headers or extract from first object
  const columnHeaders = headers || Object.keys(data[0]);

  // Create CSV header row
  const headerRow = columnHeaders.map(escapeCSVValue).join(',');

  // Create CSV data rows
  const dataRows = data.map((row) => {
    return columnHeaders
      .map((header) => {
        const value = row[header];
        return escapeCSVValue(value);
      })
      .join(',');
  });

  return [headerRow, ...dataRows].join('\n');
}

/**
 * Escape CSV value (handle commas, quotes, newlines)
 */
function escapeCSVValue(value: any): string {
  if (value === null || value === undefined) return '';

  const stringValue = String(value);

  // If value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Download CSV file
 */
export function downloadCSV(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Download JSON file
 */
export function downloadJSON(data: any, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

/**
 * Format report metadata header for CSV export
 */
export function formatReportMetadataHeader(metadata: {
  reportType: string;
  startDate: string;
  endDate: string;
  timezone?: string;
  generatedAt?: string;
  filters?: any;
}): string {
  const lines: string[] = [
    `Report Type: ${metadata.reportType}`,
    `Period: ${metadata.startDate} to ${metadata.endDate}`,
  ];

  if (metadata.timezone) {
    lines.push(`Timezone: ${metadata.timezone}`);
  }

  if (metadata.generatedAt) {
    lines.push(`Generated At: ${metadata.generatedAt}`);
  }

  if (metadata.filters) {
    const filterEntries = Object.entries(metadata.filters)
      .filter(([_, value]) => value && (Array.isArray(value) ? value.length > 0 : true))
      .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`);

    if (filterEntries.length > 0) {
      lines.push('Filters:');
      lines.push(...filterEntries.map(f => `  ${f}`));
    }
  }

  lines.push(''); // Empty line separator
  return lines.join('\n');
}

/**
 * Generate filename for export with timestamp
 */
export function generateExportFilename(reportType: string, extension: 'csv' | 'json' | 'pdf'): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  return `${reportType}_report_${timestamp}.${extension}`;
}

/**
 * Flatten nested object for CSV export
 */
export function flattenObject(obj: any, prefix: string = ''): any {
  const flattened: any = {};

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      const newKey = prefix ? `${prefix}_${key}` : key;

      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(flattened, flattenObject(value, newKey));
      } else if (Array.isArray(value)) {
        flattened[newKey] = value.join('; ');
      } else {
        flattened[newKey] = value;
      }
    }
  }

  return flattened;
}

/**
 * Prepare data for CSV export by flattening nested structures
 */
export function prepareDataForCSV(data: any[]): any[] {
  return data.map(item => flattenObject(item));
}
