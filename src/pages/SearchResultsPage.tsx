import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { VenueSearchBox } from '../components/search/VenueSearchBox';
import { SearchDiagnosticPanel } from '../components/search/SearchDiagnosticPanel';
import { searchPropertiesDiagnostics, SearchDiagnosticData } from '../lib/supabase';
import { useSearch } from '../lib/searchContext';
import { Property, Venue } from '../types/database';
import { formatNaira } from '../lib/paystack';
import {
  MapPin,
  Star,
  Building2,
  Calendar,
  Users,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ArrowRight,
  Filter,
  SlidersHorizontal,
  Loader2,
} from 'lucide-react';

export const SearchResultsPage: React.FC = () => {
  const [urlParams] = useSearchParams();
  const { searchParams, setSearchParams } = useSearch();

  const [properties, setProperties] = useState<Property[]>([]);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [diagnostics, setDiagnostics] = useState<SearchDiagnosticData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  // Filter states
  const [propertyTypeFilter, setPropertyTypeFilter] = useState<string>('all');
  const [maxPriceFilter, setMaxPriceFilter] = useState<number>(500000);

  // Hydrate searchParams from URL query params if present
  useEffect(() => {
    const qVenueId = urlParams.get('venueId');
    const qCheckIn = urlParams.get('checkIn');
    const qCheckOut = urlParams.get('checkOut');
    const qGuests = urlParams.get('guests');

    if (qVenueId || qCheckIn || qCheckOut || qGuests) {
      setSearchParams({
        venueId: qVenueId || searchParams.venueId,
        checkIn: qCheckIn || searchParams.checkIn,
        checkOut: qCheckOut || searchParams.checkOut,
        guests: qGuests ? Number(qGuests) : searchParams.guests,
      });
    }
  }, [urlParams]);

  // Execute database search whenever search context parameters change
  useEffect(() => {
    let isMounted = true;
    setLoading(true);
    setError(null);

    searchPropertiesDiagnostics({
      venueId: searchParams.venueId,
      checkIn: searchParams.checkIn,
      checkOut: searchParams.checkOut,
      guests: searchParams.guests,
      searchRadiusKm: searchParams.searchRadiusKm,
    })
      .then((res) => {
        if (isMounted) {
          setProperties(res.properties);
          setVenue(res.venue);
          setDiagnostics(res.diagnostics);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Search query failed:', err);
        if (isMounted) {
          setError(err.message || 'Failed to search properties near venue.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [searchParams]);

  // Filter application
  const filteredProperties = properties.filter((p) => {
    if (propertyTypeFilter !== 'all') {
      const type = (p.property_type || 'hotel').toLowerCase();
      if (type !== propertyTypeFilter.toLowerCase()) return false;
    }
    if (p.min_price && p.min_price > maxPriceFilter) {
      return false;
    }
    return true;
  });

  return (
    <CustomerLayout>
      {/* Search Header Banner */}
      <section className="bg-[#101D1E] text-white py-10 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6">
            <span className="text-xs font-bold uppercase tracking-widest text-[#C89B3C]">
              Proximity Search Results
            </span>
            <h1 className="text-2xl sm:text-4xl font-serif font-black tracking-tight text-white mt-1">
              Accommodations Near {venue ? venue.name : 'Event Venue'}
            </h1>
            {venue && (
              <p className="text-xs sm:text-sm text-slate-300 flex items-center gap-1.5 mt-1.5">
                <MapPin className="w-4 h-4 text-[#C89B3C] shrink-0" />
                {venue.address || venue.city}, Nigeria • Radius:{' '}
                <span className="text-emerald-400 font-bold">{searchParams.searchRadiusKm} km</span>
              </p>
            )}
          </div>

          <div className="max-w-5xl">
            <VenueSearchBox compact />
          </div>
        </div>
      </section>

      {/* Main Results Layout */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 flex-1">
        {/* Developer Diagnostics Panel */}
        <SearchDiagnosticPanel diagnostics={diagnostics} />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Filters Sidebar */}
          <aside className="lg:col-span-3 space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-[#EAE3D2] shadow-sm space-y-5 sticky top-28">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h3 className="text-sm font-bold text-[#1E2D2F] flex items-center gap-2">
                  <SlidersHorizontal className="w-4 h-4 text-[#1E7A5E]" /> Filter Results
                </h3>
                <span className="text-xs text-slate-400 font-semibold">
                  {filteredProperties.length} Stays
                </span>
              </div>

              {/* Property Type */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Property Type
                </label>
                <div className="space-y-1.5">
                  {[
                    { label: 'All Stays', value: 'all' },
                    { label: 'Luxury Hotels', value: 'hotel' },
                    { label: 'Boutique Suites', value: 'boutique hotel' },
                    { label: 'Serviced Apartments', value: 'serviced apartment' },
                  ].map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setPropertyTypeFilter(t.value)}
                      className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                        propertyTypeFilter === t.value
                          ? 'bg-[#1E7A5E] text-white'
                          : 'text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <span>{t.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Price Filter */}
              <div className="space-y-2 pt-2 border-t border-slate-100">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-bold text-slate-700 uppercase tracking-wider">
                    Max Price / Night
                  </label>
                  <span className="font-black text-[#1E7A5E]">{formatNaira(maxPriceFilter)}</span>
                </div>
                <input
                  type="range"
                  min="50000"
                  max="500000"
                  step="25000"
                  value={maxPriceFilter}
                  onChange={(e) => setMaxPriceFilter(Number(e.target.value))}
                  className="w-full accent-[#1E7A5E] cursor-pointer"
                />
              </div>
            </div>
          </aside>

          {/* Properties Grid */}
          <main className="lg:col-span-9 space-y-6">
            {loading ? (
              <div className="bg-white rounded-2xl border border-[#EAE3D2] p-12 text-center space-y-4">
                <Loader2 className="w-8 h-8 text-[#1E7A5E] animate-spin mx-auto" />
                <p className="text-sm font-bold text-slate-700">
                  Calculating Proximity &amp; Checking Real-Time Inventory...
                </p>
              </div>
            ) : error ? (
              <div className="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-800 space-y-2">
                <div className="flex items-center gap-2 font-bold text-sm">
                  <AlertCircle className="w-5 h-5 text-rose-600" /> Search Query Encountered an Error
                </div>
                <p className="text-xs leading-relaxed">{error}</p>
              </div>
            ) : filteredProperties.length === 0 ? (
              <div className="bg-white rounded-2xl border border-[#EAE3D2] p-12 text-center space-y-4">
                <Building2 className="w-12 h-12 text-slate-300 mx-auto" />
                <h3 className="text-base font-bold text-slate-800">
                  No Accommodations Found Within Radius
                </h3>
                <p className="text-xs text-slate-500 max-w-md mx-auto">
                  Try expanding your search radius to 25km or 50km or adjusting your price filters.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {filteredProperties.map((prop) => (
                  <div
                    key={prop.id}
                    className={`bg-white rounded-2xl border border-[#EAE3D2] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col group ${
                      prop.is_sold_out ? 'opacity-75' : ''
                    }`}
                  >
                    {/* Property Card Image */}
                    <div className="relative h-52 w-full bg-slate-200 overflow-hidden">
                      <img
                        src={
                          prop.photos?.[0] ||
                          prop.image_url ||
                          'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'
                        }
                        alt={prop.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                      />
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-slate-900/80 backdrop-blur-md text-white text-[11px] font-bold flex items-center gap-1">
                        <Star className="w-3 h-3 text-[#C89B3C] fill-[#C89B3C]" />
                        {prop.rating || 4.8}
                      </div>
                      {prop.distance_to_venue_km !== null && (
                        <div className="absolute bottom-3 left-3 px-2.5 py-1 rounded-full bg-[#1E7A5E] text-white text-[11px] font-bold shadow-md">
                          {prop.distance_to_venue_km} km to Venue
                        </div>
                      )}
                      {prop.is_sold_out && (
                        <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-rose-600 text-white text-[10px] font-bold uppercase tracking-wider shadow-md">
                          Sold Out
                        </div>
                      )}
                    </div>

                    {/* Property Details */}
                    <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                      <div>
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[#C89B3C]">
                            {prop.property_type || 'Hotel'}
                          </span>
                          <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                            <ShieldCheck className="w-3.5 h-3.5" /> Verified Partner
                          </span>
                        </div>
                        <h2 className="text-base font-bold text-[#1E2D2F] line-clamp-1 group-hover:text-[#1E7A5E] transition-colors mt-0.5">
                          {prop.title}
                        </h2>
                        <p className="text-xs text-[#6E7B7D] flex items-center gap-1 mt-1 truncate">
                          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          {prop.address || prop.city}
                        </p>
                      </div>

                      {/* Amenities preview */}
                      {prop.amenities && prop.amenities.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {prop.amenities.slice(0, 3).map((am, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold"
                            >
                              {am}
                            </span>
                          ))}
                        </div>
                      )}

                      {/* Price & CTA */}
                      <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] text-slate-400 font-medium block">
                            Starting from
                          </span>
                          <span className="text-sm font-black text-[#1E2D2F]">
                            {formatNaira(prop.min_price || 75000)}
                            <span className="text-[10px] font-normal text-slate-500"> / night</span>
                          </span>
                        </div>
                        <Link
                          to={`/property/${prop.id}`}
                          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1 ${
                            prop.is_sold_out
                              ? 'bg-slate-200 text-slate-500 hover:bg-slate-300'
                              : 'bg-[#1E7A5E] hover:bg-[#155642] text-white shadow-sm'
                          }`}
                        >
                          {prop.is_sold_out ? 'View Listing' : 'Select Room'}
                          <ArrowRight className="w-3 h-3" />
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </main>
        </div>
      </div>
    </CustomerLayout>
  );
};
