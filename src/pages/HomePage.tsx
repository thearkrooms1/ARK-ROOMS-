import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { VenueSearchBox } from '../components/search/VenueSearchBox';
import { getVenues, getProperties } from '../lib/supabase';
import { Venue, Property } from '../types/database';
import { formatNaira } from '../lib/paystack';
import {
  Building2,
  ShieldCheck,
  Truck,
  Sparkles,
  MapPin,
  Star,
  ArrowRight,
  Clock,
  CheckCircle2,
  Headphones,
  Calendar,
} from 'lucide-react';

export const HomePage: React.FC = () => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [featuredProperties, setFeaturedProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    Promise.all([getVenues(), getProperties()])
      .then(([vData, pData]) => {
        if (isMounted) {
          setVenues(vData);
          setFeaturedProperties(pData.slice(0, 4));
          setLoading(false);
        }
      })
      .catch((err) => {
        console.warn('Error fetching homepage data:', err);
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <CustomerLayout>
      {/* Hero Section */}
      <section className="relative bg-[#101D1E] text-white pt-16 pb-28 overflow-hidden">
        {/* Background ambient accents */}
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#1E7A5E_1px,transparent_1px)] [background-size:24px_24px] pointer-events-none" />
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-[#1E7A5E]/20 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-[#C89B3C]/15 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto space-y-5 mb-10">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#1E7A5E]/20 border border-[#1E7A5E]/40 text-emerald-300 text-xs font-bold uppercase tracking-wider">
              <Sparkles className="w-3.5 h-3.5 text-[#C89B3C]" /> Official Event Hospitality Network
            </div>
            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-serif font-black tracking-tight leading-tight text-white">
              Curated Event Accommodations <br className="hidden sm:block" />
              <span className="text-[#C89B3C] italic font-serif">Near Your Venue</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-300 font-sans leading-relaxed max-w-2xl mx-auto">
              Guaranteed rooms, verified security, seamless airport shuttles, and proximity search tailored for event attendees across Abuja and Nigeria.
            </p>
          </div>

          {/* Interactive Proximity Search Component */}
          <div className="max-w-5xl mx-auto">
            <VenueSearchBox />
          </div>
        </div>
      </section>

      {/* Official Venues Strip */}
      <section className="py-12 bg-white border-b border-[#EAE3D2]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#1E7A5E]">
                Official Event Partner Venues
              </span>
              <h2 className="text-xl sm:text-2xl font-serif font-bold text-[#1E2D2F]">
                Verified Event Destinations
              </h2>
            </div>
            <p className="text-xs text-slate-500 max-w-md">
              All properties are verified for exact proximity and direct transit routes to these designated locations.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {venues.map((venue) => (
              <div
                key={venue.id}
                className="bg-[#FDFBF7] border border-[#EAE3D2] rounded-2xl p-5 hover:border-[#1E7A5E] hover:shadow-md transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#1E7A5E]/10 text-[#1E7A5E] flex items-center justify-center font-bold shrink-0 group-hover:bg-[#1E7A5E] group-hover:text-white transition-colors">
                    <Building2 className="w-5 h-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-bold text-[#1E2D2F] truncate group-hover:text-[#1E7A5E] transition-colors">
                      {venue.name}
                    </h3>
                    <p className="text-xs text-[#6E7B7D] flex items-center gap-1 mt-0.5 truncate">
                      <MapPin className="w-3.5 h-3.5 text-[#C89B3C] shrink-0" />
                      {venue.address || venue.city}
                    </p>
                    <div className="mt-3 flex items-center justify-between pt-3 border-t border-[#EAE3D2]/60 text-[11px]">
                      <span className="text-emerald-700 font-semibold flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Event Verified
                      </span>
                      <Link
                        to={`/results?venueId=${venue.id}`}
                        className="text-[#1E7A5E] font-bold hover:underline flex items-center gap-1"
                      >
                        Explore Stays <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Properties */}
      <section className="py-16 bg-[#FDFBF7]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-end justify-between mb-10">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-widest text-[#1E7A5E]">
                Handpicked Event Accommodations
              </span>
              <h2 className="text-2xl sm:text-3xl font-serif font-black text-[#1E2D2F] mt-1">
                Featured Partner Stays
              </h2>
            </div>
            <Link
              to="/results"
              className="text-xs font-bold text-[#1E7A5E] hover:text-[#155642] flex items-center gap-1.5 transition-colors"
            >
              View All Properties <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {featuredProperties.map((prop) => (
              <div
                key={prop.id}
                className="bg-white rounded-2xl border border-[#EAE3D2] overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col group"
              >
                {/* Image */}
                <div className="relative h-48 w-full bg-slate-200 overflow-hidden">
                  <img
                    src={prop.photos?.[0] || prop.image_url || 'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'}
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
                </div>

                {/* Content */}
                <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-[#C89B3C]">
                      {prop.property_type || 'Hotel'}
                    </span>
                    <h3 className="text-base font-bold text-[#1E2D2F] line-clamp-1 group-hover:text-[#1E7A5E] transition-colors mt-0.5">
                      {prop.title}
                    </h3>
                    <p className="text-xs text-[#6E7B7D] flex items-center gap-1 mt-1 truncate">
                      <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      {prop.address || prop.city}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 font-medium block">Starting from</span>
                      <span className="text-sm font-black text-[#1E2D2F]">
                        {formatNaira(prop.min_price || 75000)}
                        <span className="text-[10px] font-normal text-slate-500"> / night</span>
                      </span>
                    </div>
                    <Link
                      to={`/property/${prop.id}`}
                      className="px-3.5 py-2 rounded-xl bg-[#1E7A5E] hover:bg-[#155642] text-white font-bold text-xs shadow-sm transition-all"
                    >
                      Book Room
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* The Ark Logistics Banner */}
      <section className="py-16 bg-[#101D1E] text-white relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7 space-y-5">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#C89B3C]/20 border border-[#C89B3C]/30 text-[#C89B3C] text-xs font-bold uppercase tracking-wider">
                <Truck className="w-3.5 h-3.5" /> End-to-End Ground Logistics
              </div>
              <h2 className="text-3xl sm:text-4xl font-serif font-bold leading-tight">
                Direct Airport Transfers &amp; <br />
                Daily Event Shuttles
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed max-w-xl">
                Arrive with total peace of mind. Book coordinated airport pickup from Nnamdi Azikiwe International Airport directly to your hotel and daily transfers to your event venue with vetted professional drivers.
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
                <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800">
                  <Clock className="w-5 h-5 text-emerald-400 mb-1" />
                  <h4 className="text-xs font-bold text-white">Flight Tracking</h4>
                  <p className="text-[10px] text-slate-400">Automatic delay adjustments</p>
                </div>
                <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800">
                  <ShieldCheck className="w-5 h-5 text-emerald-400 mb-1" />
                  <h4 className="text-xs font-bold text-white">Vetted Chauffeurs</h4>
                  <p className="text-[10px] text-slate-400">Security-cleared drivers</p>
                </div>
                <div className="p-3 bg-slate-900/80 rounded-xl border border-slate-800 col-span-2 sm:col-span-1">
                  <Headphones className="w-5 h-5 text-emerald-400 mb-1" />
                  <h4 className="text-xs font-bold text-white">24/7 Dispatch</h4>
                  <p className="text-[10px] text-slate-400">Dedicated desk at venue</p>
                </div>
              </div>
              <div className="pt-4">
                <Link
                  to="/logistics"
                  className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#C89B3C] hover:bg-[#b08732] text-slate-950 font-bold text-sm shadow-lg transition-all"
                >
                  <Truck className="w-4 h-4" /> Book Airport &amp; City Logistics
                </Link>
              </div>
            </div>

            <div className="lg:col-span-5">
              <div className="bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
                <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300">
                  Ground Logistics Pricing Matrix
                </h3>
                <div className="space-y-3">
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white">Airport Pickup / Dropoff</p>
                      <p className="text-[10px] text-slate-400">Single Transfer (One-Way)</p>
                    </div>
                    <span className="text-sm font-black text-emerald-400">₦35,000</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white">Round-Trip Airport Package</p>
                      <p className="text-[10px] text-slate-400">Arrival + Departure Transit</p>
                    </div>
                    <span className="text-sm font-black text-emerald-400">₦65,000</span>
                  </div>

                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-bold text-white">Daily Dedicated Chauffeur</p>
                      <p className="text-[10px] text-slate-400">Full Day Dedicated SUV / Sedan</p>
                    </div>
                    <span className="text-sm font-black text-emerald-400">₦80,000</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </CustomerLayout>
  );
};
