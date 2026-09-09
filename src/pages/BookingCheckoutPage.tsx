import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { getPropertyById, getRoomById, createPendingBookingWithLogistics, CreateBookingPayload } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { useSearch } from '../lib/searchContext';
import { Property, Room, SelectedLogisticsService } from '../types/database';
import { formatNaira } from '../lib/paystack';
import {
  Building2,
  Calendar,
  Users,
  ShieldCheck,
  Truck,
  CheckCircle2,
  Lock,
  ArrowLeft,
  ArrowRight,
  AlertCircle,
  Clock,
  Loader2,
  Plane,
  Car,
} from 'lucide-react';

export const BookingCheckoutPage: React.FC = () => {
  const [urlParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { searchParams } = useSearch();

  const propertyId = urlParams.get('propertyId') || '';
  const roomId = urlParams.get('roomId') || '';

  const [property, setProperty] = useState<Property | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Form Fields
  const [firstName, setFirstName] = useState<string>(profile?.full_name?.split(' ')[0] || '');
  const [lastName, setLastName] = useState<string>(profile?.full_name?.split(' ').slice(1).join(' ') || '');
  const [email, setEmail] = useState<string>(user?.email || profile?.email || '');
  const [phone, setPhone] = useState<string>(profile?.phone || '+234 ');
  const [country, setCountry] = useState<string>(profile?.country || 'Nigeria');
  const [specialRequests, setSpecialRequests] = useState<string>('');

  // Dates & Guests
  const [checkIn, setCheckIn] = useState<string>(searchParams.checkIn || new Date().toISOString().split('T')[0]);
  const defaultCheckOut = new Date(Date.now() + 86400000 * 2).toISOString().split('T')[0];
  const [checkOut, setCheckOut] = useState<string>(searchParams.checkOut || defaultCheckOut);
  const [guests, setGuests] = useState<number>(searchParams.guests || 1);

  // Logistics add-on selection
  const [includeAirportPickup, setIncludeAirportPickup] = useState<boolean>(false);
  const [flightNumber, setFlightNumber] = useState<string>('');
  const [arrivalTime, setArrivalTime] = useState<string>('12:00');
  const [airportName, setAirportName] = useState<string>('Nnamdi Azikiwe International Airport (ABV)');

  const [includeCityShuttle, setIncludeCityShuttle] = useState<boolean>(false);

  useEffect(() => {
    if (!propertyId || !roomId) {
      setError('Missing property or room parameters for checkout.');
      setLoading(false);
      return;
    }

    let isMounted = true;
    Promise.all([getPropertyById(propertyId), getRoomById(roomId)])
      .then(([pRes, rData]) => {
        if (isMounted) {
          if (pRes?.property && rData) {
            setProperty(pRes.property);
            setRoom(rData);
          } else {
            setError('Could not retrieve room details for checkout.');
          }
          setLoading(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          setError(err.message || 'Error loading checkout data.');
          setLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [propertyId, roomId]);

  // Calculate nights and totals
  const nights = Math.max(
    1,
    Math.ceil((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / (1000 * 60 * 60 * 24))
  );
  const accommodationSubtotal = (room?.price_per_night || 0) * nights;
  const airportPickupPrice = includeAirportPickup ? 35000 : 0;
  const cityShuttlePrice = includeCityShuttle ? 20000 * nights : 0;
  const logisticsSubtotal = airportPickupPrice + cityShuttlePrice;
  const grandTotal = accommodationSubtotal + logisticsSubtotal;

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!property || !room) return;

    if (!user) {
      // Prompt user to log in or create account first
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    if (!firstName.trim() || !lastName.trim() || !email.trim() || !phone.trim()) {
      setError('Please fill in all guest contact details before proceeding.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const logisticsServices: SelectedLogisticsService[] = [];
    if (includeAirportPickup) {
      logisticsServices.push({
        type: 'airport_pickup',
        title: 'Airport Transfer (Pickup)',
        priceNGN: 35000,
        airport: airportName,
        arrival_date: checkIn,
        arrival_time: arrivalTime,
        flight_number: flightNumber || 'TBD',
        pickup_location: airportName,
        dropoff_location: property.title,
        passengers: guests,
      });
    }

    if (includeCityShuttle) {
      logisticsServices.push({
        type: 'vip_transport',
        title: 'Daily Event Venue Shuttle',
        priceNGN: 20000 * nights,
        pickup_location: property.title,
        dropoff_location: property.venue?.name || 'Event Venue',
        transport_date: checkIn,
        passengers: guests,
        notes: `Daily shuttle pass for ${nights} nights`,
      });
    }

    const payload: CreateBookingPayload = {
      user_id: user.id,
      guest_first_name: firstName.trim(),
      guest_last_name: lastName.trim(),
      guest_email: email.trim(),
      guest_phone: phone.trim(),
      country,
      special_requests: specialRequests,
      property_id: property.id,
      room_id: room.id,
      venue_id: property.venue_id,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      logisticsServices,
    };

    try {
      const result = await createPendingBookingWithLogistics(payload);
      if (result && result.booking) {
        // Redirect to booking payment confirmation page with booking ID
        navigate(`/confirmation/${result.booking.id}`);
      }
    } catch (err: any) {
      console.error('Failed to create pending booking transaction:', err);
      setError(err.message || 'We could not complete your booking request. Please check the form and try again.');
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <CustomerLayout>
        <div className="max-w-4xl mx-auto px-4 py-24 text-center space-y-4">
          <Loader2 className="w-8 h-8 text-[#1E7A5E] animate-spin mx-auto" />
          <p className="text-sm font-bold text-slate-700">Preparing Checkout Session...</p>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout>
      <div className="bg-[#101D1E] text-white py-10 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#C89B3C] mb-2">
            <Lock className="w-4 h-4" /> Secure Event Booking &amp; Logistics Checkout
          </div>
          <h1 className="text-2xl sm:text-4xl font-serif font-black text-white">
            Guest Details &amp; Ground Logistics
          </h1>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        {error && (
          <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start gap-3 text-xs">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">Booking Error</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmitBooking} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Main Guest & Logistics Form */}
          <div className="lg:col-span-7 space-y-8">
            {/* Step 1: Guest Information */}
            <div className="bg-white rounded-2xl border border-[#EAE3D2] p-6 space-y-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h2 className="text-base font-bold text-[#1E2D2F]">
                  1. Lead Guest &amp; Contact Details
                </h2>
                <span className="text-xs text-emerald-700 font-semibold flex items-center gap-1">
                  <ShieldCheck className="w-4 h-4" /> SSL Encrypted
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    First Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="e.g. Adebayo"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Last Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="e.g. Okonkwo"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Email Address (For Booking Voucher) *
                  </label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="adebayo@example.com"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white transition-all"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Phone Number (WhatsApp Active) *
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+234 801 234 5678"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white transition-all"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Special Requests / Arrival Notes
                </label>
                <textarea
                  rows={2}
                  value={specialRequests}
                  onChange={(e) => setSpecialRequests(e.target.value)}
                  placeholder="Late check-in, high floor preference, dietary notes..."
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white transition-all"
                />
              </div>
            </div>

            {/* Step 2: Ground Logistics Add-Ons */}
            <div className="bg-white rounded-2xl border border-[#EAE3D2] p-6 space-y-5 shadow-sm">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <h2 className="text-base font-bold text-[#1E2D2F] flex items-center gap-2">
                  <Truck className="w-5 h-5 text-[#1E7A5E]" /> 2. Coordinated Ground Logistics
                </h2>
                <span className="text-xs font-bold text-[#C89B3C] uppercase tracking-wider">
                  Optional Add-Ons
                </span>
              </div>

              {/* Airport Pickup Option */}
              <div className={`p-4 rounded-2xl border transition-all ${includeAirportPickup ? 'bg-emerald-50/50 border-[#1E7A5E]' : 'bg-slate-50 border-slate-200'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeAirportPickup}
                    onChange={(e) => setIncludeAirportPickup(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-[#1E7A5E] rounded"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Plane className="w-4 h-4 text-[#1E7A5E]" /> Airport Transfer (Pickup to Hotel)
                      </span>
                      <span className="text-xs font-black text-emerald-800">+₦35,000</span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Direct executive pickup at Abuja Airport with dedicated greeting concierge.
                    </p>
                  </div>
                </label>

                {includeAirportPickup && (
                  <div className="mt-4 pt-3 border-t border-emerald-200/60 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-700 uppercase">Flight Number</label>
                      <input
                        type="text"
                        placeholder="e.g. BA 083 / P4 7122"
                        value={flightNumber}
                        onChange={(e) => setFlightNumber(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-700 uppercase">Estimated Landing Time</label>
                      <input
                        type="time"
                        value={arrivalTime}
                        onChange={(e) => setArrivalTime(e.target.value)}
                        className="w-full bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-900"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* City Shuttle Option */}
              <div className={`p-4 rounded-2xl border transition-all ${includeCityShuttle ? 'bg-emerald-50/50 border-[#1E7A5E]' : 'bg-slate-50 border-slate-200'}`}>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeCityShuttle}
                    onChange={(e) => setIncludeCityShuttle(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-[#1E7A5E] rounded"
                  />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        <Car className="w-4 h-4 text-[#1E7A5E]" /> Daily Event Shuttle Pass
                      </span>
                      <span className="text-xs font-black text-emerald-800">
                        +₦20,000 / day ({formatNaira(20000 * nights)})
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1">
                      Scheduled round-trip transit between hotel and {property.venue?.name || 'event venue'} throughout your {nights}-night stay.
                    </p>
                  </div>
                </label>
              </div>
            </div>
          </div>

          {/* Order Summary & Payment Button Sidebar */}
          <div className="lg:col-span-5">
            <div className="bg-white rounded-3xl border border-[#EAE3D2] p-6 space-y-6 shadow-lg sticky top-28">
              <h3 className="text-sm font-bold uppercase tracking-wider text-[#1E2D2F] pb-3 border-b border-slate-100">
                Reservation Summary
              </h3>

              {/* Stay Details */}
              <div className="space-y-3 text-xs">
                <div className="flex justify-between items-start">
                  <span className="text-slate-500">Property:</span>
                  <span className="font-bold text-slate-900 text-right max-w-[200px] truncate">{property.title}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Room Type:</span>
                  <span className="font-bold text-[#1E7A5E]">{room.name}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Dates:</span>
                  <span className="font-bold text-slate-800">{checkIn} to {checkOut}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Duration:</span>
                  <span className="font-bold text-slate-800">{nights} {nights === 1 ? 'Night' : 'Nights'}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Guests:</span>
                  <span className="font-bold text-slate-800">{guests} {guests === 1 ? 'Guest' : 'Guests'}</span>
                </div>
              </div>

              {/* Price Breakdown */}
              <div className="space-y-2 pt-4 border-t border-slate-100 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-600">
                    Accommodation ({nights} nights × {formatNaira(room.price_per_night)})
                  </span>
                  <span className="font-bold text-slate-900">{formatNaira(accommodationSubtotal)}</span>
                </div>
                {includeAirportPickup && (
                  <div className="flex justify-between text-emerald-800">
                    <span>Airport Transfer</span>
                    <span className="font-bold">₦35,000</span>
                  </div>
                )}
                {includeCityShuttle && (
                  <div className="flex justify-between text-emerald-800">
                    <span>Event Shuttle ({nights} days)</span>
                    <span className="font-bold">{formatNaira(20000 * nights)}</span>
                  </div>
                )}
                <div className="flex justify-between items-center pt-3 border-t border-slate-200 text-sm">
                  <span className="font-bold text-slate-800">Total (Paystack):</span>
                  <span className="text-lg font-black text-[#1E7A5E]">{formatNaira(grandTotal)}</span>
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-4 px-6 rounded-2xl bg-[#1E7A5E] hover:bg-[#155642] active:bg-[#0f3d2f] text-white font-bold text-sm shadow-xl shadow-[#1E7A5E]/20 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Creating Secure Reservation...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-[#C89B3C]" />
                      <span>Proceed to Payment ({formatNaira(grandTotal)})</span>
                    </>
                  )}
                </button>
                <p className="text-[10px] text-center text-slate-400 mt-2">
                  Guaranteed room reservation • Instant Paystack authorization
                </p>
              </div>
            </div>
          </div>
        </form>
      </div>
    </CustomerLayout>
  );
};
