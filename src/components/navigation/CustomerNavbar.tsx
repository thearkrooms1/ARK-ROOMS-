import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../lib/authContext';
import { clearAccommodationSearchState } from '../../lib/searchContext';
import { Building2, User, LogOut, Menu, X, Compass, HelpCircle, Briefcase, ChevronDown, Plane, ShieldCheck, Home } from 'lucide-react';

export const CustomerNavbar: React.FC = () => {
  const { user, profile, isAdmin, isHost, signOut } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    clearAccommodationSearchState();
    await signOut();
    setUserDropdownOpen(false);
    navigate('/');
  };

  const isActive = (path: string) => location.pathname === path;

  return (
    <header className="bg-[#0B1F3A] text-white sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
        {/* Brand Logo */}
        <Link to="/" className="flex items-center gap-3 group">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#1E7A5E] to-[#145340] flex items-center justify-center text-[#C89B3C] shadow-sm font-bold text-xl border border-white/10 group-hover:scale-105 transition-transform">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <span className="text-xl font-black tracking-tight text-white flex items-center gap-1.5">
              TheArk<span className="text-[#C89B3C]">Rooms</span>
            </span>
            <span className="block text-[10px] tracking-wider uppercase text-emerald-300/80 font-medium -mt-1">
              Event Stays & Travel
            </span>
          </div>
        </Link>

        {/* Desktop Nav Items */}
        <nav className="hidden md:flex items-center gap-8 text-sm font-medium">
          <Link
            to="/search"
            className={`transition-colors flex items-center gap-1.5 ${
              isActive('/search') ? 'text-[#C89B3C] font-semibold' : 'text-slate-200 hover:text-white'
            }`}
          >
            <Compass className="w-4 h-4 text-emerald-400" />
            Explore Stays
          </Link>
          <Link
            to="/airport-services"
            className={`transition-colors flex items-center gap-1.5 ${
              isActive('/airport-services') ? 'text-[#C89B3C] font-semibold' : 'text-slate-200 hover:text-white'
            }`}
          >
            <Plane className="w-4 h-4 text-[#C89B3C]" />
            Airport Services
          </Link>
          <Link
            to="/how-it-works"
            className={`transition-colors ${
              isActive('/how-it-works') ? 'text-[#C89B3C] font-semibold' : 'text-slate-200 hover:text-white'
            }`}
          >
            How It Works
          </Link>
          <Link
            to="/faqs"
            className={`transition-colors flex items-center gap-1.5 ${
              isActive('/faqs') ? 'text-[#C89B3C] font-semibold' : 'text-slate-200 hover:text-white'
            }`}
          >
            <HelpCircle className="w-4 h-4 text-emerald-400" />
            FAQs
          </Link>
          <Link
            to="/my-trips"
            className={`transition-colors flex items-center gap-1.5 ${
              isActive('/my-trips') ? 'text-[#C89B3C] font-semibold' : 'text-slate-200 hover:text-white'
            }`}
          >
            <Briefcase className="w-4 h-4 text-[#C89B3C]" />
            My Trips
          </Link>
          {isHost && (
            <Link
              to="/host/dashboard"
              className="text-[#C89B3C] hover:text-white transition-colors flex items-center gap-1 text-xs uppercase tracking-wider font-bold py-1 px-2.5 rounded-full bg-white/10 border border-[#C89B3C]/30"
            >
              <Home className="w-3.5 h-3.5" />
              <span>Host Portal</span>
            </Link>
          )}
        </nav>

        {/* Auth CTA */}
        <div className="hidden md:flex items-center gap-4">
          {user ? (
            <div className="relative">
              <button
                onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                className="flex items-center gap-2.5 px-3.5 py-2 rounded-lg bg-white/10 hover:bg-white/15 border border-white/10 text-sm font-medium transition-all"
              >
                <div className="w-7 h-7 rounded-full bg-[#1E7A5E] flex items-center justify-center text-white text-xs font-bold">
                  {profile?.full_name ? profile.full_name.charAt(0).toUpperCase() : 'U'}
                </div>
                <span className="max-w-[120px] truncate">{profile?.full_name || user.email}</span>
                <ChevronDown className="w-4 h-4 text-slate-300" />
              </button>

              {userDropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-slate-900 border border-slate-800 rounded-xl shadow-xl py-2 z-50 text-slate-200 text-sm">
                  <div className="px-4 py-2 border-b border-slate-800">
                    <p className="font-semibold text-white truncate">{profile?.full_name || 'Attendee'}</p>
                    <p className="text-xs text-slate-400 truncate">{user.email}</p>
                  </div>
                  <Link
                    to="/my-trips"
                    onClick={() => setUserDropdownOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-slate-800 text-slate-200 hover:text-white"
                  >
                    <Briefcase className="w-4 h-4 text-[#C89B3C]" />
                    My Bookings & Trips
                  </Link>
                  <Link
                    to="/airport-services"
                    onClick={() => setUserDropdownOpen(false)}
                    className="flex items-center gap-2 px-4 py-2 hover:bg-slate-800 text-slate-200 hover:text-white"
                  >
                    <Plane className="w-4 h-4 text-[#1E7A5E]" />
                    Airport Services
                  </Link>
                  {isHost ? (
                    <Link
                      to="/host/dashboard"
                      onClick={() => setUserDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 bg-slate-800/80 hover:bg-slate-800 text-[#C89B3C] hover:text-white border-t border-slate-800 font-medium"
                    >
                      <Building2 className="w-4 h-4 text-[#C89B3C]" />
                      Host Portal Dashboard
                    </Link>
                  ) : (
                    <Link
                      to="/host/dashboard"
                      onClick={() => setUserDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 hover:bg-slate-800 text-slate-300 hover:text-white border-t border-slate-800 text-xs"
                    >
                      <Building2 className="w-4 h-4 text-[#1E7A5E]" />
                      Activate Host Account
                    </Link>
                  )}
                  {isAdmin && (
                    <Link
                      to="/admin"
                      onClick={() => setUserDropdownOpen(false)}
                      className="flex items-center gap-2 px-4 py-2 bg-emerald-950/40 hover:bg-emerald-900/50 text-emerald-300 hover:text-white border-t border-slate-800 font-medium"
                    >
                      <ShieldCheck className="w-4 h-4 text-[#C89B3C]" />
                      Operations Console
                    </Link>
                  )}
                  <button
                    onClick={handleSignOut}
                    className="w-full text-left flex items-center gap-2 px-4 py-2 hover:bg-rose-900/30 text-rose-300 hover:text-rose-200 border-t border-slate-800 mt-1"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Link
                to="/signup?type=host"
                className="text-xs font-bold text-emerald-300 hover:text-emerald-200 px-2 py-1.5 transition-colors hidden lg:inline-flex items-center gap-1"
              >
                <Building2 className="w-3.5 h-3.5 text-[#C89B3C]" />
                <span>Become a Host</span>
              </Link>
              <Link
                to="/login"
                className="text-sm font-medium text-slate-200 hover:text-white px-3 py-2 transition-colors"
              >
                Sign In
              </Link>
              <Link
                to="/signup"
                className="px-4 py-2 rounded-lg bg-[#C89B3C] text-slate-950 font-bold text-sm hover:bg-[#d6aa4a] transition-all shadow-md hover:shadow-lg"
              >
                Get Started
              </Link>
            </div>
          )}
        </div>

        {/* Mobile menu toggle */}
        <div className="md:hidden flex items-center">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-2 rounded-lg bg-white/10 text-white"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden bg-[#0B1F3A] border-t border-slate-800 px-4 pt-4 pb-6 space-y-4">
          <Link
            to="/search"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-slate-200 hover:text-white text-base font-medium"
          >
            Explore Stays
          </Link>
          <Link
            to="/airport-services"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-slate-200 hover:text-white text-base font-medium"
          >
            Airport Services
          </Link>
          <Link
            to="/how-it-works"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-slate-200 hover:text-white text-base font-medium"
          >
            How It Works
          </Link>
          <Link
            to="/faqs"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-slate-200 hover:text-white text-base font-medium"
          >
            FAQs
          </Link>
          <Link
            to="/my-trips"
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-slate-200 hover:text-white text-base font-medium"
          >
            My Trips
          </Link>
          <Link
            to={isHost ? '/host/dashboard' : '/signup?type=host'}
            onClick={() => setMobileMenuOpen(false)}
            className="block py-2 text-[#C89B3C] hover:text-white text-base font-medium"
          >
            {isHost ? 'Host Portal Dashboard' : 'Become a Host'}
          </Link>
          <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
            {user ? (
              <>
                <div className="text-xs text-slate-400">Signed in as {profile?.full_name || user.email}</div>
                {isAdmin && (
                  <Link
                    to="/admin"
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full py-2 bg-emerald-950/60 border border-emerald-800/40 text-emerald-300 rounded-lg font-medium text-sm text-center flex items-center justify-center gap-2"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#C89B3C]" />
                    Operations Console
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="w-full py-2 bg-rose-900/30 text-rose-300 rounded-lg font-medium text-sm text-center"
                >
                  Sign Out
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-2">
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center py-2.5 rounded-lg border border-slate-700 text-white font-medium text-sm"
                >
                  Sign In
                </Link>
                <Link
                  to="/signup"
                  onClick={() => setMobileMenuOpen(false)}
                  className="w-full text-center py-2.5 rounded-lg bg-[#C89B3C] text-slate-950 font-bold text-sm"
                >
                  Create Account
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </header>
  );
};

