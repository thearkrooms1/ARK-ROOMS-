import React, { useEffect, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { VenueSearchBox } from '../../components/search/VenueSearchBox';
import { SearchDiagnosticPanel } from '../../components/search/SearchDiagnosticPanel';
import { searchPropertiesDiagnostics, SearchDiagnosticData } from '../../lib/supabase';
import { Property, Venue } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { saveSearchContext } from '../../lib/searchContext';
import { MapPin, ShieldCheck, Star, SlidersHorizontal, Building2, Check, ArrowRight, Clock, Calendar, Users, AlertTriangle } from 'lucide-react';

export const SearchPage: React.FC = () => {
  const [searchParams] = useSearchParams();

  // Read search parameters STRICTLY from URL params
  const venueId = searchParams.get('venue') || searchParams.get('venueId') || searchParams.get('venue_id') || '';
  const checkIn = searchParams.get('checkIn') || '';
  const checkOut = searchParams.get('checkOut') || '';
  const guestsParam = searchParams.get('guests') || '1';
  const guestsNum = Math.max(1, Number(guestsParam) || 1);

  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedVenue, setSelectedVenue] = useState<Venue | null>(null);
  const [diagnosticData, setDiagnosticData] = useState<SearchDiagnosticData | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(venueId));

  // Filter states
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    // STRICT GUARD: If no venueId is provided in URL, do NOT execute proximity queries
    if (!venueId) {
      setProperties([]);
      setSelectedVenue(null);
      setDiagnosticData({
        venue: null,
        venueId: '',
        venueName: 'No venue selected',
        venueLat: null,
        venueLng: null,
        checkIn: checkIn || '',
        checkOut: checkOut || '',
        guests: guestsNum,
        searchRadiusKm: 10,
        rpcFunction: 'get_nearby_properties',
        rpcParams: null,
        rpcStatus: 'NOT_STARTED',
        searchNotStarted: true,
        propertiesReturnedCount: 0,
        rpcError: null,
        totalProperties: 0,
        propertiesWithLat: 0,
        propertiesWithLng: 0,
        propertiesWithBoth: 0,
        totalRooms: 0,
        activeRooms: 0,
        roomsWithInventory: 0,
        roomsForGuestCount: 0,
        allPropertyDiagnostics: [],
        rpcMatches: [],
      });
      setLoading(false);
      return;
    }

    setLoading(true);
    searchPropertiesDiagnostics({
      venueId,
      checkIn: checkIn || undefined,
      checkOut: checkOut || undefined,
      guests: guestsNum,
      searchRadiusKm: 10,
    }).then(({ properties: propsData, venue: venueData, diagnostics }) => {
      if (isMounted) {
        setProperties(propsData);
        setSelectedVenue(venueData);
        setDiagnosticData(diagnostics);
        setLoading(false);

        // Only persist context if an active venue search was explicitly provided
        if (venueId && venueData?.id) {
          saveSearchContext({
            venueId: venueData.id,
            venueName: venueData.name,
            venueAddress: venueData.address,
            venueCity: venueData.city,
            checkIn,
            checkOut,
            guests: guestsNum,
          });
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [venueId, checkIn, checkOut, guestsNum]);

  const filteredProperties = properties.filter((p) => {
    if (verifiedOnly && !p.is_verified) return false;
    if (typeFilter !== 'all' && p.property_type.toLowerCase() !== typeFilter.toLowerCase()) return false;
    return true;
  });

  const effectiveVenueId = venueId || selectedVenue?.id || '';

  return (
    <CustomerLayout>
      {/* Top Banner & Search Modify */}
      <div className="bg-[#0B1F3A] text-white py-8 px-4 sm:px-6 lg:px-8 relative z-20 overflow-visible">
        <div className="max-w-7xl mx-auto space-y-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-[#C89B3C] bg-white/10 px-3 py-0.5 rounded-full border border-white/15">
                Event Travel Search
              </span>
              {selectedVenue && (
                <span className="text-xs font-semibold text-emerald-300 bg-emerald-950/60 px-3 py-0.5 rounded-full border border-emerald-500/30">
                  Target Venue Locked
                </span>
              )}
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
              {selectedVenue ? `Stays Near ${selectedVenue.name}` : 'Explore Event Accommodation'}
            </h1>
            {selectedVenue && (
              <p className="text-xs sm:text-sm text-slate-300 flex items-center gap-1.5 pt-0.5">
                <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{selectedVenue.address}, {selectedVenue.city}, {selectedVenue.state}</span>
              </p>
            )}

            {/* Active Search Summary Chips */}
            <div className="flex flex-wrap items-center gap-2 pt-2 text-xs">
              <div className="px-3 py-1 bg-white/10 rounded-lg border border-white/15 text-slate-200 flex items-center gap-1.5 font-medium">
                <Building2 className="w-3.5 h-3.5 text-[#C89B3C]" />
                <span><strong>Venue:</strong> {selectedVenue?.name || 'All Event Venues'}</span>
              </div>
              {checkIn && checkOut && (
                <div className="px-3 py-1 bg-white/10 rounded-lg border border-white/15 text-slate-200 flex items-center gap-1.5 font-medium">
                  <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                  <span><strong>Stay:</strong> {checkIn} → {checkOut}</span>
                </div>
              )}
              <div className="px-3 py-1 bg-white/10 rounded-lg border border-white/15 text-slate-200 flex items-center gap-1.5 font-medium">
                <Users className="w-3.5 h-3.5 text-[#C89B3C]" />
                <span><strong>Guests:</strong> {guestsNum} {guestsNum === 1 ? 'Guest' : 'Guests'}</span>
              </div>
            </div>
          </div>

          <div className="relative z-30">
            <VenueSearchBox
              initialVenueId={effectiveVenueId}
              initialCheckIn={checkIn}
              initialCheckOut={checkOut}
              initialGuests={guestsNum}
            />
          </div>
        </div>
      </div>

      {/* Main Results Body */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar Filters */}
          <div className="lg:col-span-1 space-y-6 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm h-fit">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="font-extrabold text-[#0B1F3A] flex items-center gap-2 text-sm uppercase tracking-wider">
                <SlidersHorizontal className="w-4 h-4 text-[#1E7A5E]" />
                Filter Results
              </h3>
            </div>

            {/* Property Type Filter */}
            <div className="space-y-2">
              <label className="text-xs font-bold uppercase text-slate-600 block">Property Type</label>
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none"
              >
                <option value="all">All Stay Types</option>
                <option value="serviced apartment">Serviced Apartment</option>
                <option value="hotel">Hotel / Boutique Hotel</option>
                <option value="guest house">Guest House</option>
              </select>
            </div>

            {/* Verified Only Filter */}
            <div className="pt-2 border-t border-slate-100">
              <label className="flex items-center gap-2.5 cursor-pointer text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  className="w-4 h-4 text-[#1E7A5E] rounded border-slate-300 focus:ring-[#1E7A5E]"
                />
                <span className="flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                  Show Verified Stays Only
                </span>
              </label>
            </div>

            {/* Venue Search Proximity Guarantee */}
            <div className="p-3.5 bg-emerald-50/70 rounded-xl border border-emerald-200 text-[11px] text-emerald-950 space-y-1">
              <div className="font-bold flex items-center gap-1 text-[#0B1F3A]">
                <Building2 className="w-3.5 h-3.5 text-[#1E7A5E]" />
                Event Venue Focused
              </div>
              <p className="text-slate-700">
                All accommodation shown is sorted by travel distance to {selectedVenue?.name || 'your chosen venue'}.
              </p>
            </div>

            {/* Currency & Base Notice */}
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-[11px] text-slate-600 space-y-1">
              <div className="font-bold text-[#0B1F3A]">Currency: Nigerian Naira (NGN)</div>
              <p>All room rates and booking totals are calculated and processed in NGN.</p>
            </div>
          </div>

          {/* Results List */}
          <div className="lg:col-span-3 space-y-6">
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 text-xs font-semibold text-slate-600">
              <span>
                {effectiveVenueId ? (
                  <>Showing <strong className="text-[#0B1F3A]">{filteredProperties.length}</strong> stays near {selectedVenue?.name || 'event venue'}</>
                ) : (
                  <>Select an event venue to view nearby stays</>
                )}
              </span>
              {effectiveVenueId && (
                <span className="text-slate-500">Sorted by proximity to venue</span>
              )}
            </div>

            {!effectiveVenueId ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-8 sm:p-12 text-center space-y-5 shadow-sm">
                <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center mx-auto text-[#1E7A5E]">
                  <Building2 className="w-8 h-8" />
                </div>
                <div className="space-y-1.5 max-w-md mx-auto">
                  <h3 className="text-xl font-bold text-[#0B1F3A]">
                    Select an Event Venue to Begin
                  </h3>
                  <p className="text-xs sm:text-sm text-slate-600">
                    Choose your event or conference venue above to find verified accommodations and chauffeur logistics sorted by proximity.
                  </p>
                </div>

                <div className="pt-2 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto text-left text-xs">
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                    <span className="font-bold text-[#0B1F3A] flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-[#C89B3C]" />
                      Proximity Focus
                    </span>
                    <p className="text-[11px] text-slate-500">Verified radius within 10 km of your event.</p>
                  </div>
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                    <span className="font-bold text-[#0B1F3A] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      Verified Stays
                    </span>
                    <p className="text-[11px] text-slate-500">Inspected rooms with real-time inventory.</p>
                  </div>
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 space-y-1">
                    <span className="font-bold text-[#0B1F3A] flex items-center gap-1.5">
                      <MapPin className="w-4 h-4 text-blue-600" />
                      Event Shuttles
                    </span>
                    <p className="text-[11px] text-slate-500">Airport and daily venue transfers.</p>
                  </div>
                </div>
              </div>
            ) : loading ? (
              <div className="py-12 text-center text-slate-500 space-y-2">
                <div className="w-8 h-8 border-2 border-[#1E7A5E] border-t-transparent rounded-full animate-spin mx-auto"></div>
                <p className="text-xs font-semibold">Finding verified stays near venue...</p>
              </div>
            ) : filteredProperties.length === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center space-y-4">
                <Building2 className="w-12 h-12 text-slate-300 mx-auto" />
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-[#0B1F3A]">No Stays Found</h3>
                  <p className="text-xs text-slate-500 max-w-md mx-auto">
                    We couldn't find any stays matching your current filter criteria near this venue. Try adjusting your filters or selecting a different venue.
                  </p>
                </div>
              </div>
            ) : (() => {
              const availableProps = filteredProperties.filter((p) => !p.is_sold_out && (p.available_rooms_count ?? 1) > 0);
              const soldOutProps = filteredProperties.filter((p) => p.is_sold_out || (p.available_rooms_count !== undefined && p.available_rooms_count <= 0));

              // If ALL properties near this venue are sold out
              if (availableProps.length === 0 && soldOutProps.length > 0) {
                return (
                  <div className="space-y-8">
                    {/* All Stays Sold Out Empty State */}
                    <div className="bg-rose-50/70 border-2 border-rose-200 rounded-2xl p-8 sm:p-10 text-center space-y-4 shadow-sm">
                      <div className="w-12 h-12 rounded-2xl bg-rose-100 border border-rose-200 flex items-center justify-center mx-auto text-rose-600">
                        <AlertTriangle className="w-6 h-6" />
                      </div>
                      <div className="space-y-1.5 max-w-lg mx-auto">
                        <h3 className="text-xl font-extrabold text-[#0B1F3A]">
                          No available stays near this venue
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-600">
                          We couldn't find available accommodation for your selected dates ({checkIn} → {checkOut}).
                        </p>
                        <p className="text-xs text-slate-500 pt-1">
                          Try changing your dates or choosing another event venue.
                        </p>
                      </div>
                      <div className="pt-2 flex flex-wrap items-center justify-center gap-3">
                        <button
                          onClick={() => {
                            window.scrollTo({ top: 0, behavior: 'smooth' });
                          }}
                          className="px-5 py-2.5 bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-colors shadow"
                        >
                          Change Stay Dates
                        </button>
                        <Link
                          to="/"
                          className="px-5 py-2.5 bg-white hover:bg-slate-50 text-[#0B1F3A] font-bold text-xs uppercase tracking-wider rounded-xl border border-slate-300 transition-colors"
                        >
                          Choose Another Event Venue
                        </Link>
                      </div>
                    </div>

                    {/* Sold out list preview for transparency */}
                    <div className="space-y-4 opacity-75">
                      <div className="flex items-center gap-2 pb-1 border-b border-slate-200 text-xs font-bold text-slate-500 uppercase tracking-wider">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-500" />
                        <span>Sold Out Properties Near {selectedVenue?.name || 'Venue'}</span>
                      </div>
                      {soldOutProps.map((prop) => {
                        const propLink = `/property/${prop.id}?venueId=${effectiveVenueId || prop.venue_id || ''}&venue=${effectiveVenueId || prop.venue_id || ''}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guestsNum}`;
                        return (
                          <div
                            key={prop.id}
                            className="bg-white/80 rounded-2xl border border-slate-200 p-5 flex flex-col md:flex-row gap-6 shadow-sm grayscale-[30%]"
                          >
                            <div className="md:w-56 h-40 rounded-xl overflow-hidden bg-slate-100 relative shrink-0">
                              <img
                                src={prop.image_url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'}
                                alt={prop.title}
                                className="w-full h-full object-cover opacity-75"
                              />
                              <div className="absolute top-2 left-2 px-2.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-extrabold shadow uppercase">
                                Sold Out
                              </div>
                            </div>
                            <div className="flex-1 flex flex-col justify-between space-y-2">
                              <div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">{prop.property_type}</span>
                                <h4 className="text-base font-bold text-slate-700">{prop.title}</h4>
                                <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                                  {prop.distance_to_venue_km ? `${prop.distance_to_venue_km} km from ${selectedVenue?.name || 'Venue'}` : 'Location being verified'}
                                </p>
                                <p className="text-xs text-rose-700 font-medium mt-1">
                                  No room inventory available for {checkIn} to {checkOut}.
                                </p>
                              </div>
                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                                <span className="text-xs text-slate-400">All room types currently booked</span>
                                <Link
                                  to={propLink}
                                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs rounded-xl border border-slate-200 transition-colors"
                                >
                                  View Details
                                </Link>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              // Normal display: Available properties first, followed by de-emphasized sold out section if any
              return (
                <div className="space-y-8">
                  {/* Available Properties Section */}
                  <div className="space-y-4">
                    {availableProps.map((prop) => {
                      const propLink = `/property/${prop.id}?venueId=${effectiveVenueId || prop.venue_id || ''}&venue=${effectiveVenueId || prop.venue_id || ''}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guestsNum}`;
                      return (
                        <div
                          key={prop.id}
                          className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg transition-all p-5 flex flex-col md:flex-row gap-6"
                        >
                          {/* Image */}
                          <div className="md:w-64 h-48 rounded-xl overflow-hidden bg-slate-100 relative shrink-0">
                            <img
                              src={
                                prop.image_url ||
                                'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'
                              }
                              alt={prop.title}
                              className="w-full h-full object-cover"
                            />
                            <div className="absolute top-2 left-2 px-2.5 py-1 rounded-full bg-[#1E7A5E] text-white text-[10px] font-bold shadow flex items-center gap-1">
                              <Clock className="w-3 h-3 text-[#C89B3C]" />
                              {prop.distance_to_venue_km && prop.distance_to_venue_km > 0 ? `${prop.distance_to_venue_km} km to Venue` : 'Location being verified'}
                            </div>
                            {prop.is_verified && (
                              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-white text-emerald-800 text-[10px] font-black shadow flex items-center gap-1">
                                <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                Verified
                              </div>
                            )}
                          </div>

                          {/* Details */}
                          <div className="flex-1 flex flex-col justify-between space-y-3">
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-bold text-[#C89B3C] uppercase tracking-wider">
                                    {prop.property_type}
                                  </span>
                                  {prop.is_verified && (
                                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-bold flex items-center gap-1">
                                      <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                      Verified Stay
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-1 text-xs font-bold text-amber-600">
                                  <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                                  <span>{prop.rating}</span>
                                </div>
                              </div>

                              <h3 className="text-lg font-bold text-[#0B1F3A] hover:text-[#1E7A5E] transition-colors">
                                <Link to={propLink}>{prop.title}</Link>
                              </h3>
                              <p className="text-xs text-[#1E7A5E] font-semibold flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-[#C89B3C]" />
                                {prop.distance_to_venue_km && prop.distance_to_venue_km > 0
                                  ? `${prop.distance_to_venue_km} km from ${selectedVenue?.name || 'Selected Event Venue'}`
                                  : 'Location being verified'}
                              </p>
                              <p className="text-xs text-slate-500 flex items-center gap-1">
                                <MapPin className="w-3.5 h-3.5 text-slate-400" />
                                {prop.address}, {prop.city}
                              </p>
                              <p className="text-xs text-slate-600 line-clamp-2 pt-1">{prop.description}</p>

                              {/* Availability badge & Sample Available Room */}
                              <div className="flex flex-wrap items-center gap-1.5 pt-2">
                                <span className="px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 text-[10px] font-extrabold uppercase">
                                  AVAILABLE
                                </span>
                                {prop.available_room_sample && (
                                  <span className="px-2.5 py-0.5 rounded bg-blue-50 text-blue-800 border border-blue-200 text-[10px] font-bold flex items-center gap-1">
                                    <Check className="w-3 h-3 text-blue-600" />
                                    {prop.available_room_sample} available
                                  </span>
                                )}
                                {prop.amenities.slice(0, 3).map((am, i) => (
                                  <span
                                    key={i}
                                    className="px-2 py-0.5 rounded bg-slate-100 border border-slate-200 text-[10px] text-slate-700 font-medium flex items-center gap-1"
                                  >
                                    <Check className="w-2.5 h-2.5 text-[#1E7A5E]" /> {am}
                                  </span>
                                ))}
                              </div>
                            </div>

                            {/* Pricing & Primary Select Hotel CTA */}
                            <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                              <div>
                                <span className="text-[10px] uppercase font-semibold text-slate-400 block">
                                  Rates From
                                </span>
                                <span className="text-lg font-black text-[#0B1F3A]">
                                  {formatNGN(prop.min_price || 65000)} <span className="text-xs font-normal text-slate-500">/ night</span>
                                </span>
                              </div>
                              <Link
                                to={propLink}
                                className="px-5 py-2.5 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-extrabold text-xs uppercase tracking-wider transition-colors flex items-center gap-1.5 shadow-md hover:shadow-lg"
                              >
                                <span>Select Hotel</span> <ArrowRight className="w-3.5 h-3.5 text-[#C89B3C]" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* De-emphasized Sold Out Section */}
                  {soldOutProps.length > 0 && (
                    <div className="pt-6 border-t border-slate-200 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                          <h4 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
                            Sold Out Near This Venue ({soldOutProps.length})
                          </h4>
                          <p className="text-[11px] text-slate-500">
                            These properties have zero available rooms for your selected dates ({checkIn} → {checkOut}).
                          </p>
                        </div>
                      </div>

                      <div className="space-y-3 opacity-75">
                        {soldOutProps.map((prop) => {
                          const propLink = `/property/${prop.id}?venueId=${effectiveVenueId || prop.venue_id || ''}&venue=${effectiveVenueId || prop.venue_id || ''}&checkIn=${checkIn}&checkOut=${checkOut}&guests=${guestsNum}`;
                          return (
                            <div
                              key={prop.id}
                              className="bg-slate-50/80 rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                            >
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded bg-rose-100 text-rose-800 text-[10px] font-extrabold uppercase">
                                    SOLD OUT
                                  </span>
                                  <span className="text-xs font-bold text-slate-700">{prop.title}</span>
                                  <span className="text-[11px] text-slate-400">• {prop.property_type}</span>
                                </div>
                                <p className="text-xs text-slate-500 flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-400" />
                                  {prop.distance_to_venue_km ? `${prop.distance_to_venue_km} km to ${selectedVenue?.name || 'Venue'}` : 'Location being verified'}
                                </p>
                              </div>
                              <Link
                                to={propLink}
                                className="px-4 py-2 rounded-lg bg-white hover:bg-slate-100 text-slate-600 font-semibold text-xs border border-slate-300 transition-colors self-start sm:self-auto text-center"
                              >
                                View Details
                              </Link>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>

        {/* Temporary Developer Diagnostic Panel */}
        <SearchDiagnosticPanel data={diagnosticData} loading={loading} />
      </div>
    </CustomerLayout>
  );
};
