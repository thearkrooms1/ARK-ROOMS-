import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { getUserBookings, getCustomerLogistics, deletePendingBooking } from '../lib/supabase';
import { useAuth } from '../lib/authContext';
import { StatusBadge } from '../components/ui/StatusBadge';
import { Booking, LogisticsRequest } from '../types/database';
import { formatNaira } from '../lib/paystack';
import {
  CalendarCheck2,
  Building2,
  MapPin,
  Truck,
  ArrowRight,
  Clock,
  Trash2,
  AlertCircle,
  Loader2,
  Lock,
} from 'lucide-react';

export const MyTripsPage: React.FC = () => {
  const { user } = useAuth();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [logistics, setLogistics] = useState<LogisticsRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadData = () => {
    setLoading(true);
    Promise.all([getUserBookings(user?.id), getCustomerLogistics(user?.id)])
      .then(([bList, lList]) => {
        setBookings(bList);
        setLogistics(lList);
        setLoading(false);
      })
      .catch((err) => {
        console.warn('Error loading trips data:', err);
        setLoading(false);
      });
  };

  useEffect(() => {
    loadData();
  }, [user]);

  const handleDeleteTrip = async (bookingId: string) => {
    if (!window.confirm('Are you sure you want to cancel and delete this pending trip reservation?')) {
      return;
    }

    setDeletingId(bookingId);
    try {
      await deletePendingBooking(bookingId);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Failed to delete reservation.');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <CustomerLayout>
      <div className="bg-[#101D1E] text-white py-12 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl space-y-2">
            <span className="text-xs font-bold uppercase tracking-widest text-[#C89B3C]">
              Attendee Itinerary
            </span>
            <h1 className="text-3xl sm:text-4xl font-serif font-black text-white">
              My Trips &amp; Accommodations
            </h1>
            <p className="text-xs sm:text-sm text-slate-300">
              Manage your confirmed reservations, room vouchers, and scheduled ground logistics.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">
        {/* Bookings Section */}
        <section className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-serif font-bold text-[#1E2D2F] flex items-center gap-2">
              <Building2 className="w-5 h-5 text-[#1E7A5E]" /> Accommodation Bookings ({bookings.length})
            </h2>
            <Link
              to="/results"
              className="text-xs font-bold text-[#1E7A5E] hover:underline flex items-center gap-1"
            >
              Book Another Stay <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {loading ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-[#EAE3D2]">
              <Loader2 className="w-6 h-6 animate-spin text-[#1E7A5E] mx-auto mb-2" />
              <p className="text-xs font-bold text-slate-600">Loading Your Event Reservations...</p>
            </div>
          ) : bookings.length === 0 ? (
            <div className="p-12 text-center bg-white rounded-2xl border border-[#EAE3D2] space-y-4">
              <CalendarCheck2 className="w-10 h-10 text-slate-300 mx-auto" />
              <p className="text-sm font-bold text-slate-700">No active bookings found on this account.</p>
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1E7A5E] text-white text-xs font-bold shadow-sm"
              >
                Find Accommodations Near Venue
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {bookings.map((b) => (
                <div
                  key={b.id}
                  className="bg-white rounded-2xl border border-[#EAE3D2] p-6 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-mono font-bold text-slate-400">
                          {b.booking_reference}
                        </span>
                        <h3 className="text-base font-bold text-[#1E2D2F] mt-0.5">
                          {b.property?.title || 'Accommodation'}
                        </h3>
                        <p className="text-xs text-[#6E7B7D] flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 text-[#C89B3C]" />
                          {b.property?.address || b.property?.city || 'Abuja'}
                        </p>
                      </div>
                      <StatusBadge status={b.status} />
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">Check-In</span>
                        <span className="font-bold text-slate-800">{b.check_in}</span>
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block uppercase font-bold">Check-Out</span>
                        <span className="font-bold text-slate-800">{b.check_out}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-slate-400 block">Total Amount</span>
                      <span className="text-sm font-black text-[#1E2D2F]">{formatNaira(b.total_amount)}</span>
                    </div>

                    <div className="flex items-center gap-2">
                      {b.status === 'pending_payment' && (
                        <button
                          onClick={() => handleDeleteTrip(b.id)}
                          disabled={deletingId === b.id}
                          className="p-2 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                          title="Delete Pending Trip"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      <Link
                        to={`/confirmation/${b.id}`}
                        className="px-4 py-2 rounded-xl bg-[#1E7A5E] hover:bg-[#155642] text-white font-bold text-xs shadow-sm transition-all flex items-center gap-1"
                      >
                        <span>View Voucher</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Logistics Section */}
        {logistics.length > 0 && (
          <section className="space-y-6 pt-6 border-t border-[#EAE3D2]">
            <h2 className="text-xl font-serif font-bold text-[#1E2D2F] flex items-center gap-2">
              <Truck className="w-5 h-5 text-[#1E7A5E]" /> Ground Logistics Requests ({logistics.length})
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {logistics.map((l) => (
                <div key={l.id} className="bg-white rounded-2xl border border-[#EAE3D2] p-5 space-y-3 shadow-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                      {l.service_name || l.type.replace(/_/g, ' ')}
                    </span>
                    <StatusBadge status={l.status} />
                  </div>
                  <div className="text-xs text-slate-600 space-y-1">
                    <p><strong>Route:</strong> {l.pickup_location} → {l.dropoff_location}</p>
                    <p><strong>Schedule:</strong> {l.arrival_date || l.request_date} at {l.arrival_time || l.request_time}</p>
                    {l.flight_number && <p><strong>Flight:</strong> {l.flight_number}</p>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </CustomerLayout>
  );
};
