import React from 'react';
import { Link } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { Building2, Search, ShieldCheck, CreditCard, Car, CheckCircle2, ChevronRight } from 'lucide-react';

export const HowItWorksPage: React.FC = () => {
  const steps = [
    {
      number: '01',
      title: 'Select Your Event Venue',
      desc: 'Start by choosing the conference centre, convention hall, or exhibition arena you are attending. Our platform anchors all accommodation searches by travel distance to that venue.',
      icon: Building2,
    },
    {
      number: '02',
      title: 'Choose a Verified Stay',
      desc: 'Browse apartments, hotels, and guest houses that have undergone physical inspection for cleanliness, security, power backup, and reliable Wi-Fi.',
      icon: ShieldCheck,
    },
    {
      number: '03',
      title: 'Bundle Airport & Local Logistics',
      desc: 'Optionally add executive airport pickup or daily venue shuttles. Enter your flight number and our team manages all driver assignments.',
      icon: Car,
    },
    {
      number: '04',
      title: 'Secure Instant NGN Payment',
      desc: 'Pay safely through Paystack with debit cards, bank transfer, or USSD. Receive instant booking vouchers, WhatsApp support, and driver contact info.',
      icon: CreditCard,
    },
  ];

  return (
    <CustomerLayout>
      <div className="bg-[#0B1F3A] text-white py-16 px-4 sm:px-6 lg:px-8 text-center">
        <div className="max-w-4xl mx-auto space-y-4">
          <span className="text-xs font-bold uppercase tracking-wider text-[#C89B3C]">
            Simple • Reliable • Verified
          </span>
          <h1 className="text-3xl sm:text-5xl font-black text-white">How TheArkRooms Works</h1>
          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            We simplify event travel logistics for attendees, corporate delegations, and conference speakers across Nigeria.
          </p>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-12">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            return (
              <div
                key={idx}
                className="bg-white rounded-3xl border border-slate-200 p-8 shadow-sm space-y-4 relative overflow-hidden"
              >
                <div className="text-4xl font-black text-slate-100 absolute top-6 right-6 select-none">
                  {step.number}
                </div>
                <div className="w-12 h-12 rounded-2xl bg-[#1E7A5E]/10 text-[#1E7A5E] flex items-center justify-center font-bold relative z-10">
                  <Icon className="w-6 h-6" />
                </div>
                <div className="space-y-2 relative z-10">
                  <h3 className="text-lg font-bold text-[#0B1F3A]">{step.title}</h3>
                  <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">{step.desc}</p>
                </div>
              </div>
            );
          })}
        </div>

        <div className="bg-emerald-50 rounded-3xl border border-emerald-200 p-8 sm:p-10 text-center space-y-4">
          <h3 className="text-xl font-bold text-[#0B1F3A]">Ready to Find Your Stay?</h3>
          <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto">
            Explore verified accommodations close to your upcoming conference or event grounds.
          </p>
          <div className="pt-2">
            <Link
              to="/search"
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-xl bg-[#C89B3C] text-slate-950 font-black text-xs uppercase tracking-wider shadow-lg hover:bg-[#d6aa4a] transition-all"
            >
              <span>Explore Stays</span> <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
