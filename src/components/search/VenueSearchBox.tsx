import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getVenues } from '../../lib/supabase';
import { Venue } from '../../types/database';
import { DatePickerPopover, formatDateDisplay } from '../ui/DatePickerPopover';
import { saveSearchContext, getSavedSearchContext } from '../../lib/searchContext';
import {
  MapPin,
  Users,
  Search,
  Building2,
  ChevronDown,
  X,
  AlertCircle,
  Check,
  Sparkles,
} from 'lucide-react';

interface VenueSearchBoxProps {
  initialVenueId?: string;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number;
  compact?: boolean;
}

// Helper to get next day YYYY-MM-DD string
function getNextDayStr(dateStr: string): string {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return '';
  const dateObj = new Date(y, m - 1, d);
  dateObj.setDate(dateObj.getDate() + 1);
  const yOut = dateObj.getFullYear();
  const mOut = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dOut = String(dateObj.getDate()).padStart(2, '0');
  return `${yOut}-${mOut}-${dOut}`;
}

export const VenueSearchBox: React.FC<VenueSearchBoxProps> = ({
  initialVenueId = '',
  initialCheckIn = '',
  initialCheckOut = '',
  initialGuests = 1,
}) => {
  const navigate = useNavigate();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState(initialVenueId);

  // Today ISO string
  const todayObj = new Date();
  const todayStr = `${todayObj.getFullYear()}-${String(todayObj.getMonth() + 1).padStart(2, '0')}-${String(todayObj.getDate()).padStart(2, '0')}`;

  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(initialGuests || 1);
  const [loading, setLoading] = useState(true);

  // Sync state if props change from parent
  useEffect(() => {
    setSelectedVenueId(initialVenueId || '');
  }, [initialVenueId]);

  useEffect(() => {
    setCheckIn(initialCheckIn || '');
  }, [initialCheckIn]);

  useEffect(() => {
    setCheckOut(initialCheckOut || '');
  }, [initialCheckOut]);

  useEffect(() => {
    setGuests(initialGuests || 1);
  }, [initialGuests]);

  // Venue dropdown UI states
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [venueSearchTerm, setVenueSearchTerm] = useState('');
  const [validationError, setValidationError] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let isMounted = true;
    getVenues().then((data) => {
      if (isMounted) {
        // Filter active status = true and prioritize Abuja venues first
        const activeVenues = data.filter((v: any) => v.status !== false);
        const sorted = [...activeVenues].sort((a, b) => {
          const aAbuja =
            (a.city || '').toLowerCase().includes('abuja') ||
            (a.state || '').toLowerCase().includes('fct');
          const bAbuja =
            (b.city || '').toLowerCase().includes('abuja') ||
            (b.state || '').toLowerCase().includes('fct');
          if (aAbuja && !bAbuja) return -1;
          if (!aAbuja && bAbuja) return 1;
          return (a.name || '').localeCompare(b.name || '');
        });
        setVenues(sorted);
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  // Handle click outside venue dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Focus search input when venue dropdown opens
  useEffect(() => {
    if (isDropdownOpen && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isDropdownOpen]);

  // Date handlers
  const handleCheckInChange = (newDateStr: string) => {
    setCheckIn(newDateStr);
    setValidationError('');
    // Automatically set check-out to day after check-in if checkOut <= newDateStr
    if (!checkOut || checkOut <= newDateStr) {
      setCheckOut(getNextDayStr(newDateStr));
    }
  };

  const handleCheckOutChange = (newDateStr: string) => {
    if (checkIn && newDateStr <= checkIn) {
      setValidationError('Check-out must be after check-in.');
      setCheckOut(getNextDayStr(checkIn));
    } else {
      setValidationError('');
      setCheckOut(newDateStr);
    }
  };

  const selectedVenueObj = venues.find((v) => v.id === selectedVenueId);

  // Filtered venues matching user search term
  const filteredVenues = venues.filter((v) => {
    if (!venueSearchTerm.trim()) return true;
    const term = venueSearchTerm.toLowerCase();
    return (
      v.name.toLowerCase().includes(term) ||
      (v.city && v.city.toLowerCase().includes(term)) ||
      (v.category && v.category.toLowerCase().includes(term)) ||
      (v.state && v.state.toLowerCase().includes(term))
    );
  });

  const minCheckOutDate = checkIn ? getNextDayStr(checkIn) : getNextDayStr(todayStr);

  const isFormValid = Boolean(
    selectedVenueId && checkIn && checkOut && checkOut > checkIn && guests > 0
  );

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedVenueId) {
      setValidationError('Please select an event venue to search stays.');
      setIsDropdownOpen(true);
      return;
    }
    if (!checkIn) {
      setValidationError('Please select a check-in date.');
      return;
    }
    if (!checkOut || checkOut <= checkIn) {
      setValidationError('Check-out must be after check-in.');
      return;
    }

    setValidationError('');

    saveSearchContext({
      venueId: selectedVenueId,
      venueName: selectedVenueObj?.name,
      venueAddress: selectedVenueObj?.address,
      venueCity: selectedVenueObj?.city,
      checkIn,
      checkOut,
      guests,
    });

    const params = new URLSearchParams();
    params.set('venue', selectedVenueId);
    params.set('venueId', selectedVenueId);
    if (selectedVenueObj?.name) params.set('venueName', selectedVenueObj.name);
    if (selectedVenueObj?.latitude) params.set('lat', selectedVenueObj.latitude.toString());
    if (selectedVenueObj?.longitude) params.set('lng', selectedVenueObj.longitude.toString());
    params.set('checkIn', checkIn);
    params.set('checkOut', checkOut);
    params.set('guests', guests.toString());

    navigate(`/search?${params.toString()}`);
  };

  return (
    <div className="w-full bg-white rounded-2xl p-4 sm:p-6 shadow-2xl border border-slate-200/90 text-slate-800 relative z-30">
      {/* Supporting Banner & Section Badge */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#1E7A5E] animate-pulse"></span>
          <span className="text-xs font-bold uppercase tracking-wider text-[#0B1F3A]">
            Event Venue First
          </span>
          <span className="text-slate-300">•</span>
          <span className="text-xs text-slate-500 font-medium">
            Find stays close to where your event is happening.
          </span>
        </div>
        {selectedVenueObj && (
          <div className="text-[11px] font-semibold text-[#1E7A5E] bg-emerald-50 px-2.5 py-0.5 rounded-full border border-emerald-200/60 flex items-center gap-1 w-fit">
            <Sparkles className="w-3 h-3 text-[#C89B3C]" />
            <span>Venue Selected</span>
          </div>
        )}
      </div>

      {validationError && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-semibold flex items-center gap-2 animate-fadeIn">
          <AlertCircle className="w-4 h-4 text-[#C89B3C] shrink-0" />
          <span>{validationError}</span>
        </div>
      )}

      <form
        onSubmit={handleSearch}
        className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-[minmax(280px,2.2fr)_minmax(145px,1.1fr)_minmax(145px,1.1fr)_minmax(110px,0.75fr)_minmax(160px,auto)] gap-3 items-end"
      >
        {/* 1. EVENT VENUE (Full row on tablet/medium screen, dedicated wide column on desktop >=1200px) */}
        <div className="w-full md:col-span-4 xl:col-span-1 space-y-1 relative z-40" ref={dropdownRef}>
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center justify-between">
            <span className="flex items-center gap-1 text-[#0B1F3A]">
              <Building2 className="w-3.5 h-3.5 text-[#1E7A5E]" />
              Event Venue
            </span>
            <span className="text-[10px] text-slate-400 font-normal normal-case hidden sm:inline">
              Search or select the event you're attending
            </span>
          </label>

          {/* Combobox Trigger */}
          <button
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className={`w-full text-left bg-slate-50 border ${
              selectedVenueId
                ? 'border-[#1E7A5E] bg-emerald-50/20'
                : 'border-slate-300 hover:border-slate-400'
            } rounded-xl px-3.5 py-2.5 transition-all flex items-center justify-between gap-2 outline-none focus:ring-2 focus:ring-[#1E7A5E] min-h-[50px] h-[50px] cursor-pointer`}
          >
            <div className="flex items-center gap-2.5 min-w-0 flex-1">
              <MapPin className="w-4 h-4 text-[#1E7A5E] shrink-0" />
              <div className="min-w-0 flex-1">
                {selectedVenueObj ? (
                  <>
                    <span className="text-xs font-extrabold text-[#0B1F3A] block truncate">
                      {selectedVenueObj.name}
                    </span>
                    <span className="text-[10px] text-slate-500 font-medium block truncate">
                      {selectedVenueObj.category || 'Event Grounds'} • {selectedVenueObj.city}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="text-xs font-semibold text-slate-400 block truncate">
                      Select your event venue
                    </span>
                    <span className="text-[10px] text-slate-400 block truncate">
                      Abuja summit venues & convention halls
                    </span>
                  </>
                )}
              </div>
            </div>
            <ChevronDown
              className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${
                isDropdownOpen ? 'rotate-180 text-[#1E7A5E]' : ''
              }`}
            />
          </button>

          {/* Searchable Dropdown Panel */}
          {isDropdownOpen && (
            <div className="absolute top-full mt-2 left-0 w-full min-w-full sm:min-w-[340px] md:min-w-[420px] max-w-lg z-[100] bg-white border border-slate-200 rounded-2xl shadow-2xl p-3 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
              <div className="relative">
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Type to filter venue (e.g. Tinubu, Meeting Point, ICC)..."
                  value={venueSearchTerm}
                  onChange={(e) => setVenueSearchTerm(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2 pl-9 text-xs font-semibold text-slate-900 focus:ring-2 focus:ring-[#1E7A5E] outline-none"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                {venueSearchTerm && (
                  <button
                    type="button"
                    onClick={() => setVenueSearchTerm('')}
                    className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Venue Options List */}
              <div className="max-h-64 sm:max-h-72 overflow-y-auto divide-y divide-slate-100 rounded-xl border border-slate-100">
                {loading ? (
                  <div className="p-4 text-center text-xs text-slate-400 space-y-1">
                    <div className="w-4 h-4 border-2 border-[#1E7A5E] border-t-transparent rounded-full animate-spin mx-auto"></div>
                    <span>Loading venues...</span>
                  </div>
                ) : filteredVenues.length === 0 ? (
                  <div className="p-4 text-center text-xs text-slate-500">
                    No event venues match "{venueSearchTerm}".
                  </div>
                ) : (
                  filteredVenues.map((v) => {
                    const isSelected = v.id === selectedVenueId;
                    const isAbuja =
                      (v.city || '').toLowerCase().includes('abuja') ||
                      (v.state || '').toLowerCase().includes('fct');

                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          setSelectedVenueId(v.id);
                          setIsDropdownOpen(false);
                          setVenueSearchTerm('');
                          setValidationError('');
                        }}
                        className={`w-full text-left p-3 hover:bg-slate-50 transition-colors flex items-center justify-between gap-3 ${
                          isSelected ? 'bg-emerald-50/60 font-bold' : ''
                        }`}
                      >
                        <div className="space-y-0.5 min-w-0 flex-1">
                          <div className="text-xs font-bold text-[#0B1F3A] flex items-center gap-1.5 truncate">
                            <span className="truncate">{v.name}</span>
                            {isAbuja && (
                              <span className="text-[9px] font-bold text-[#1E7A5E] bg-emerald-100/80 px-1.5 py-0.2 rounded border border-emerald-200 shrink-0">
                                Abuja
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-500 font-medium truncate">
                            {v.category || 'Convention Centre'} • {v.city}
                          </div>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-[#1E7A5E] shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* 2. CHECK-IN */}
        <div className="w-full md:col-span-1 xl:col-span-1 space-y-1">
          <DatePickerPopover
            label="Check-In"
            value={checkIn}
            onChange={handleCheckInChange}
            minDate={todayStr}
            placeholder="Select check-in"
          />
        </div>

        {/* 3. CHECK-OUT */}
        <div className="w-full md:col-span-1 xl:col-span-1 space-y-1">
          <DatePickerPopover
            label="Check-Out"
            value={checkOut}
            onChange={handleCheckOutChange}
            minDate={minCheckOutDate}
            placeholder="Select check-out"
          />
        </div>

        {/* 4. GUESTS */}
        <div className="w-full md:col-span-1 xl:col-span-1 space-y-1">
          <label className="block text-[10px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1">
            <Users className="w-3.5 h-3.5 text-[#1E7A5E]" />
            Guests
          </label>
          <div className="relative">
            <select
              value={guests}
              onChange={(e) => {
                setGuests(Number(e.target.value));
                setValidationError('');
              }}
              className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2.5 text-xs font-extrabold text-[#0B1F3A] focus:ring-2 focus:ring-[#1E7A5E] outline-none cursor-pointer min-h-[50px] h-[50px] appearance-none pr-8"
            >
              <option value={1}>1 Guest</option>
              <option value={2}>2 Guests</option>
              <option value={3}>3 Guests</option>
              <option value={4}>4 Guests</option>
              <option value={5}>5 Guests</option>
              <option value={6}>6+ Guests</option>
            </select>
            <ChevronDown className="w-4 h-4 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>
        </div>

        {/* 5. SEARCH STAYS BUTTON */}
        <div className="w-full md:col-span-1 xl:col-span-1 flex flex-col justify-end">
          <button
            type="submit"
            className={`w-full py-3 px-4 rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 min-h-[50px] h-[50px] shadow-lg whitespace-nowrap ${
              isFormValid
                ? 'bg-[#C89B3C] hover:bg-[#b88c2e] text-slate-950 hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                : 'bg-slate-200 text-slate-500 cursor-pointer hover:bg-slate-300'
            }`}
          >
            <Search className="w-4 h-4 stroke-[2.5] shrink-0" />
            <span>SEARCH STAYS</span>
          </button>
        </div>
      </form>
    </div>
  );
};
