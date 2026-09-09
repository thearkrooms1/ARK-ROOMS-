import React from 'react';
import { Link } from 'react-router-dom';
import { Building2, ShieldCheck, MapPin, Award } from 'lucide-react';

export const CustomerFooter: React.FC = () => {
  return (
    <footer className="bg-[#0B1F3A] text-slate-300 border-t border-slate-800 pt-12 pb-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8 pb-12 border-b border-slate-800">
          {/* Brand Info */}
          <div className="space-y-4 md:col-span-1">
            <Link to="/" className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#1E7A5E] flex items-center justify-center text-[#C89B3C] font-bold">
                <Building2 className="w-5 h-5" />
              </div>
              <span className="text-xl font-black text-white">
                TheArk<span className="text-[#C89B3C]">Rooms</span>
              </span>
            </Link>
            <p className="text-xs text-slate-400 italic font-medium">"Your Journey. Our Responsibility."</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              The event travel platform connecting attendees of conferences, conventions, exhibitions, and summits with verified accommodation and local transportation near their venue.
            </p>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] text-amber-400 font-medium">
              <Award className="w-3.5 h-3.5" />
              Base Currency: NGN (₦)
            </div>
          </div>

          {/* Major Venues */}
          <div className="space-y-3">
            <h4 className="text-white text-sm font-semibold tracking-wider uppercase">Popular Venues</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/search?venue=10000000-0000-4000-8000-000000000001" className="hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-[#C89B3C]" />
                  Eko Convention Centre, Lagos
                </Link>
              </li>
              <li>
                <Link to="/search?venue=10000000-0000-4000-8000-000000000002" className="hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-[#C89B3C]" />
                  Landmark Event Centre, Lagos
                </Link>
              </li>
              <li>
                <Link to="/search?venue=10000000-0000-4000-8000-000000000003" className="hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-[#C89B3C]" />
                  ICC Abuja (CBD)
                </Link>
              </li>
              <li>
                <Link to="/search?venue=10000000-0000-4000-8000-000000000004" className="hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                  <MapPin className="w-3 h-3 text-[#C89B3C]" />
                  Redemption City Arena, Ogun
                </Link>
              </li>
            </ul>
          </div>

          {/* Platform Links */}
          <div className="space-y-3">
            <h4 className="text-white text-sm font-semibold tracking-wider uppercase">Quick Links</h4>
            <ul className="space-y-2 text-xs">
              <li>
                <Link to="/search" className="hover:text-white transition-colors">
                  Explore Verified Stays
                </Link>
              </li>
              <li>
                <Link to="/airport-services" className="hover:text-white transition-colors text-[#C89B3C] font-semibold">
                  Airport & Chauffeur Services
                </Link>
              </li>
              <li>
                <Link to="/how-it-works" className="hover:text-white transition-colors">
                  How It Works
                </Link>
              </li>
              <li>
                <Link to="/faqs" className="hover:text-white transition-colors">
                  Frequently Asked Questions
                </Link>
              </li>
              <li>
                <Link to="/my-trips" className="hover:text-white transition-colors">
                  Manage My Trips
                </Link>
              </li>
            </ul>
          </div>

          {/* Payment & Trust */}
          <div className="space-y-3">
            <h4 className="text-white text-sm font-semibold tracking-wider uppercase">Trust & Security</h4>
            <div className="space-y-2 text-xs text-slate-400">
              <div className="flex items-center gap-2 text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                <span>Verified Event Properties</span>
              </div>
              <p>Supported Payment Gateways:</p>
              <div className="flex items-center gap-2 pt-1">
                <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[11px] font-bold text-slate-200">
                  Paystack
                </span>
                <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded text-[11px] font-bold text-slate-200">
                  Flutterwave
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom copyright */}
        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-400 gap-4">
          <p>© {new Date().getFullYear()} TheArkRooms. All rights reserved.</p>
          <p className="text-slate-400">Your Journey. Our Responsibility.</p>
        </div>
      </div>
    </footer>
  );
};
