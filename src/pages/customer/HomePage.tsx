import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { VenueSearchBox } from '../../components/search/VenueSearchBox';
import { getVenues, getProperties } from '../../lib/supabase';
import { Venue, Property } from '../../types/database';
import { formatNGN } from '../../lib/currency';
import { MapPin, ShieldCheck, Car, Building2, ChevronRight, Star, ArrowRight, Clock, Sparkles } from 'lucide-react';

export const HomePage: React.FC = () => {
  const [venues, setVenues] = useState<Venue[]>([]);
  const [featuredProperties, setFeaturedProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    Promise.all([getVenues(), getProperties()]).then(([vData, pData]) => {
      if (isMounted) {
        setVenues(vData);
        setFeaturedProperties(pData.slice(0, 3));
        setLoading(false);
      }
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <CustomerLayout>
      {/* HERO SECTION */}
      <section className="bg-gradient-to-b from-[#0B1F3A] via-[#0B1F3A] to-[#0f2849] text-white pt-12 pb-24 px-4 sm:px-6 lg:px-8 relative z-20 overflow-visible">
        {/* Subtle background glow */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
          <div className="absolute top-0 right-1/4 w-96 h-96 bg-[#1E7A5E]/20 rounded-full blur-3xl pointer-events-none"></div>
          <div className="absolute bottom-0 left-1/4 w-96 h-96 bg-[#C89B3C]/10 rounded-full blur-3xl pointer-events-none"></div>
        </div>

        <div className="max-w-7xl mx-auto relative z-10 space-y-8">
          {/* Main Headline & Supporting Text */}
          <div className="max-w-3xl space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-xs font-semibold text-[#C89B3C]">
              <Sparkles className="w-3.5 h-3.5" />
              Event-First Accommodation & Travel Platform
            </div>

            <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black tracking-tight text-white leading-tight">
              Stay Close to the <span className="text-[#C89B3C]">Events</span> That Matter
            </h1>

            <p className="text-base sm:text-xl text-slate-300 font-normal leading-relaxed">
              Find trusted accommodation and transportation near the event you're attending.
            </p>
          </div>

          {/* Search Component (Primary Element on Page) */}
          <div className="pt-2 relative z-30">
            <VenueSearchBox />
          </div>
        </div>
      </section>

      {/* THREE CONCISE VALUE PROPOSITIONS */}
      <section className="py-16 bg-white border-b border-slate-200 px-4 sm:px-6 lg:px-8 relative z-10">
        <div className="max-w-7xl mx-auto">
          <div className="text-center max-w-2xl mx-auto mb-12 space-y-2">
            <span className="text-xs font-bold uppercase tracking-wider text-[#1E7A5E]">
              Why Event Attendees Choose TheArkRooms
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0B1F3A]">
              Designed Around Your Event Journey
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Value Prop 1 */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-8 hover:shadow-lg transition-all space-y-4 group">
              <div className="w-14 h-14 rounded-2xl bg-[#1E7A5E]/10 border border-[#1E7A5E]/20 text-[#1E7A5E] flex items-center justify-center group-hover:bg-[#1E7A5E] group-hover:text-white transition-colors">
                <MapPin className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-[#0B1F3A]">1. Find Nearby</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Discover accommodation close to your event venue.
              </p>
            </div>

            {/* Value Prop 2 */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-8 hover:shadow-lg transition-all space-y-4 group">
              <div className="w-14 h-14 rounded-2xl bg-[#C89B3C]/10 border border-[#C89B3C]/30 text-[#C89B3C] flex items-center justify-center group-hover:bg-[#C89B3C] group-hover:text-slate-950 transition-colors">
                <ShieldCheck className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-[#0B1F3A]">2. Book With Confidence</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Stay at trusted properties reviewed by TheArkRooms.
              </p>
            </div>

            {/* Value Prop 3 */}
            <div className="bg-slate-50 border border-slate-200/80 rounded-2xl p-8 hover:shadow-lg transition-all space-y-4 group">
              <div className="w-14 h-14 rounded-2xl bg-[#0B1F3A]/10 border border-[#0B1F3A]/20 text-[#0B1F3A] flex items-center justify-center group-hover:bg-[#0B1F3A] group-hover:text-white transition-colors">
                <Car className="w-7 h-7" />
              </div>
              <h3 className="text-xl font-bold text-[#0B1F3A]">3. Travel With Support</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Arrange airport pickup and local transportation when you need it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED EVENT VENUES */}
      <section className="py-16 bg-slate-50 px-4 sm:px-6 lg:px-8 border-b border-slate-200">
        <div className="max-w-7xl mx-auto space-y-8">
          <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs font-bold uppercase tracking-wider text-[#1E7A5E]">
                Major Event Destinations
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0B1F3A]">
                Popular Event Venues
              </h2>
            </div>
            <Link
              to="/search"
              className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1E7A5E] hover:text-[#145340] transition-colors"
            >
              Explore All Venues <ChevronRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {venues.map((venue) => (
              <Link
                key={venue.id}
                to={`/search?venue=${venue.id}`}
                className="group bg-white rounded-2xl overflow-hidden border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 flex flex-col"
              >
                <div className="relative h-48 overflow-hidden bg-slate-200">
                  <img
                    src={
                      venue.image_url ||
                      'https://images.unsplash.com/photo-1540575467063-178a50c2df87?auto=format&fit=crop&w=800&q=80'
                    }
                    alt={venue.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                  />
                  <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#0B1F3A]/80 backdrop-blur-md text-white text-[11px] font-semibold border border-white/10">
                    {venue.city}, {venue.state}
                  </div>
                </div>

                <div className="p-5 flex-1 flex flex-col justify-between space-y-3">
                  <div>
                    <h3 className="text-lg font-bold text-[#0B1F3A] group-hover:text-[#1E7A5E] transition-colors">
                      {venue.name}
                    </h3>
                    <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
                      <Building2 className="w-3.5 h-3.5 text-[#C89B3C]" />
                      {venue.category || 'Event Venue'}
                    </p>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
                    <span className="font-semibold text-emerald-700">
                      {venue.upcoming_events_count || 5}+ Major Events Soon
                    </span>
                    <span className="text-[#1E7A5E] font-bold group-hover:translate-x-1 transition-transform flex items-center gap-1">
                      View Stays <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* VERIFIED STAYS NEAR VENUES */}
      {featuredProperties.length > 0 && (
        <section className="py-16 bg-white px-4 sm:px-6 lg:px-8 border-b border-slate-200">
          <div className="max-w-7xl mx-auto space-y-8">
            <div className="flex flex-col md:flex-row items-start md:items-end justify-between gap-4">
              <div className="space-y-1">
                <span className="text-xs font-bold uppercase tracking-wider text-[#1E7A5E]">
                  Verified Accommodation
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-[#0B1F3A]">
                  Stays Near Event Grounds
                </h2>
              </div>
              <Link
                to="/search"
                className="inline-flex items-center gap-1.5 text-sm font-bold text-[#1E7A5E] hover:text-[#145340] transition-colors"
              >
                Browse All Properties <ChevronRight className="w-4 h-4" />
              </Link>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {featuredProperties.map((prop) => (
                <Link
                  key={prop.id}
                  to={`/property/${prop.id}`}
                  className="group bg-slate-50 rounded-2xl overflow-hidden border border-slate-200 hover:shadow-xl transition-all duration-300 flex flex-col"
                >
                  <div className="relative h-52 overflow-hidden bg-slate-200">
                    <img
                      src={
                        prop.image_url ||
                        'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=800&q=80'
                      }
                      alt={prop.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-[#1E7A5E] text-white text-[11px] font-bold shadow-md flex items-center gap-1">
                      <Clock className="w-3 h-3 text-[#C89B3C]" />
                      {prop.distance_to_venue_km && prop.distance_to_venue_km > 0 ? `${prop.distance_to_venue_km} km to Venue` : 'Location being verified'}
                    </div>
                    {prop.is_verified && (
                      <div className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-white text-emerald-800 text-[11px] font-extrabold shadow-md flex items-center gap-1">
                        <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                        Verified Stay
                      </div>
                    )}
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between space-y-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-[#C89B3C] uppercase tracking-wider">
                          {prop.property_type}
                        </span>
                        <div className="flex items-center gap-1 text-xs font-bold text-amber-600">
                          <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                          <span>{prop.rating}</span>
                        </div>
                      </div>
                      <h3 className="text-base font-bold text-[#0B1F3A] group-hover:text-[#1E7A5E] transition-colors line-clamp-1">
                        {prop.title}
                      </h3>
                      <p className="text-xs text-slate-500 flex items-center gap-1">
                        <MapPin className="w-3 h-3 text-slate-400" />
                        {prop.city}, {prop.state}
                      </p>
                    </div>

                    <div className="pt-3 border-t border-slate-200/80 flex items-center justify-between">
                      <div>
                        <span className="text-[10px] uppercase font-semibold text-slate-400 block">Starting from</span>
                        <span className="text-base font-black text-[#0B1F3A]">
                          {formatNGN(65000)} <span className="text-xs font-normal text-slate-500">/ night</span>
                        </span>
                      </div>
                      <span className="px-3.5 py-1.5 rounded-lg bg-[#0B1F3A] text-white font-bold text-xs group-hover:bg-[#1E7A5E] group-hover:shadow-md hover:bg-[#145340] hover:scale-105 active:scale-95 transition-all duration-200 inline-flex items-center gap-1 cursor-pointer">
                        View Stay
                        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ABOUT THEARKROOMS INTRODUCTORY SECTION */}
      <section className="py-16 bg-[#0B1F3A] text-white px-4 sm:px-6 lg:px-8 relative overflow-hidden">
        <div className="max-w-4xl mx-auto text-center space-y-6 relative z-10">
          <div className="w-12 h-12 rounded-2xl bg-[#1E7A5E] text-[#C89B3C] flex items-center justify-center mx-auto shadow-xl">
            <Building2 className="w-6 h-6" />
          </div>
          <p className="text-xl sm:text-2xl lg:text-3xl font-extrabold text-slate-100 leading-snug">
            "TheArkRooms helps event attendees find trusted accommodation and local travel support in one place."
          </p>
          <p className="text-sm text-slate-300 max-w-2xl mx-auto leading-relaxed">
            Whether you are traveling for church conventions, international government summits, tech conferences, corporate workshops, or trade fairs — we ensure you stay close to where your event happens, backed by verified properties and seamless logistics.
          </p>
          <div className="pt-4">
            <Link
              to="/search"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#C89B3C] hover:bg-[#b88c2e] text-slate-950 font-black text-sm uppercase tracking-wider transition-all shadow-lg hover:shadow-xl"
            >
              Find Stays For Your Next Event
            </Link>
          </div>
        </div>
      </section>
    </CustomerLayout>
  );
};
