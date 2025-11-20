'use client';

import { useState, useEffect } from 'react';
import { format } from 'date-fns';
import {
  DatePreset,
  DateRange,
  getDateRangeFromPreset,
  getPresetLabel,
  getUserTimezone,
  COMMON_TIMEZONES,
  formatDateRange,
} from '@/lib/date-utils';

interface DateRangeSelectorProps {
  value: DateRange;
  timezone: string;
  onChange: (range: DateRange, timezone: string) => void;
  showTimezone?: boolean;
}

const DATE_PRESETS: DatePreset[] = [
  'today',
  'yesterday',
  'last7Days',
  'last30Days',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'last90Days',
  'quarterToDate',
  'yearToDate',
  'custom',
];

export default function DateRangeSelector({
  value,
  timezone,
  onChange,
  showTimezone = true,
}: DateRangeSelectorProps) {
  const [selectedPreset, setSelectedPreset] = useState<DatePreset>(value.preset);
  const [customStartDate, setCustomStartDate] = useState<string>(
    format(value.startDate, 'yyyy-MM-dd')
  );
  const [customEndDate, setCustomEndDate] = useState<string>(
    format(value.endDate, 'yyyy-MM-dd')
  );
  const [selectedTimezone, setSelectedTimezone] = useState<string>(timezone);

  // Initialize with user's timezone on mount
  useEffect(() => {
    if (!timezone) {
      const userTz = getUserTimezone();
      setSelectedTimezone(userTz);
      onChange(value, userTz);
    }
  }, []);

  const handlePresetChange = (preset: DatePreset) => {
    setSelectedPreset(preset);

    if (preset === 'custom') {
      return; // Wait for user to select custom dates
    }

    const range = getDateRangeFromPreset(preset);
    onChange(range, selectedTimezone);
  };

  const handleCustomDateChange = () => {
    if (selectedPreset === 'custom' && customStartDate && customEndDate) {
      const start = new Date(customStartDate);
      start.setHours(0, 0, 0, 0);

      const end = new Date(customEndDate);
      end.setHours(23, 59, 59, 999);

      const range: DateRange = {
        startDate: start,
        endDate: end,
        preset: 'custom',
      };
      onChange(range, selectedTimezone);
    }
  };

  const handleTimezoneChange = (newTimezone: string) => {
    setSelectedTimezone(newTimezone);
    onChange(value, newTimezone);
  };

  return (
    <div className="space-y-4">
      {/* Date Preset Selector */}
      <div>
        <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
          Date Range
        </label>
        <select
          value={selectedPreset}
          onChange={(e) => handlePresetChange(e.target.value as DatePreset)}
          className="w-full px-3 py-2 tech-border bg-white text-neutral-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
        >
          {DATE_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {getPresetLabel(preset)}
            </option>
          ))}
        </select>
      </div>

      {/* Custom Date Inputs */}
      {selectedPreset === 'custom' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
              Start Date
            </label>
            <input
              type="date"
              value={customStartDate}
              onChange={(e) => setCustomStartDate(e.target.value)}
              onBlur={handleCustomDateChange}
              className="w-full px-3 py-2 tech-border bg-white text-neutral-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
              End Date
            </label>
            <input
              type="date"
              value={customEndDate}
              onChange={(e) => setCustomEndDate(e.target.value)}
              onBlur={handleCustomDateChange}
              className="w-full px-3 py-2 tech-border bg-white text-neutral-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>
        </div>
      )}

      {/* Timezone Selector */}
      {showTimezone && (
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-500 mb-2">
            Timezone
          </label>
          <select
            value={selectedTimezone}
            onChange={(e) => handleTimezoneChange(e.target.value)}
            className="w-full px-3 py-2 tech-border bg-white text-neutral-900 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          >
            {COMMON_TIMEZONES.map((tz) => (
              <option key={tz.value} value={tz.value}>
                {tz.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Selected Range Display */}
      <div className="pt-2 tech-border-t">
        <div className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">Selected Range:</div>
        <div className="text-xs font-mono text-neutral-900">{formatDateRange(value)}</div>
        {showTimezone && (
          <div className="text-[10px] font-mono text-neutral-500 mt-1">{selectedTimezone}</div>
        )}
      </div>
    </div>
  );
}
