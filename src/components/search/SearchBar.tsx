import React, { useState } from 'react';
import { Search, MapPin, Calendar, Users } from 'lucide-react';

interface SearchBarProps {
  onSearch: (filters: { city: string; checkIn: string; checkOut: string; guests: number }) => void;
  initialCity?: string;
  initialCheckIn?: string;
  initialCheckOut?: string;
  initialGuests?: number | string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  initialCity = '',
  initialCheckIn = '',
  initialCheckOut = '',
  initialGuests = '1',
}) => {
  const [city, setCity] = useState(initialCity);
  const [checkIn, setCheckIn] = useState(initialCheckIn);
  const [checkOut, setCheckOut] = useState(initialCheckOut);
  const [guests, setGuests] = useState(String(initialGuests));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch({ city, checkIn, checkOut, guests: parseInt(guests, 10) || 1 });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-2xl p-3 sm:p-4 shadow-xl border border-slate-200/80 max-w-5xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-center"
    >
      {/* Location Input */}
      <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-[#C5A880]">
        <MapPin className="w-5 h-5 text-[#C5A880] shrink-0" />
        <div className="flex-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Destination</label>
          <input
            type="text"
            placeholder="e.g. Ikoyi, Victoria Island"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="w-full bg-transparent text-xs font-semibold text-slate-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Date Pickers */}
      <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-[#C5A880]">
        <Calendar className="w-5 h-5 text-[#C5A880] shrink-0" />
        <div className="flex-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Dates</label>
          <input
            type="date"
            value={checkIn}
            onChange={(e) => setCheckIn(e.target.value)}
            className="w-full bg-transparent text-xs font-semibold text-slate-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Guest Counter */}
      <div className="flex items-center gap-3 px-3 py-2 bg-slate-50 rounded-xl border border-slate-200 focus-within:border-[#C5A880]">
        <Users className="w-5 h-5 text-[#C5A880] shrink-0" />
        <div className="flex-1">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-500">Guests</label>
          <select
            value={guests}
            onChange={(e) => setGuests(e.target.value)}
            className="w-full bg-transparent text-xs font-semibold text-slate-900 focus:outline-none cursor-pointer"
          >
            <option value="1">1 Guest</option>
            <option value="2">2 Guests</option>
            <option value="4">4+ Guests</option>
          </select>
        </div>
      </div>

      {/* Submit Button */}
      <button
        type="submit"
        className="w-full h-full min-h-[48px] bg-[#0B1F3A] hover:bg-[#142d50] text-white rounded-xl font-semibold text-xs tracking-wider flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
      >
        <Search className="w-4 h-4 text-[#C5A880]" />
        Find Available Stays
      </button>
    </form>
  );
};
