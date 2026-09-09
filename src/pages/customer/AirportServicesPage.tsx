import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { formatNGN } from '../../lib/currency';
import {
  CAR_MODELS,
  CAR_SERVICE_DURATIONS,
  CarDurationId,
  getCarServiceFinalPrice,
} from '../../lib/logisticsPricing';
import {
  Plane,
  Car,
  ShieldCheck,
  Clock,
  Users,
  CheckCircle2,
  ChevronRight,
  Sparkles,
  MapPin,
  Award,
  CalendarCheck,
} from 'lucide-react';

export const AirportServicesPage: React.FC = () => {
  const [selectedDuration, setSelectedDuration] = useState<CarDurationId>('airport_local');

  const currentDurationOption =
    CAR_SERVICE_DURATIONS.find((d) => d.id === selectedDuration) || CAR_SERVICE_DURATIONS[0];

  return (
    <CustomerLayout>
      {/* Header Banner */}
      <div className="bg-[#0B1F3A] text-white py-16 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="max-w-5xl mx-auto space-y-4 relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 text-xs font-semibold text-[#C89B3C] border border-white/15">
            <Plane className="w-3.5 h-3.5" />
            Seamless Arrival &amp; Executive Chauffeur Services
          </div>
          <h1 className="text-3xl sm:text-5xl font-black text-white">
            Car Rental &amp; Airport Chauffeur
          </h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            Transparent, all-inclusive pricing for airport transfers and hourly/daily executive rentals. One selected car, one duration, one authoritative final price.
          </p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-16">
        {/* Service Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 text-[#1E7A5E] flex items-center justify-center font-bold">
              <Clock className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#0B1F3A]">Flight Tracking Included</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              We monitor domestic and international arrivals in real time. Driver schedules adapt automatically with zero hidden waiting surcharges.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-amber-50 text-[#C89B3C] flex items-center justify-center font-bold">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#0B1F3A]">Vetted Professional Chauffeurs</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              Every driver is vetted, courteous, and knowledgeable with direct terminal access and express routes to top event centers and hotels.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 p-6 space-y-3 shadow-sm">
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-[#0B1F3A] flex items-center justify-center font-bold">
              <Award className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-[#0B1F3A]">No Surcharges • Fixed Rate</h3>
            <p className="text-xs text-slate-600 leading-relaxed">
              No complicated formulas, no surprise add-ons. The rate displayed for your vehicle and duration is the final authoritative amount.
            </p>
          </div>
        </div>

        {/* Fleet & Dynamic Duration Selector */}
        <div className="space-y-8">
          <div className="text-center max-w-2xl mx-auto space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#1E7A5E]">
              Authoritative Fleet Pricing
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0B1F3A]">
              Select Service Duration to Compare Rates
            </h2>
            <p className="text-xs text-slate-500">
              Click any duration below to see live final prices across our executive vehicle lineup.
            </p>
          </div>

          {/* Duration Toggle Buttons */}
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-4xl mx-auto">
            {CAR_SERVICE_DURATIONS.map((dur) => {
              const active = selectedDuration === dur.id;
              return (
                <button
                  key={dur.id}
                  onClick={() => setSelectedDuration(dur.id)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                    active
                      ? 'bg-[#1E7A5E] text-white shadow-md shadow-emerald-900/10'
                      : 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50'
                  }`}
                >
                  {dur.isAirport && <Plane className="w-3.5 h-3.5" />}
                  <span>{dur.label}</span>
                </button>
              );
            })}
          </div>

          {/* Cards Grid for Selected Duration */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {CAR_MODELS.map((car) => {
              const price = car.rates[selectedDuration];
              return (
                <div
                  key={car.id}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-lg transition-all flex flex-col justify-between"
                >
                  <div>
                    <div className="h-44 overflow-hidden bg-slate-100 relative">
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
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#0B1F3A]/85 backdrop-blur-md text-white text-[11px] font-semibold">
                        {car.make} {car.year}
                      </div>
                    </div>
                    <div className="p-5 space-y-3">
                      <div>
                        <h3 className="text-base font-bold text-[#0B1F3A]">{car.name}</h3>
                        <p className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                          <Users className="w-3.5 h-3.5 text-[#1E7A5E]" />
                          {car.capacity}
                        </p>
                      </div>
                      <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                        {car.description}
                      </p>
                    </div>
                  </div>

                  <div className="p-5 pt-0">
                    <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase text-slate-400 font-bold block">
                          Final Rate ({currentDurationOption.shortLabel})
                        </span>
                        <span className="text-lg font-black text-[#1E7A5E]">
                          {formatNGN(price)}
                        </span>
                      </div>
                      <Link
                        to="/search"
                        className="px-3.5 py-2 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white text-xs font-bold transition-colors flex items-center gap-1"
                      >
                        <span>Book with Stay</span>
                        <ChevronRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Complete Authoritative Price Matrix Table */}
          <div className="bg-white rounded-3xl border border-slate-200 overflow-hidden shadow-sm p-6 sm:p-8 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-lg font-black text-[#0B1F3A]">Complete Vehicle &amp; Service Price Table</h3>
                <p className="text-xs text-slate-500">
                  Authoritative final prices across all vehicles and service categories.
                </p>
              </div>
              <span className="text-[11px] font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full w-fit">
                All prices in Nigerian Naira (₦)
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                    <th className="py-3 px-4">Vehicle Model</th>
                    <th className="py-3 px-3 text-right">1 Hour</th>
                    <th className="py-3 px-3 text-right">5 Hours</th>
                    <th className="py-3 px-3 text-right">6 Hours</th>
                    <th className="py-3 px-3 text-right">8 Hours</th>
                    <th className="py-3 px-3 text-right">12 Hours</th>
                    <th className="py-3 px-3 text-right">24 Hours</th>
                    <th className="py-3 px-3 text-right bg-emerald-50/70 text-emerald-950">Airport Local</th>
                    <th className="py-3 px-3 text-right bg-emerald-50/70 text-emerald-950">Airport Int&apos;l</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {CAR_MODELS.map((car) => (
                    <tr key={car.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3 px-4 font-bold text-slate-900">{car.name}</td>
                      <td className="py-3 px-3 text-right">{formatNGN(car.rates['1_hour'])}</td>
                      <td className="py-3 px-3 text-right">{formatNGN(car.rates['5_hours'])}</td>
                      <td className="py-3 px-3 text-right">{formatNGN(car.rates['6_hours'])}</td>
                      <td className="py-3 px-3 text-right">{formatNGN(car.rates['8_hours'])}</td>
                      <td className="py-3 px-3 text-right">{formatNGN(car.rates['12_hours'])}</td>
                      <td className="py-3 px-3 text-right">{formatNGN(car.rates['24_hours'])}</td>
                      <td className="py-3 px-3 text-right font-bold text-[#1E7A5E] bg-emerald-50/40">
                        {formatNGN(car.rates['airport_local'])}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-[#1E7A5E] bg-emerald-50/40">
                        {formatNGN(car.rates['airport_international'])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
