import React, { useEffect, useState } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { useAuth } from '../../lib/authContext';
import { getPropertyById, getRoomById, getVenueById, createPendingBookingWithLogistics } from '../../lib/supabase';
import { Property, Room, Venue, SelectedLogisticsService } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { PaystackPaymentButton } from '../../components/payment/PaystackPaymentButton';
import {
  CAR_MODELS,
  CAR_SERVICE_DURATIONS,
  resolveCarModel,
  resolveCarDuration,
  getCarServiceFinalPrice,
  CarDurationId,
} from '../../lib/logisticsPricing';
import {
  Building2,
  Calendar,
  Users,
  Car,
  ShieldCheck,
  CheckCircle2,
  Lock,
  Loader2,
  AlertCircle,
  Clock,
  ArrowRight,
  Plane,
} from 'lucide-react';

export const BookingPage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const propertyId = searchParams.get('propertyId') || '';
  const roomId = searchParams.get('roomId') || '';
  const venueId = searchParams.get('venueId') || searchParams.get('venue') || '';
  const checkIn = searchParams.get('checkIn') || '';
  const checkOut = searchParams.get('checkOut') || '';
  const guests = parseInt(searchParams.get('guests') || '1', 10);

  const [property, setProperty] = useState<Property | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [venue, setVenue] = useState<Venue | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Car Service & Chauffeur Logistics add-on states (Authoritative single final price model)
  const [includeCarService, setIncludeCarService] = useState(false);
  const [selectedCarId, setSelectedCarId] = useState<string>('2018-toyota-avalon');
  const [selectedDurationId, setSelectedDurationId] = useState<CarDurationId>('airport_local');
  const [flightNumber, setFlightNumber] = useState('');
  const [serviceDate, setServiceDate] = useState(checkIn || '');
  const [serviceTime, setServiceTime] = useState('12:00');
  const [pickupLocation, setPickupLocation] = useState('');

  // Customer contact info (defaults from profile)
  const [customerName, setCustomerName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');

  // Created booking reference
  const [createdBooking, setCreatedBooking] = useState<any | null>(null);

  useEffect(() => {
    if (profile) {
      setCustomerName(profile.full_name || '');
      setCustomerPhone(profile.phone || '');
    }
    if (user?.email) {
      setCustomerEmail(user.email);
    }
  }, [profile, user]);

  useEffect(() => {
    if (!propertyId || !roomId) {
      setLoading(false);
      return;
    }

    let isMounted = true;
    Promise.all([
      getPropertyById(propertyId),
      getRoomById(roomId),
      venueId ? getVenueById(venueId) : Promise.resolve(null),
    ]).then(([res, roomData, venueData]) => {
      if (isMounted) {
        setProperty(res?.property || null);
        setRoom(roomData);
        setVenue(venueData);
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [propertyId, roomId, venueId]);

  // Calculate nights
  const calculateNights = (): number => {
    if (!checkIn || !checkOut) return 1;
    const start = new Date(checkIn);
    const end = new Date(checkOut);
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 1;
  };

  const nights = calculateNights();
  const roomPricePerNight = room?.price_per_night || 65000;
  const roomTotal = roomPricePerNight * nights;

  // Authoritative Car Service Pricing: Customer selects 1 vehicle + 1 duration.
  // The selected option's listed price is the exact, final car-service price.
  // No base prices, no surcharges, no additions.
  const selectedCar = resolveCarModel(selectedCarId);
  const selectedDuration = resolveCarDuration(selectedDurationId);
  const finalCarServicePrice = includeCarService
    ? getCarServiceFinalPrice(selectedCar.id, selectedDuration.id)
    : 0;

  const grandTotal = roomTotal + finalCarServicePrice;

  const handleCreateReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      navigate(`/login?redirect=${encodeURIComponent(window.location.pathname + window.location.search)}`);
      return;
    }

    if (!customerName.trim() || !customerPhone.trim()) {
      setError('Please provide your full name and contact phone number.');
      return;
    }

    if (includeCarService && selectedDuration.isAirport && !flightNumber.trim()) {
      setError('Please provide your flight number for airport chauffeur pickup.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);

      const logisticsServices: SelectedLogisticsService[] = [];
      if (includeCarService) {
        const title = `${selectedCar.name} (${selectedDuration.label})`;
        logisticsServices.push({
          type: selectedDuration.isAirport ? 'airport_pickup' : 'car_rental',
          title,
          priceNGN: finalCarServicePrice,
          airport: selectedDuration.isAirport
            ? (selectedDuration.id === 'airport_international'
                ? 'Nnamdi Azikiwe International Airport (ABV) - International Terminal'
                : 'Nnamdi Azikiwe International Airport (ABV) - Domestic Terminal')
            : undefined,
          arrival_date: serviceDate || checkIn || new Date().toISOString().split('T')[0],
          arrival_time: serviceTime || '12:00',
          flight_number: flightNumber.trim() || undefined,
          pickup_location: selectedDuration.isAirport
            ? (selectedDuration.id === 'airport_international'
                ? 'Abuja International Airport (Terminal 1)'
                : 'Abuja Domestic Airport (Terminal 2)')
            : (pickupLocation.trim() || property?.title || 'Hotel / Verified Stay'),
          dropoff_location: selectedDuration.isAirport
            ? (property?.title || 'Verified Event Stay')
            : 'Abuja City / Event Venues',
          vehicle_preference: title,
          passengers: guests,
          notes: `Car Service: ${selectedCar.name}, Option: ${selectedDuration.label}. Authoritative Rate: ₦${finalCarServicePrice.toLocaleString()}`,
        });
      }

      const bookingPayload: any = {
        user_id: user.id,
        property_id: propertyId,
        room_id: roomId,
        venue_id: venue?.id || venueId || property?.venue_id || '',
        check_in: checkIn || new Date().toISOString().split('T')[0],
        check_out: checkOut || new Date(Date.now() + 86400000).toISOString().split('T')[0],
        guests: guests,
        room_total_ngn: roomTotal,
        accommodation_subtotal: roomTotal,
        logistics_total_ngn: finalCarServicePrice,
        logistics_subtotal: finalCarServicePrice,
        total_amount: grandTotal,
        total_amount_ngn: grandTotal,
        status: 'pending_payment',
        payment_status: 'pending',
        has_logistics: includeCarService,
        vehicle_preference: includeCarService ? `${selectedCar.name} (${selectedDuration.label})` : undefined,
        flight_number: flightNumber.trim() || undefined,
        arrival_date: serviceDate || checkIn || undefined,
        arrival_time: serviceTime || '12:00',
        guest_first_name: customerName.split(' ')[0] || customerName,
        guest_last_name: customerName.split(' ').slice(1).join(' ') || '',
        guest_email: customerEmail,
        guest_phone: customerPhone,
        customer_phone: customerPhone,
        special_requests: specialRequests,
        logisticsServices,
      };

      const rpcResult = await createPendingBookingWithLogistics(bookingPayload);
      if (rpcResult && rpcResult.booking) {
        setCreatedBooking(rpcResult.booking);
      } else {
        throw new Error('We could not complete your reservation. Please try again.');
      }
    } catch (err: any) {
      console.error('Reservation creation failed', err);
      setError(err.message || 'Failed to initialize reservation. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <CustomerLayout>
        <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-3">
          <Loader2 className="w-8 h-8 text-[#1E7A5E] animate-spin mx-auto" />
          <p className="text-sm font-semibold text-slate-600">Preparing your reservation...</p>
        </div>
      </CustomerLayout>
    );
  }

  if (!property || !room) {
    return (
      <CustomerLayout>
        <div className="max-w-4xl mx-auto px-4 py-20 text-center space-y-4">
          <p className="text-lg font-bold text-slate-800">Invalid reservation parameters.</p>
          <Link
            to="/search"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#0B1F3A] text-white font-bold text-xs uppercase tracking-wider"
          >
            Explore Properties
          </Link>
        </div>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout>
      <div className="bg-[#0B1F3A] text-white py-8 px-4 sm:px-6 lg:px-8">
        <div className="max-w-6xl mx-auto space-y-1">
          <span className="text-xs font-bold uppercase tracking-wider text-[#C89B3C]">
            Step 2 of 2: Secure Reservation & Payment
          </span>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white">
            {createdBooking ? 'Complete Payment' : 'Review & Confirm Reservation'}
          </h1>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Booking Form / Payment Area */}
          <div className="lg:col-span-2 space-y-6">
            {error && (
              <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-xs text-red-700 flex items-start gap-2 animate-fadeIn">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Reservation Note</p>
                  <p>{error}</p>
                </div>
              </div>
            )}

            {createdBooking ? (
              /* Awaiting Payment View */
              <div className="bg-white rounded-3xl border border-slate-200 p-6 sm:p-8 shadow-xl space-y-6">
                <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
                  <div className="w-10 h-10 rounded-2xl bg-amber-50 text-amber-800 border border-amber-200 flex items-center justify-center font-bold">
                    <Clock className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-black text-[#0B1F3A]">Reservation Created</h2>
                    <p className="text-xs text-slate-500 font-mono">
                      Ref: <strong>{createdBooking.booking_reference}</strong>
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-emerald-50 rounded-2xl border border-emerald-200 text-xs text-emerald-950 space-y-1">
                  <p className="font-bold">Your room is reserved for 15 minutes.</p>
                  <p>
                    Please complete your payment via Paystack to receive your instant check-in confirmation and logistics pass.
                  </p>
                </div>

                {/* Authoritative Paystack Payment Component */}
                <div className="pt-2">
                  <PaystackPaymentButton
                    bookingIdOrRef={createdBooking.id}
                    bookingReference={createdBooking.booking_reference}
                    totalAmountNGN={createdBooking.total_amount_ngn || grandTotal}
                    buttonText={`Pay with Paystack (${formatNGN(createdBooking.total_amount_ngn || grandTotal)})`}
                    onPaymentSuccess={(updated) => {
                      navigate(`/trips/${createdBooking.id}?paid=true`);
                    }}
                  />
                </div>

                <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                  <span className="flex items-center gap-1">
                    <ShieldCheck className="w-4 h-4 text-[#1E7A5E]" /> 256-Bit SSL Encrypted
                  </span>
                  <Link to="/my-trips" className="text-[#1E7A5E] font-bold hover:underline">
                    View in My Trips →
                  </Link>
                </div>
              </div>
            ) : (
              /* Booking Details Form */
              <form onSubmit={handleCreateReservation} className="space-y-6">
                {/* Guest Contact Details */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                  <h3 className="font-bold text-[#0B1F3A] text-sm uppercase tracking-wider flex items-center gap-2">
                    <Users className="w-4 h-4 text-[#1E7A5E]" /> Guest Contact Details
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Full Name *</label>
                      <input
                        type="text"
                        required
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="e.g. Dr. Emeka Okafor"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-[#1E7A5E] outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Email Address *</label>
                      <input
                        type="email"
                        required
                        value={customerEmail}
                        onChange={(e) => setCustomerEmail(e.target.value)}
                        placeholder="emeka@example.com"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-[#1E7A5E] outline-none"
                      />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-xs font-bold text-slate-700">Phone Number (WhatsApp Active) *</label>
                      <input
                        type="tel"
                        required
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="+234 801 234 5678"
                        className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 text-xs text-slate-900 focus:ring-2 focus:ring-[#1E7A5E] outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Car Rental & Chauffeur Service Addon */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-4">
                  <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                    <div className="space-y-0.5">
                      <h3 className="font-bold text-[#0B1F3A] text-sm uppercase tracking-wider flex items-center gap-2">
                        <Car className="w-4 h-4 text-[#1E7A5E]" /> Car Rental &amp; Chauffeur Service
                      </h3>
                      <p className="text-xs text-slate-500">
                        Select a vehicle and duration. Each option is a single, all-inclusive final price.
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={includeCarService}
                        onChange={(e) => setIncludeCarService(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#1E7A5E]"></div>
                    </label>
                  </div>

                  {includeCarService && (
                    <div className="p-4 sm:p-5 bg-emerald-50/50 rounded-2xl border border-emerald-200/80 space-y-5 animate-fadeIn">
                      {/* 1. Service / Duration Selection */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                          1. Select Service / Duration
                        </label>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          {CAR_SERVICE_DURATIONS.map((dur) => {
                            const active = selectedDurationId === dur.id;
                            return (
                              <button
                                key={dur.id}
                                type="button"
                                onClick={() => setSelectedDurationId(dur.id)}
                                className={`px-3 py-2.5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                                  active
                                    ? 'bg-[#1E7A5E] text-white border-[#1E7A5E] shadow-sm ring-2 ring-[#1E7A5E]/20'
                                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                                }`}
                              >
                                <div className="flex items-center justify-between w-full">
                                  <span className="text-xs font-bold">{dur.label}</span>
                                  {dur.isAirport && <Plane className={`w-3 h-3 ${active ? 'text-amber-300' : 'text-slate-400'}`} />}
                                </div>
                                <span className={`text-[10px] mt-1 ${active ? 'text-emerald-100' : 'text-slate-500'}`}>
                                  {dur.isAirport ? 'Airport Chauffeur' : 'Charter Service'}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* 2. Vehicle Selection (Prices update immediately for selected duration) */}
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-800 uppercase tracking-wider block">
                          2. Choose Vehicle (Rates shown for {selectedDuration.label})
                        </label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {CAR_MODELS.map((car) => {
                            const active = selectedCarId === car.id;
                            const price = car.rates[selectedDurationId];
                            return (
                              <div
                                key={car.id}
                                onClick={() => setSelectedCarId(car.id)}
                                className={`p-3.5 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                                  active
                                    ? 'bg-white text-slate-900 border-[#1E7A5E] ring-2 ring-[#1E7A5E] shadow-md'
                                    : 'bg-white text-slate-700 border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                <img
                                  src={car.image}
                                  alt={car.name}
                                  loading="lazy"
                                  referrerPolicy="no-referrer"
                                  onError={(e) => {
                                    const target = e.currentTarget;
                                    if (!target.dataset.fallbackTried && car.fallbackImage) {
                                      target.dataset.fallbackTried = 'true';
                                      target.src = car.fallbackImage;
                                    } else if (!target.dataset.svgFallbackTried) {
                                      target.dataset.svgFallbackTried = 'true';
                                      target.src = '/images/cars/car-fallback.svg';
                                    }
                                  }}
                                  className="w-16 h-12 object-cover rounded-lg border border-slate-100 shrink-0 bg-slate-100"
                                />
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-1">
                                    <h4 className="font-bold text-xs text-[#0B1F3A] truncate">{car.name}</h4>
                                    {active && <CheckCircle2 className="w-4 h-4 text-[#1E7A5E] shrink-0" />}
                                  </div>
                                  <p className="text-[10px] text-slate-500">{car.capacity}</p>
                                  <div className="mt-1 flex items-baseline justify-between">
                                    <span className="text-xs font-black text-[#1E7A5E]">
                                      {formatNGN(price)}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-medium">
                                      / {selectedDuration.shortLabel}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Active Selection Banner */}
                      <div className="p-3 bg-white rounded-xl border border-emerald-300/80 flex items-center justify-between text-xs">
                        <div className="space-y-0.5">
                          <span className="text-[10px] uppercase font-bold text-emerald-800 block">Selected Option</span>
                          <span className="font-bold text-slate-900">{selectedCar.name} • {selectedDuration.label}</span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] uppercase text-slate-400 block font-medium">Final Car-Service Price</span>
                          <span className="text-sm font-black text-[#1E7A5E]">{formatNGN(finalCarServicePrice)}</span>
                        </div>
                      </div>

                      {/* Details: Flight / Locations / Dates */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-2 border-t border-emerald-200/50">
                        {selectedDuration.isAirport ? (
                          <div className="space-y-1">
                            <label className="font-bold text-slate-800">Flight Number *</label>
                            <input
                              type="text"
                              required={includeCarService && selectedDuration.isAirport}
                              value={flightNumber}
                              onChange={(e) => setFlightNumber(e.target.value)}
                              placeholder="e.g. W3 124 / BA 075"
                              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold uppercase outline-none focus:ring-2 focus:ring-[#1E7A5E]"
                            />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <label className="font-bold text-slate-800">Pickup Location</label>
                            <input
                              type="text"
                              value={pickupLocation}
                              onChange={(e) => setPickupLocation(e.target.value)}
                              placeholder={property?.title || 'Hotel Lobby / Venue'}
                              className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:ring-2 focus:ring-[#1E7A5E]"
                            />
                          </div>
                        )}
                        <div className="space-y-1">
                          <label className="font-bold text-slate-800">Service Date</label>
                          <input
                            type="date"
                            value={serviceDate}
                            onChange={(e) => setServiceDate(e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#1E7A5E]"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="font-bold text-slate-800">Service Time</label>
                          <input
                            type="time"
                            value={serviceTime}
                            onChange={(e) => setServiceTime(e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-xl px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-[#1E7A5E]"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Special Requests */}
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    Special Requests & Event Notes (Optional)
                  </label>
                  <textarea
                    rows={3}
                    value={specialRequests}
                    onChange={(e) => setSpecialRequests(e.target.value)}
                    placeholder="e.g. Quiet room requested for summit prep, late check-in at 9 PM..."
                    className="w-full bg-slate-50 border border-slate-300 rounded-xl p-3 text-xs text-slate-800 focus:ring-2 focus:ring-[#1E7A5E] outline-none"
                  />
                </div>

                {/* Submit Action */}
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-4 px-6 rounded-2xl bg-[#C89B3C] hover:bg-[#b88c2e] active:scale-[0.99] text-slate-950 font-black text-sm uppercase tracking-wider transition-all shadow-xl flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      <span>Confirming Reservation...</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-4 h-4 text-slate-950" />
                      <span>Lock In Reservation ({formatNGN(grandTotal)})</span>
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Right Summary Card */}
          <div className="lg:col-span-1">
            <div className="sticky top-28 bg-white rounded-3xl border border-slate-200 p-6 shadow-xl space-y-6">
              <div className="pb-4 border-b border-slate-100 space-y-1">
                <span className="text-[10px] font-extrabold uppercase tracking-wider text-[#1E7A5E] block">
                  Authoritative Breakdown
                </span>
                <h3 className="text-lg font-black text-[#0B1F3A]">Reservation Summary</h3>
              </div>

              {/* Property Details */}
              <div className="space-y-2">
                <h4 className="font-extrabold text-sm text-[#0B1F3A]">{property.title}</h4>
                <p className="text-xs text-slate-500">{property.address}, {property.city}</p>
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-100 text-xs flex justify-between">
                  <span className="font-semibold text-slate-700">{room.name}</span>
                  <span className="font-bold text-[#1E7A5E]">{formatNGN(room.price_per_night)}/nt</span>
                </div>
              </div>

              {/* Venue Proximity */}
              {venue && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs space-y-0.5">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase block">Event Venue</span>
                  <p className="font-bold text-[#0B1F3A]">{venue.name}</p>
                  <p className="text-emerald-700 text-[11px]">
                    {property.distance_to_venue_km && property.distance_to_venue_km > 0
                      ? `${property.distance_to_venue_km} km away`
                      : 'Close proximity'}
                  </p>
                </div>
              )}

              {/* Pricing Breakdown in NGN */}
              <div className="space-y-2 text-xs border-t border-slate-100 pt-4">
                <div className="flex justify-between text-slate-600">
                  <span>{formatNGN(roomPricePerNight)} × {nights} {nights === 1 ? 'night' : 'nights'}</span>
                  <span className="font-bold text-slate-900">{formatNGN(roomTotal)}</span>
                </div>

                {includeCarService && (
                  <div className="flex justify-between text-emerald-800 font-medium">
                    <span>Car Service ({selectedCar.name} • {selectedDuration.label})</span>
                    <span className="font-bold">{formatNGN(finalCarServicePrice)}</span>
                  </div>
                )}

                <div className="flex justify-between text-slate-500">
                  <span>Platform & Inspection Guarantee</span>
                  <span className="font-semibold text-emerald-700">Included (₦0)</span>
                </div>

                <div className="pt-3 border-t border-slate-200 flex justify-between items-baseline">
                  <span className="font-extrabold text-sm text-[#0B1F3A]">Total Amount (NGN)</span>
                  <span className="text-xl font-black text-[#0B1F3A]">{formatNGN(grandTotal)}</span>
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 text-[11px] text-slate-500 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#1E7A5E] shrink-0" />
                <span>Base Currency: NGN (₦). Instant receipts & WhatsApp itinerary dispatched upon verification.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
