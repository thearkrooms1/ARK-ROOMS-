import React, { useEffect, useState } from 'react';
import { AdminLayout } from '../../components/layout/AdminLayout';
import {
  getAllBookingsForAdmin,
  getAllPaymentsForAdmin,
  getAllLogisticsForAdmin,
  getProperties,
} from '../../lib/supabase';
import { Booking, Payment, LogisticsRequest, Property } from '../../types/database';
import { formatNaira } from '../../lib/paystack';
import { StatusBadge } from '../../components/ui/StatusBadge';
import {
  LayoutDashboard,
  CalendarCheck2,
  Building2,
  CreditCard,
  Truck,
  Users,
  TrendingUp,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';

export const AdminOverviewPage: React.FC = () => {
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [logistics, setLogistics] = useState<LogisticsRequest[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    Promise.all([
      getAllBookingsForAdmin(),
      getAllPaymentsForAdmin(),
      getAllLogisticsForAdmin(),
      getProperties(),
    ])
      .then(([bList, pList, lList, propList]) => {
        if (isMounted) {
          setBookings(bList);
          setPayments(pList);
          setLogistics(lList);
          setProperties(propList);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Error loading admin overview metrics:', err);
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const totalRevenueNGN = bookings
    .filter((b) => b.status === 'confirmed' || b.payment_status === 'paid' || b.payment_status === 'successful')
    .reduce((sum, b) => sum + (b.total_amount || 0), 0);

  const confirmedBookingsCount = bookings.filter(
    (b) => b.status === 'confirmed' || b.payment_status === 'paid'
  ).length;

  const pendingBookingsCount = bookings.filter(
    (b) => b.status === 'pending' || b.status === 'pending_payment'
  ).length;

  const activeLogisticsCount = logistics.filter(
    (l) => l.status === 'pending' || l.status === 'scheduled' || l.status === 'in_transit' || l.status === 'assigned'
  ).length;

  return (
    <AdminLayout>
      <div className="space-y-8 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-emerald-400">
              <ShieldCheck className="w-4 h-4" /> Command &amp; Operations Center
            </div>
            <h1 className="text-2xl sm:text-3xl font-black text-white tracking-tight mt-1">
              Operations Overview
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Live accommodation inventory, attendee payments, and ground logistics tracking.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs font-bold text-slate-300">
              RC1 Production Environment
            </span>
          </div>
        </div>

        {loading ? (
          <div className="p-16 text-center bg-slate-950/60 rounded-3xl border border-slate-800">
            <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-300">Compiling Operational Metrics...</p>
          </div>
        ) : (
          <>
            {/* Metric KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {/* Total Revenue */}
              <div className="bg-slate-950/80 border border-slate-800 p-5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Gross Settled Revenue
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <CreditCard className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-white">{formatNaira(totalRevenueNGN)}</div>
                <p className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> Paystack Authoritative Settled
                </p>
              </div>

              {/* Confirmed Bookings */}
              <div className="bg-slate-950/80 border border-slate-800 p-5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Confirmed Stays
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-blue-500/10 text-blue-400 flex items-center justify-center">
                    <CalendarCheck2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-white">{confirmedBookingsCount}</div>
                <p className="text-[11px] text-slate-400">
                  {pendingBookingsCount} pending payment reservations
                </p>
              </div>

              {/* Active Logistics */}
              <div className="bg-slate-950/80 border border-slate-800 p-5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Active Ground Logistics
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-400 flex items-center justify-center">
                    <Truck className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-white">{activeLogisticsCount}</div>
                <p className="text-[11px] text-amber-400 font-semibold">Airport Pickups &amp; Shuttles</p>
              </div>

              {/* Managed Properties */}
              <div className="bg-slate-950/80 border border-slate-800 p-5 rounded-2xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Partner Accommodations
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-400 flex items-center justify-center">
                    <Building2 className="w-4 h-4" />
                  </div>
                </div>
                <div className="text-2xl font-black text-white">{properties.length}</div>
                <p className="text-[11px] text-slate-400">Geocoded Venue Radius Listings</p>
              </div>
            </div>

            {/* Recent Bookings & Dispatch Table */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* Recent Bookings List */}
              <div className="lg:col-span-8 bg-slate-950/80 border border-slate-800 rounded-3xl p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <CalendarCheck2 className="w-4 h-4 text-emerald-400" /> Recent Attendee Reservations
                  </h3>
                  <Link
                    to="/admin/bookings"
                    className="text-xs font-bold text-emerald-400 hover:underline flex items-center gap-1"
                  >
                    View All ({bookings.length}) <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {bookings.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">No bookings registered yet.</p>
                ) : (
                  <div className="space-y-2.5">
                    {bookings.slice(0, 5).map((b) => (
                      <div
                        key={b.id}
                        className="p-3.5 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-4 text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-white">{b.booking_reference}</span>
                            <span className="text-slate-400 font-semibold">• {b.guest_first_name} {b.guest_last_name}</span>
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            {b.property?.title || 'Hotel'} • {b.check_in} to {b.check_out} ({b.nights}N)
                          </p>
                        </div>
                        <div className="text-right space-y-1">
                          <span className="font-bold text-white block">{formatNaira(b.total_amount)}</span>
                          <StatusBadge status={b.status} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Logistics Dispatch Queue */}
              <div className="lg:col-span-4 bg-slate-950/80 border border-slate-800 rounded-3xl p-6 space-y-5">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <Truck className="w-4 h-4 text-amber-400" /> Logistics Queue
                  </h3>
                  <Link
                    to="/admin/logistics"
                    className="text-xs font-bold text-amber-400 hover:underline flex items-center gap-1"
                  >
                    All ({logistics.length}) <ArrowUpRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {logistics.length === 0 ? (
                  <p className="text-xs text-slate-500 py-6 text-center">No pending logistics requests.</p>
                ) : (
                  <div className="space-y-3">
                    {logistics.slice(0, 4).map((l) => (
                      <div key={l.id} className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-1 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-bold text-white">{l.service_name || l.type.replace(/_/g, ' ')}</span>
                          <StatusBadge status={l.status} />
                        </div>
                        <p className="text-[11px] text-slate-400 truncate">{l.pickup_location} → {l.dropoff_location}</p>
                        <p className="text-[10px] text-emerald-400">{l.arrival_date || l.request_date} at {l.arrival_time || l.request_time}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  );
};
