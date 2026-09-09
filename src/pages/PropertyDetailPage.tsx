import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { getPropertyById } from '../lib/supabase';
import { useSearch } from '../lib/searchContext';
import { Property, Room } from '../types/database';
import { formatNaira } from '../lib/paystack';
import {
  MapPin,
  Star,
  ShieldCheck,
  Building2,
  Calendar,
  Users,
  CheckCircle2,
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Wifi,
  Car,
  Utensils,
  Clock,
  Sparkles,
  Phone,
  Mail,
  Loader2,
  AlertCircle,
} from 'lucide-react';

export const PropertyDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { searchParams } = useSearch();

  const [property, setProperty] = useState<Property | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let isMounted = true;
    setLoading(true);

    getPropertyById(
      id,
      searchParams.venueId,
      searchParams.checkIn,
      searchParams.checkOut,
      searchParams.guests
    )
      .then((res) => {
        if (isMounted) {
          if (res) {
            setProperty(res.property);
            setRooms(res.rooms);
          } else {
            setError('Property not found in directory.');
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error fetching property details:', err);
        if (isMounted) {
          setError(err.message || 'Failed to load property details.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [id, searchParams]);

  const handleSelectRoom = (room: Room) => {
    // Navigate to checkout with property and room in state or query params
    navigate(`/checkout?propertyId=${property?.id}&roomId=${room.id}`);
  };

  if (loading) {
    return (
      <CustomerLayout>
        <div className="max-w-7xl mx-auto px-4 py-24 text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[#1E7A5E] animate-spin mx-auto" />
          <p className="text-sm font-bold text-slate-700">Loading Property Specifications &amp; Room Rates...</p>
        </div>
      </CustomerLayout>
    );
  }

  if (error || !property) {
    return (
      <CustomerLayout>
        <div className="max-w-3xl mx-auto px-4 py-20 text-center space-y-4">
          <AlertCircle className="w-12 h-12 text-rose-500 mx-auto" />
          <h2 className="text-xl font-bold text-slate-800">Property Unavailable</h2>
          <p className="text-sm text-slate-500">{error || 'The requested property could not be found.'}</p>
          <Link
            to="/results"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#1E7A5E] text-white font-bold text-xs"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Search Results
          </Link>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout>
      {/* Property Hero & Gallery */}
      <section className="bg-white border-b border-[#EAE3D2] py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
          <div className="flex items-center justify-between">
            <Link
              to="/results"
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-[#1E7A5E] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" /> Back to Proximity Search
            </Link>
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-bold border border-emerald-200 flex items-center gap-1">
                <ShieldCheck className="w-3.5 h-3.5" /> Official Event Partner
              </span>
            </div>
          </div>

          {/* Title Area */}
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#C89B3C]">
                {property.property_type || 'Luxury Hotel'}
              </span>
              <h1 className="text-2xl sm:text-4xl font-serif font-black text-[#1E2D2F] mt-1">
                {property.title}
              </h1>
              <p className="text-xs sm:text-sm text-[#6E7B7D] flex items-center gap-1.5 mt-2">
                <MapPin className="w-4 h-4 text-[#C89B3C] shrink-0" />
                {property.address || property.city}, Nigeria
                {property.distance_to_venue_km !== null && (
                  <span className="font-bold text-[#1E7A5E] bg-[#1E7A5E]/10 px-2 py-0.5 rounded-full ml-2">
                    {property.distance_to_venue_km} km to Venue
                  </span>
                )}
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="px-4 py-2 rounded-xl bg-slate-900 text-white flex items-center gap-2">
                <Star className="w-4 h-4 text-[#C89B3C] fill-[#C89B3C]" />
                <span className="text-sm font-bold">{property.rating || 4.8} / 5.0</span>
              </div>
            </div>
          </div>

          {/* Photo Gallery Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-96 rounded-3xl overflow-hidden shadow-md">
            <div className="md:col-span-2 h-full bg-slate-200">
              <img
                src={property.photos?.[0] || property.image_url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80'}
                alt={property.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="hidden md:grid grid-rows-2 gap-4 h-full">
              <div className="h-full bg-slate-200 overflow-hidden">
                <img
                  src={property.photos?.[1] || 'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80'}
                  alt="Interior"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="h-full bg-slate-200 overflow-hidden">
                <img
                  src={property.photos?.[2] || 'https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=800&q=80'}
                  alt="Bathroom"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Property Details & Available Rooms */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
        {/* Overview & Amenities */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-8 space-y-6">
            <div className="bg-white rounded-2xl border border-[#EAE3D2] p-6 sm:p-8 space-y-4">
              <h2 className="text-lg font-serif font-bold text-[#1E2D2F]">
                About {property.title}
              </h2>
              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                {property.description ||
                  'Strategically selected partner hotel featuring top-tier executive accommodation, 24/7 dedicated power generation, high-speed Wi-Fi, and coordinated ground transit to official conference venues.'}
              </p>

              <div className="pt-4 border-t border-slate-100">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                  Verified Property Amenities
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {(property.amenities || [
                    '24/7 Power Backup',
                    'High-Speed Wi-Fi',
                    '24-Hour Armed Security',
                    'Air Conditioning',
                    'Ensuite Bathroom',
                    'Daily Housekeeping',
                  ]).map((am, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-2 text-xs font-semibold text-slate-700 p-2.5 rounded-xl bg-slate-50 border border-slate-100"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 text-[#1E7A5E] shrink-0" />
                      <span>{am}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Quick Info Card */}
          <div className="lg:col-span-4">
            <div className="bg-white rounded-2xl border border-[#EAE3D2] p-6 space-y-4 sticky top-28 shadow-sm">
              <h3 className="text-sm font-bold text-[#1E2D2F] pb-3 border-b border-slate-100">
                Stay Information
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Check-in:</span>
                  <span className="font-bold text-slate-800">{property.check_in_time || '14:00'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Check-out:</span>
                  <span className="font-bold text-slate-800">{property.check_out_time || '11:00'}</span>
                </div>
                {property.venue && (
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Event Venue:</span>
                    <span className="font-bold text-[#1E7A5E]">{property.venue.name}</span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Ground Transit:</span>
                  <span className="font-bold text-emerald-700">Dedicated Shuttle Eligible</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Room Inventory Selection */}
        <section className="space-y-6">
          <div>
            <span className="text-xs font-bold uppercase tracking-widest text-[#1E7A5E]">
              Room Inventory
            </span>
            <h2 className="text-2xl font-serif font-bold text-[#1E2D2F] mt-1">
              Select Your Accommodation
            </h2>
            <p className="text-xs text-slate-500">
              Live room rates and availability locked for event attendees.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {rooms.map((room) => {
              const isAvailable = room.is_available_for_dates !== false && room.available_count > 0;

              return (
                <div
                  key={room.id}
                  className={`bg-white rounded-2xl border border-[#EAE3D2] overflow-hidden shadow-sm flex flex-col justify-between transition-all ${
                    !isAvailable ? 'opacity-70 bg-slate-50' : 'hover:shadow-lg'
                  }`}
                >
                  <div className="relative h-44 bg-slate-200 overflow-hidden">
                    <img
                      src={
                        room.image_url ||
                        'https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=800&q=80'
                      }
                      alt={room.name}
                      className="w-full h-full object-cover"
                    />
                    {!isAvailable && (
                      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center">
                        <span className="px-3 py-1 rounded-full bg-rose-600 text-white font-bold text-xs uppercase tracking-wider">
                          Sold Out For Selected Dates
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[#C89B3C]">
                          {room.room_type || 'Executive'}
                        </span>
                        <span className="text-xs font-semibold text-slate-500 flex items-center gap-1">
                          <Users className="w-3.5 h-3.5" /> Up to {room.capacity} Guests
                        </span>
                      </div>
                      <h3 className="text-base font-bold text-[#1E2D2F]">{room.name}</h3>
                      <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                        {room.description || 'Spacious, well-appointed guest room with premium bedding, study desk, high-speed Wi-Fi, and modern bathroom.'}
                      </p>

                      {room.amenities && room.amenities.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-3">
                          {room.amenities.slice(0, 3).map((a, i) => (
                            <span
                              key={i}
                              className="px-2 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-semibold"
                            >
                              {a}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-base font-black text-[#1E2D2F]">
                          {formatNaira(room.price_per_night)}
                        </span>
                        <span className="text-[10px] text-slate-400 block">per night</span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelectRoom(room)}
                        disabled={!isAvailable}
                        className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          isAvailable
                            ? 'bg-[#1E7A5E] hover:bg-[#155642] text-white shadow-md'
                            : 'bg-slate-200 text-slate-400'
                        }`}
                      >
                        {isAvailable ? 'Book This Room' : 'Unavailable'}
                        {isAvailable && <ArrowRight className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </CustomerLayout>
  );
};
