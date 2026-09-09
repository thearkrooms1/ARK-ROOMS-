import React, { useState, useEffect, useRef } from 'react';
import { Calendar, ChevronLeft, ChevronRight, ChevronDown, X, Sparkles } from 'lucide-react';

interface DatePickerPopoverProps {
  label?: string;
  value: string; // ISO YYYY-MM-DD
  onChange: (dateStr: string) => void;
  minDate?: string; // ISO YYYY-MM-DD
  maxDate?: string; // ISO YYYY-MM-DD
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// Parse ISO YYYY-MM-DD to local Date object
function parseISO(dateStr: string): Date {
  if (!dateStr) return new Date();
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return new Date();
  return new Date(y, m - 1, d);
}

// Format local Date object to ISO YYYY-MM-DD
function toISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Format YYYY-MM-DD to "11 Aug 2026"
export function formatDateDisplay(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return dateStr;
  const dateObj = new Date(y, m - 1, d);
  const day = dateObj.getDate();
  const month = dateObj.toLocaleDateString('en-US', { month: 'short' });
  const year = dateObj.getFullYear();
  return `${day} ${month} ${year}`;
}

export const DatePickerPopover: React.FC<DatePickerPopoverProps> = ({
  label,
  value,
  onChange,
  minDate,
  maxDate,
  placeholder = 'Select date',
  disabled = false,
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Today ISO string
  const todayDate = new Date();
  const todayISO = toISO(todayDate);

  // Month/year view state
  const [viewDate, setViewDate] = useState<Date>(() => {
    if (value) return parseISO(value);
    if (minDate) return parseISO(minDate);
    return new Date();
  });

  // Position coordinates for desktop floating popover
  const [popoverCoords, setPopoverCoords] = useState<{ top: number; left: number }>({
    top: 0,
    left: 0,
  });

  // Sync viewDate when popover opens or value changes
  useEffect(() => {
    if (isOpen) {
      if (value) {
        setViewDate(parseISO(value));
      } else if (minDate) {
        setViewDate(parseISO(minDate));
      }
    }
  }, [isOpen, value, minDate]);

  // Calculate popover position when opened
  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const popoverWidth = 320;
      // Ensure left coordinate doesn't bleed off right edge of viewport
      let left = rect.left;
      if (left + popoverWidth > window.innerWidth - 16) {
        left = Math.max(16, window.innerWidth - popoverWidth - 16);
      }
      setPopoverCoords({
        top: rect.bottom + 6,
        left,
      });
    }
  }, [isOpen]);

  // Handle click outside & scroll/resize events
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleScrollOrResize = () => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const popoverWidth = 320;
        let left = rect.left;
        if (left + popoverWidth > window.innerWidth - 16) {
          left = Math.max(16, window.innerWidth - popoverWidth - 16);
        }
        setPopoverCoords({
          top: rect.bottom + 6,
          left,
        });
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [isOpen]);

  // Month navigation
  const prevMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1));
  };

  // Days calculations
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth(); // 0-indexed
  const monthName = viewDate.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  // First day of month (0 = Sun, 1 = Mon, ...)
  const firstDayOfWeek = new Date(year, month, 1).getDay();
  // Standard Mon=0 offset: (firstDayOfWeek + 6) % 7
  const startOffset = (firstDayOfWeek + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const daysArray: (number | null)[] = [];
  for (let i = 0; i < startOffset; i++) {
    daysArray.push(null);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    daysArray.push(day);
  }

  const handleSelectDay = (day: number) => {
    const selectedDate = new Date(year, month, day);
    const iso = toISO(selectedDate);
    onChange(iso);
    setIsOpen(false);
  };

  const isDayDisabled = (day: number): boolean => {
    const dayISO = toISO(new Date(year, month, day));
    if (dayISO < todayISO) return true; // Past dates disabled
    if (minDate && dayISO < minDate) return true; // Before min date disabled
    if (maxDate && dayISO > maxDate) return true;
    return false;
  };

  return (
    <div className={`relative ${className}`}>
      {label && (
        <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-1 flex items-center gap-1">
          <Calendar className="w-3.5 h-3.5 text-[#1E7A5E]" />
          {label}
        </label>
      )}

      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full text-left bg-slate-50 border ${
          isOpen ? 'border-[#1E7A5E] ring-2 ring-[#1E7A5E]/20 bg-emerald-50/20' : 'border-slate-300 hover:border-slate-400'
        } rounded-xl px-3 py-2.5 transition-all flex items-center justify-between gap-2 min-h-[50px] h-[50px] outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed`}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Calendar className="w-4 h-4 text-[#1E7A5E] shrink-0" />
          <div className="min-w-0 flex-1">
            {value ? (
              <span className="text-xs font-black text-[#0B1F3A] block truncate">
                {formatDateDisplay(value)}
              </span>
            ) : (
              <span className="text-xs font-semibold text-slate-400 block truncate">
                {placeholder}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
            isOpen ? 'rotate-180 text-[#1E7A5E]' : ''
          }`}
        />
      </button>

      {/* Floating Calendar Popover */}
      {isOpen && (
        <>
          {/* Mobile Overlay / Backdrop */}
          <div
            className="sm:hidden fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-[9998] animate-in fade-in"
            onClick={() => setIsOpen(false)}
          />
          {/* Calendar Box */}
          <div
            ref={popoverRef}
            style={{
              top: `${popoverCoords.top}px`,
              left: `${popoverCoords.left}px`,
            }}
            className="fixed z-[9999] w-[320px] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-2xl border border-slate-200 p-4 space-y-3 animate-in fade-in zoom-in-95 duration-150 sm:block max-sm:top-1/2! max-sm:left-1/2! max-sm:-translate-x-1/2! max-sm:-translate-y-1/2!"
          >
            {/* Calendar Header */}
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <button
                type="button"
                onClick={prevMonth}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                title="Previous Month"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <div className="text-xs font-black text-[#0B1F3A] flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-[#C89B3C]" />
                <span>{monthName}</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={nextMonth}
                  className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer"
                  title="Next Month"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 sm:hidden"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Days of Week Header */}
            <div className="grid grid-cols-7 gap-1 text-center">
              {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d) => (
                <span key={d} className="text-[10px] font-extrabold text-slate-400 uppercase py-1">
                  {d}
                </span>
              ))}
            </div>

            {/* Grid of Days */}
            <div className="grid grid-cols-7 gap-1">
              {daysArray.map((day, idx) => {
                if (day === null) {
                  return <div key={`empty-${idx}`} className="h-8 w-8" />;
                }
                const dayISO = toISO(new Date(year, month, day));
                const disabled = isDayDisabled(day);
                const isSelected = value === dayISO;
                const isToday = todayISO === dayISO;

                return (
                  <button
                    key={`day-${day}`}
                    type="button"
                    disabled={disabled}
                    onClick={() => handleSelectDay(day)}
                    className={`h-8 w-8 rounded-xl text-xs font-bold transition-all flex items-center justify-center relative cursor-pointer ${
                      isSelected
                        ? 'bg-[#1E7A5E] text-white shadow-md scale-105 ring-2 ring-[#1E7A5E]/30 font-black'
                        : disabled
                        ? 'text-slate-300 bg-slate-50 cursor-not-allowed line-through'
                        : isToday
                        ? 'bg-amber-50 text-[#0B1F3A] border border-[#C89B3C] font-black hover:bg-amber-100'
                        : 'text-slate-700 hover:bg-emerald-50 hover:text-[#1E7A5E]'
                    }`}
                  >
                    {day}
                    {isToday && !isSelected && (
                      <span className="w-1 h-1 bg-[#C89B3C] rounded-full absolute bottom-1" />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Quick Actions Footer */}
            <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
              <span className="text-[10px] text-slate-400 font-medium">
                {minDate ? `Min checkout: ${formatDateDisplay(minDate)}` : 'Select dates for stay'}
              </span>
              <button
                type="button"
                onClick={() => {
                  const target = minDate && minDate > todayISO ? minDate : todayISO;
                  onChange(target);
                  setIsOpen(false);
                }}
                className="font-bold text-[#1E7A5E] hover:underline cursor-pointer"
              >
                Today
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
