import React, { useState } from 'react';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { createStandaloneLogisticsRequest } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { LogisticsType } from '../types/database';
import { formatNaira } from '../lib/paystack';
import {
  CAR_MODELS,
  CAR_SERVICE_DURATIONS,
  CarDurationId,
  getCarServiceFinalPrice,
  resolveCarModel,
  resolveCarDuration,
} from '../lib/logisticsPricing';
import {
  Truck,
  Plane,
  Car,
  ShieldCheck,
  Calendar,
  Clock,
  MapPin,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Headphones,
} from 'lucide-react';

export const LogisticsPage: React.FC = () => {
  const { user } = useAuth();
  const [selectedCarId, setSelectedCarId] = useState<string>('2018-toyota-avalon');
  const [selectedDurationId, setSelectedDurationId] = useState<CarDurationId>('airport_local');

  const [pickupLocation, setPickupLocation] = useState<string>('Nnamdi Azikiwe International Airport (ABV)');
  const [dropoffLocation, setDropoffLocation] = useState<string>('Abuja Hotel / Venue');
  const [travelDate, setTravelDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [travelTime, setTravelTime] = useState<string>('12:00');
  const [flightNumber, setFlightNumber] = useState<string>('');
  const [passengers, setPassengers] = useState<number>(1);
  const [notes, setNotes] = useState<string>('');

  const [submitting, setSubmitting] = useState<boolean>(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedCar = resolveCarModel(selectedCarId);
  const selectedDuration = resolveCarDuration(selectedDurationId);
  const finalPrice = getCarServiceFinalPrice(selectedCar.id, selectedDuration.id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    const logisticsType: LogisticsType = selectedDuration.isAirport ? 'airport_pickup' : 'car_rental';

    try {
      await createStandaloneLogisticsRequest({
        user_id: user?.id || 'guest',
        type: logisticsType,
        pickup_location: pickupLocation,
        dropoff_location: dropoffLocation,
        request_date: travelDate,
        request_time: travelTime,
        flight_number: flightNumber,
        passengers,
        amount: finalPrice,
        notes: `Car: ${selectedCar.name} • Duration: ${selectedDuration.label}. ${notes}`.trim(),
      });

      setSuccessMsg('Your ground logistics request has been received and logged with our dispatch concierge.');
      setSubmitting(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit logistics request.');
      setSubmitting(false);
    }
  };

  return (
    <CustomerLayout>
      <section className="bg-[#101D1E] text-white py-12 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-3">
            <span className="text-xs font-bold uppercase tracking-widest text-[#C89B3C] flex items-center gap-1.5">
              <Truck className="w-4 h-4" /> Ground Transportation &amp; Chauffeur Services
            </span>
            <h1 className="text-3xl sm:text-5xl font-serif font-black tracking-tight">
              Car Rental &amp; Chauffeur Services
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              Coordinated executive transport, VIP airport greeting, and city charters. Choose vehicle and duration for an authoritative, single final price.
            </p>
          </div>
        </div>
      </section>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10">
          {/* Booking Form */}
          <div className="lg:col-span-7">
            <div className="bg-white rounded-3xl border border-[#EAE3D2] p-6 sm:p-8 shadow-md space-y-6">
              <h2 className="text-lg font-serif font-bold text-[#1E2D2F]">
                Book Ground Transportation
              </h2>

              {successMsg && (
                <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              {errorMsg && (
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                {/* 1. Duration / Service Category */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    1. Select Service / Duration
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {CAR_SERVICE_DURATIONS.map((dur) => {
                      const active = selectedDurationId === dur.id;
                      return (
                        <button
                          key={dur.id}
                          type="button"
                          onClick={() => {
                            setSelectedDurationId(dur.id);
                            if (dur.id === 'airport_local') {
                              setPickupLocation('Nnamdi Azikiwe International Airport (ABV) - Domestic');
                              setDropoffLocation('Abuja Hotel / Venue');
                            } else if (dur.id === 'airport_international') {
                              setPickupLocation('Nnamdi Azikiwe International Airport (ABV) - International');
                              setDropoffLocation('Abuja Hotel / Venue');
                            }
                          }}
                          className={`p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                            active
                              ? 'bg-[#1E7A5E] text-white border-[#1E7A5E] shadow-sm ring-2 ring-[#1E7A5E]/20'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full">
                            <span className="text-xs font-bold">{dur.label}</span>
                            {dur.isAirport && <Plane className={`w-3 h-3 ${active ? 'text-amber-300' : 'text-slate-400'}`} />}
                          </div>
                          <span className={`text-[10px] mt-1 ${active ? 'text-emerald-100' : 'text-slate-500'}`}>
                            {dur.isAirport ? 'Airport' : 'City Charter'}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* 2. Vehicle Selection */}
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider block">
                    2. Select Vehicle (Prices update immediately for {selectedDuration.label})
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {CAR_MODELS.map((car) => {
                      const active = selectedCarId === car.id;
                      const price = car.rates[selectedDurationId];
                      return (
                        <div
                          key={car.id}
                          onClick={() => setSelectedCarId(car.id)}
                          className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center gap-3 ${
                            active
                              ? 'bg-white text-slate-900 border-[#1E7A5E] ring-2 ring-[#1E7A5E] shadow-sm'
                              : 'bg-slate-50 text-slate-700 border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h4 className="font-bold text-xs text-[#0B1F3A] truncate">{car.name}</h4>
                              {active && <CheckCircle2 className="w-3.5 h-3.5 text-[#1E7A5E]" />}
                            </div>
                            <p className="text-[10px] text-slate-500">{car.capacity}</p>
                            <span className="text-xs font-black text-[#1E7A5E] block mt-1">
                              {formatNaira(price)}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Pickup & Dropoff Locations */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Pickup Location *
                    </label>
                    <input
                      type="text"
                      required
                      value={pickupLocation}
                      onChange={(e) => setPickupLocation(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Dropoff Location *
                    </label>
                    <input
                      type="text"
                      required
                      value={dropoffLocation}
                      onChange={(e) => setDropoffLocation(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white"
                    />
                  </div>
                </div>

                {/* Date, Time, Flight */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Date *
                    </label>
                    <input
                      type="date"
                      required
                      value={travelDate}
                      onChange={(e) => setTravelDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Time *
                    </label>
                    <input
                      type="time"
                      required
                      value={travelTime}
                      onChange={(e) => setTravelTime(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Flight # (Airport)
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. BA 083"
                      value={flightNumber}
                      onChange={(e) => setFlightNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Luggage / Chauffeur Notes
                  </label>
                  <textarea
                    rows={2}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Special instructions, passenger count, luggage size..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white"
                  />
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-slate-400 block font-medium">
                      Authoritative Final Price ({selectedCar.name} • {selectedDuration.label})
                    </span>
                    <span className="text-xl font-black text-[#1E7A5E]">
                      {formatNaira(finalPrice)}
                    </span>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting}
                    className="py-3 px-6 rounded-xl bg-[#1E7A5E] hover:bg-[#155642] text-white font-bold text-xs shadow-md transition-all flex items-center gap-2 cursor-pointer disabled:opacity-50"
                  >
                    {submitting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin text-white" />
                        <span>Confirming Dispatch...</span>
                      </>
                    ) : (
                      <>
                        <Truck className="w-4 h-4 text-[#C89B3C]" />
                        <span>Reserve Logistics Service</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Logistics FAQ & Dispatch Desk */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-[#101D1E] text-white rounded-3xl p-6 sm:p-8 space-y-5 border border-slate-800 shadow-xl">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-[#C89B3C]">
                <ShieldCheck className="w-4 h-4" /> 24/7 Operations Desk
              </div>
              <h3 className="text-xl font-serif font-bold">
                The Ark ROOMS Executive Fleet
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed">
                All vehicles in The Ark ROOMS fleet undergo mechanical inspection, professional detailing, and are equipped with GPS tracking and vetted chauffeurs.
              </p>
              <div className="space-y-3 pt-2 text-xs">
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Real-time flight tracking for Domestic and International terminals.</span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Meet &amp; Greet with personalized attendee nameboards.</span>
                </div>
                <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 flex items-center gap-3">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>Transparent flat rates: 1 selected vehicle + 1 duration = 1 final price.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
