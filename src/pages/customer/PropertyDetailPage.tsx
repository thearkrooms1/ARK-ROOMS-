import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { getPropertyById, getVenueById } from '../../lib/supabase';
import { Property, Room, Venue } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { getSavedSearchContext, saveSearchContext } from '../../lib/searchContext';
import {
  MapPin,
  ShieldCheck,
  Star,
  Users,
  Check,
  ChevronLeft,
  ArrowRight,
  Sparkles,
  BedDouble,
  Building2,
  Calendar,
  XCircle,
  Clock,
  Car,
  AlertCircle,
  AlertTriangle,
} from 'lucide-react';

const DEFAULT_PROPERTY_IMAGE =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80';
const DEFAULT_ROOM_IMAGE =
  'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=600&q=80';

export const PropertyDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // Read search parameters: URL search params first, fallback to searchContext
  const paramVenueId = searchParams.get('venueId') || searchParams.get('venue') || '';
  const paramCheckIn = searchParams.get('checkIn') || '';
  const paramCheckOut = searchParams.get('checkOut') || '';
  const paramGuests = searchParams.get('guests') || '';

  // Safe search context retrieval with null guard
  const savedContext = getSavedSearchContext() || {};

  const venueId = paramVenueId || savedContext.venueId || '';
  const checkIn = paramCheckIn || savedContext.checkIn || '';
  const checkOut = paramCheckOut || savedContext.checkOut || '';
  const guestsNum = Math.max(1, Number(paramGuests || savedContext.guests) || 1);

  const [property, setProperty] = useState<Property | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Selected room for checkout
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) {
      setLoading(false);
      setError('Invalid property identifier provided.');
      return;
    }

    let isMounted = true;
    setLoading(true);
    setError(null);

    const fetchPropertyData = async () => {
      try {
        const [res, venueData] = await Promise.all([
          getPropertyById(
            id,
            venueId || undefined,
            checkIn || undefined,
            checkOut || undefined,
            guestsNum
          ).catch((err) => {
            console.error('[PropertyDetailPage] getPropertyById failed:', err);
            return null;
          }),
          venueId
            ? getVenueById(venueId).catch((err) => {
                console.warn('[PropertyDetailPage] getVenueById failed:', err);
                return null;
              })
            : Promise.resolve(null),
        ]);

        if (!isMounted) return;

        if (!res || !res.property) {
          setProperty(null);
          setRooms([]);
          setError('Property not found or is temporarily unavailable.');
          return;
        }

        const safeProperty = res.property;
        setProperty(safeProperty);

        const safeRooms = Array.isArray(res.rooms) ? res.rooms : [];
        setRooms(safeRooms);

        if (safeRooms.length > 0) {
          const availableRoom = safeRooms.find(
            (r) => !r.is_sold_out && (r.available_rooms === undefined || r.available_rooms > 0)
          );
          setSelectedRoomId(availableRoom ? availableRoom.id : safeRooms[0].id);
        } else {
          setSelectedRoomId(null);
        }

        // Resolve venue: prioritize explicit venueData, then property.venue, then fetch by property.venue_id
        let resolvedVenue: Venue | null = venueData || safeProperty.venue || null;
        if (!resolvedVenue && safeProperty.venue_id) {
          try {
            resolvedVenue = await getVenueById(safeProperty.venue_id).catch(() => null);
          } catch (vCatch) {
            console.warn('[PropertyDetailPage] Fallback venue fetch error:', vCatch);
          }
        }

        if (isMounted) {
          setVenue(resolvedVenue);

          // Update search context if venue details were resolved
          if (resolvedVenue && resolvedVenue.id) {
            try {
              saveSearchContext({
                venueId: resolvedVenue.id,
                venueName: resolvedVenue.name,
                venueAddress: resolvedVenue.address,
                venueCity: resolvedVenue.city,
                checkIn,
                checkOut,
                guests: guestsNum,
              });
            } catch (ctxErr) {
              console.warn('[PropertyDetailPage] saveSearchContext error:', ctxErr);
            }
          }
        }
      } catch (err: any) {
        console.error('[PropertyDetailPage] General loading error:', err);
        if (isMounted) {
          setError(err?.message || 'Failed to load accommodation details.');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchPropertyData();

    return () => {
      isMounted = false;
    };
  }, [id, venueId, checkIn, checkOut, guestsNum]);

  // Back link construction with safe search parameters
  const computedVenueId = venueId || property?.venue_id || '';
  const searchParamsObj = new URLSearchParams();
  if (computedVenueId) searchParamsObj.set('venue', computedVenueId);
  if (checkIn) searchParamsObj.set('checkIn', checkIn);
  if (checkOut) searchParamsObj.set('checkOut', checkOut);
  if (guestsNum > 1) searchParamsObj.set('guests', guestsNum.toString());

  const searchParamsString = searchParamsObj.toString();
  const backLink = searchParamsString ? `/search?${searchParamsString}` : '/search';

  const handleBackNavigation = () => {
    if (window.history.state && window.history.state.idx > 0) {
      navigate(-1);
    } else {
      navigate(backLink);
    }
  };

  const safeRooms = Array.isArray(rooms) ? rooms : [];
  const selectedRoom = safeRooms.find((r) => r.id === selectedRoomId);

  const handleProceedToBooking = () => {
    if (!selectedRoomId || !property) return;

    const effectiveVenueId = venue?.id || venueId || property.venue_id || '';

    try {
      if (effectiveVenueId) {
        saveSearchContext({
          venueId: effectiveVenueId,
          venueName: venue?.name,
          venueAddress: venue?.address,
          venueCity: venue?.city,
          checkIn,
          checkOut,
          guests: guestsNum,
        });
      }
    } catch (e) {
      console.warn('[PropertyDetailPage] Error saving search context:', e);
    }

    const params = new URLSearchParams();
    params.set('propertyId', property.id);
    params.set('roomId', selectedRoomId);
    if (effectiveVenueId) params.set('venueId', effectiveVenueId);
    if (checkIn) params.set('checkIn', checkIn);
    if (checkOut) params.set('checkOut', checkOut);
    params.set('guests', guestsNum.toString());

    navigate(`/book?${params.toString()}`);
  };

  if (loading) {
    return (
      <CustomerLayout>
        <div className="max-w-7xl mx-auto px-4 py-20 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-[#1E7A5E] border-t-transparent rounded-full animate-spin mx-auto"></div>
          <p className="text-sm font-semibold text-slate-600">Loading verified stay details...</p>
        </div>
      </CustomerLayout>
    );
  }

  if (error || !property) {
    return (
      <CustomerLayout>
        <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-5">
          <div className="w-16 h-16 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto shadow-xs">
            <AlertCircle className="w-8 h-8" />
          </div>
          <div className="space-y-2">
            <h2 className="text-2xl font-black text-[#0B1F3A]">Stay Details Unavailable</h2>
            <p className="text-sm text-slate-600 max-w-md mx-auto">
              {error || 'The requested accommodation could not be found or may have been updated.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={handleBackNavigation}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" /> Go Back
            </button>
            <Link
              to={backLink}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1E7A5E] hover:bg-[#145340] text-white font-bold text-xs uppercase tracking-wider transition-colors shadow-md"
            >
              Back to Search Results
            </Link>
          </div>
        </div>
      </CustomerLayout>
    );
  }

  // Safe fields with fallback values
  const safeTitle = property.title || 'Verified Stay';
  const safePropertyType = property.property_type || 'Hotel';
  const safeAddressParts = [property.address, property.city, property.state].filter(Boolean);
  const safeAddressText = safeAddressParts.length > 0 ? safeAddressParts.join(', ') : 'Abuja, Nigeria';
  const safeDistanceKm =
    typeof property.distance_to_venue_km === 'number' && property.distance_to_venue_km > 0
      ? property.distance_to_venue_km
      : null;
  const safeMainImage = property.image_url || DEFAULT_PROPERTY_IMAGE;
  const safePhotos = Array.isArray(property.photos) ? property.photos.filter(Boolean) : [];
  const safeAmenities = Array.isArray(property.amenities) ? property.amenities.filter(Boolean) : [];

  return (
    <CustomerLayout>
      {/* Top Breadcrumb & Venue Banner */}
      <div className="bg-[#0B1F3A] text-white py-6 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto space-y-3">
          <button
            type="button"
            onClick={handleBackNavigation}
            className="inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Search Results
          </button>

          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[#C89B3C] bg-white/10 px-2.5 py-0.5 rounded-full border border-white/15">
                  {safePropertyType}
                </span>
                {property.is_verified && (
                  <span className="px-2.5 py-0.5 rounded-full bg-emerald-950 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3 text-emerald-400" /> Verified Stay
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-4xl font-extrabold text-white">{safeTitle}</h1>
              <p className="text-xs sm:text-sm text-slate-300 flex items-center gap-1.5 pt-0.5">
                <MapPin className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>{safeAddressText}</span>
              </p>
            </div>

            {venue && (
              <div className="p-3 bg-white/10 rounded-xl border border-white/15 text-xs space-y-1 max-w-sm">
                <div className="text-[10px] uppercase font-bold text-[#C89B3C] flex items-center gap-1">
                  <Building2 className="w-3.5 h-3.5" /> Target Event Venue
                </div>
                <p className="font-bold text-white truncate">{venue.name || 'Event Venue'}</p>
                <p className="text-emerald-300 text-[11px] font-semibold flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[#C89B3C]" />
                  {safeDistanceKm ? `${safeDistanceKm} km away` : 'Verified distance from venue'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Content Column */}
          <div className="lg:col-span-2 space-y-8">
            {/* Image Gallery */}
            <div className="space-y-3">
              <div className="h-80 sm:h-96 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shadow-md">
                <img
                  src={safeMainImage}
                  alt={safeTitle}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = DEFAULT_PROPERTY_IMAGE;
                  }}
                />
              </div>

              {safePhotos.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {safePhotos.slice(0, 3).map((img, idx) => (
                    <div key={idx} className="h-24 sm:h-28 rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                      <img
                        src={img}
                        alt={`${safeTitle} ${idx + 1}`}
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = DEFAULT_PROPERTY_IMAGE;
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Description & Overview */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-4 shadow-xs">
              <h2 className="text-lg font-bold text-[#0B1F3A]">About This Property</h2>
              <p className="text-sm text-slate-700 leading-relaxed whitespace-pre-line">
                {property.description ||
                  'Welcome to this verified event accommodation with dedicated amenities designed for conference and event attendees.'}
              </p>

              <div className="pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">Amenities & Features</h3>
                {safeAmenities.length > 0 ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                    {safeAmenities.map((item, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-800 flex items-center gap-2"
                      >
                        <Check className="w-3.5 h-3.5 text-[#1E7A5E] shrink-0" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500 italic">
                    24/7 Power, High-Speed Wi-Fi, Dedicated Security, and Event Assistance.
                  </p>
                )}
              </div>
            </div>

            {/* Room Selection Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-[#0B1F3A]">Select Your Room Type</h2>
                  <p className="text-xs text-slate-500">
                    {safeRooms.length} room configuration{safeRooms.length !== 1 ? 's' : ''} available at this property
                  </p>
                </div>
                {checkIn && checkOut && (
                  <span className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    Stay: {checkIn} → {checkOut}
                  </span>
                )}
              </div>

              {safeRooms.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
                  <BedDouble className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-sm font-bold text-slate-700">No rooms currently listed for this stay.</p>
                  <p className="text-xs text-slate-500">Please check back soon or explore other properties near the venue.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {safeRooms.map((room) => {
                    const isSelected = room.id === selectedRoomId;
                    const isRoomSoldOut =
                      room.is_sold_out || (room.available_rooms !== undefined && room.available_rooms <= 0);
                    const roomAmenities = Array.isArray(room.amenities) ? room.amenities.filter(Boolean) : [];

                    return (
                      <div
                        key={room.id}
                        onClick={() => {
                          if (!isRoomSoldOut) {
                            setSelectedRoomId(room.id);
                          }
                        }}
                        className={`bg-white rounded-2xl border transition-all p-5 flex flex-col sm:flex-row gap-5 ${
                          isRoomSoldOut
                            ? 'opacity-60 bg-slate-50/80 border-slate-200 cursor-not-allowed'
                            : isSelected
                            ? 'border-[#1E7A5E] ring-2 ring-[#1E7A5E]/20 shadow-md cursor-pointer'
                            : 'border-slate-200 hover:border-slate-300 shadow-xs cursor-pointer'
                        }`}
                      >
                        {/* Room Image */}
                        <div className="sm:w-48 h-32 rounded-xl overflow-hidden bg-slate-100 relative shrink-0">
                          <img
                            src={room.image_url || DEFAULT_ROOM_IMAGE}
                            alt={room.name || 'Room'}
                            className={`w-full h-full object-cover ${isRoomSoldOut ? 'grayscale' : ''}`}
                            onError={(e) => {
                              (e.target as HTMLImageElement).src = DEFAULT_ROOM_IMAGE;
                            }}
                          />
                          {isRoomSoldOut && (
                            <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
                              <span className="px-2.5 py-1 bg-rose-600 text-white text-[10px] font-extrabold uppercase rounded shadow-sm">
                                Sold Out
                              </span>
                            </div>
                          )}
                        </div>

                        {/* Room Details */}
                        <div className="flex-1 flex flex-col justify-between space-y-2">
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-[#C89B3C] uppercase tracking-wider">
                                {room.room_type || 'Room'}
                              </span>
                              <div className="flex items-center gap-1 text-xs text-slate-600 font-semibold">
                                <Users className="w-3.5 h-3.5 text-[#1E7A5E]" />
                                <span>Max {room.capacity || 1} guests</span>
                              </div>
                            </div>
                            <h3 className="text-base font-bold text-[#0B1F3A]">{room.name || 'Comfort Room'}</h3>
                            <p className="text-xs text-slate-500 line-clamp-2">{room.description || ''}</p>
                            {roomAmenities.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 pt-1">
                                {roomAmenities.slice(0, 3).map((am, i) => (
                                  <span
                                    key={i}
                                    className="text-[10px] px-2 py-0.5 rounded bg-slate-100 text-slate-600 font-medium"
                                  >
                                    {am}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>

                          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                            <div>
                              <span className="text-base font-black text-[#0B1F3A]">
                                {formatNGN(room.price_per_night || 0)}
                              </span>
                              <span className="text-xs text-slate-500 font-normal"> / night</span>
                            </div>
                            {isRoomSoldOut ? (
                              <span className="px-3 py-1 bg-rose-100 text-rose-800 text-xs font-bold rounded-lg uppercase">
                                Fully Booked
                              </span>
                            ) : isSelected ? (
                              <span className="px-3 py-1 rounded-lg bg-[#1E7A5E] text-white text-xs font-bold flex items-center gap-1">
                                <Check className="w-3.5 h-3.5" /> Selected
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold cursor-pointer"
                              >
                                Select Room
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Checkout / Booking Summary Sticky Sidebar */}
          <div className="lg:col-span-1">
            <div className="sticky top-28 bg-white rounded-2xl border border-slate-200 p-6 shadow-xl space-y-6">
              <div className="pb-4 border-b border-slate-100">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1E7A5E] block mb-1">
                  Event Stay Reservation
                </span>
                <h3 className="text-xl font-extrabold text-[#0B1F3A]">Booking Overview</h3>
              </div>

              {/* Event & Stay Details Summary */}
              <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2.5 text-xs">
                {venue && (
                  <div className="space-y-0.5">
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Attending Event At</span>
                    <span className="font-bold text-[#0B1F3A] block truncate">{venue.name || 'Event Venue'}</span>
                    <span className="text-[10px] text-emerald-700 font-medium block">
                      {safeDistanceKm ? `${safeDistanceKm} km to event grounds` : 'Close proximity to venue'}
                    </span>
                  </div>
                )}

                <div className="pt-2 border-t border-slate-200/60 grid grid-cols-2 gap-2">
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Check-In</span>
                    <span className="font-bold text-slate-800">{checkIn || 'Not specified'}</span>
                  </div>
                  <div>
                    <span className="text-[10px] font-bold uppercase text-slate-400 block">Check-Out</span>
                    <span className="font-bold text-slate-800">{checkOut || 'Not specified'}</span>
                  </div>
                </div>

                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between">
                  <span className="text-slate-500">Guests:</span>
                  <span className="font-bold text-slate-800">
                    {guestsNum} {guestsNum === 1 ? 'Guest' : 'Guests'}
                  </span>
                </div>
              </div>

              {/* Selected Room Pricing */}
              {selectedRoom ? (
                <div className="space-y-3">
                  <div className="p-3.5 bg-emerald-50/60 rounded-xl border border-emerald-200/70 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-[#0B1F3A]">{selectedRoom.name || 'Selected Room'}</span>
                      <span className="text-xs font-bold text-[#1E7A5E]">
                        {formatNGN(selectedRoom.price_per_night || 0)}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600">Base rate per night (incl. verified guest guarantee)</p>
                  </div>

                  <button
                    onClick={handleProceedToBooking}
                    className="w-full py-4 px-6 rounded-xl bg-[#C89B3C] hover:bg-[#b88c2e] active:scale-[0.99] text-slate-950 font-black text-sm uppercase tracking-wider transition-all shadow-lg hover:shadow-xl flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Proceed to Reservation</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 text-center font-medium">
                  Please select an available room type above to proceed.
                </div>
              )}

              {/* Airport Transport Upsell Teaser */}
              <div className="p-3.5 bg-[#0B1F3A]/5 rounded-xl border border-[#0B1F3A]/10 text-xs space-y-1.5">
                <div className="font-bold text-[#0B1F3A] flex items-center gap-1.5">
                  <Car className="w-4 h-4 text-[#1E7A5E]" /> Need Airport Pickup?
                </div>
                <p className="text-slate-600 text-[11px]">
                  You can seamlessly bundle verified chauffeur pickup on the next booking screen.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
