import React, { createContext, useContext, useState, useEffect } from 'react';

export interface SearchContextState {
  venueId: string;
  venueName?: string;
  venueAddress?: string;
  venueCity?: string;
  checkIn: string;
  checkOut: string;
  guests: number;
  rooms?: number;
  searchRadiusKm?: number;
}

export interface SearchContextType {
  searchParams: SearchContextState;
  setSearchParams: (params: Partial<SearchContextState>) => void;
  resetSearch: () => void;
}

const SEARCH_STORAGE_KEY = 'ark_last_search_context';

export function saveSearchContext(context: Partial<SearchContextState>): void {
  try {
    if (!context || !context.venueId) return;
    const existing = getSavedSearchContext() || {};
    const updated = {
      ...existing,
      ...context,
    };
    sessionStorage.setItem(SEARCH_STORAGE_KEY, JSON.stringify(updated));
  } catch (e) {
    console.warn('Could not persist search context to sessionStorage:', e);
  }
}

export function getSavedSearchContext(): Partial<SearchContextState> | null {
  try {
    const raw = sessionStorage.getItem(SEARCH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return null;
  } catch (e) {
    console.warn('Could not read search context from sessionStorage:', e);
    return null;
  }
}

/**
 * Authoritative reset function for temporary accommodation search state.
 * Clears ONLY temporary accommodation search information without affecting
 * user authentication, profile, booking records, or logistics state.
 */
export function clearAccommodationSearchState(): void {
  try {
    sessionStorage.removeItem(SEARCH_STORAGE_KEY);
    sessionStorage.removeItem('ark_pending_booking_state');
    sessionStorage.removeItem('ark_last_payment_booking');
    localStorage.removeItem(SEARCH_STORAGE_KEY);
    localStorage.removeItem('ark_pending_booking_state');
    localStorage.removeItem('ark_last_payment_booking');
  } catch (e) {
    console.warn('Could not clear accommodation search state from storage:', e);
  }
}

// Alias for backwards compatibility
export const clearSearchContext = clearAccommodationSearchState;

export function buildSearchUrl(context: {
  venueId?: string;
  venueName?: string;
  checkIn?: string;
  checkOut?: string;
  guests?: number | string;
  rooms?: number | string;
  searchRadiusKm?: number | string;
}): string {
  const vId = context.venueId || '';
  const cIn = context.checkIn || '';
  const cOut = context.checkOut || '';
  const g = context.guests || 1;
  const r = context.rooms;

  const params = new URLSearchParams();
  if (vId) {
    params.set('venue', vId);
    params.set('venueId', vId);
  }
  if (context.venueName) {
    params.set('venueName', context.venueName);
  }
  if (cIn) params.set('checkIn', cIn);
  if (cOut) params.set('checkOut', cOut);
  if (g && Number(g) > 1) params.set('guests', String(g));
  if (r && Number(r) > 1) params.set('rooms', String(r));
  if (context.searchRadiusKm) params.set('radius', String(context.searchRadiusKm));

  const qs = params.toString();
  return qs ? `/search?${qs}` : '/search';
}

const defaultState: SearchContextState = {
  venueId: '',
  checkIn: new Date().toISOString().split('T')[0],
  checkOut: new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0],
  guests: 1,
  rooms: 1,
  searchRadiusKm: 15,
};

const SearchReactContext = createContext<SearchContextType>({
  searchParams: defaultState,
  setSearchParams: () => {},
  resetSearch: () => {},
});

export const SearchProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [searchParams, setSearchState] = useState<SearchContextState>(() => {
    const saved = getSavedSearchContext();
    return saved ? { ...defaultState, ...saved } : defaultState;
  });

  const setSearchParams = (params: Partial<SearchContextState>) => {
    setSearchState((prev) => {
      const next = { ...prev, ...params };
      saveSearchContext(next);
      return next;
    });
  };

  const resetSearch = () => {
    clearAccommodationSearchState();
    setSearchState(defaultState);
  };

  return (
    <SearchReactContext.Provider value={{ searchParams, setSearchParams, resetSearch }}>
      {children}
    </SearchReactContext.Provider>
  );
};

export const useSearch = () => useContext(SearchReactContext);
