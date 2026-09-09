import React from 'react';
import { CustomerNavbar } from '../navigation/CustomerNavbar';
import { CustomerFooter } from '../navigation/CustomerFooter';
import { EnvNoticeBanner } from '../ui/EnvNoticeBanner';

interface CustomerLayoutProps {
  children: React.ReactNode;
}

export const CustomerLayout: React.FC<CustomerLayoutProps> = ({ children }) => {
  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900 font-sans selection:bg-[#1E7A5E] selection:text-white print:bg-white print:text-black">
      <div className="print:hidden">
        <EnvNoticeBanner />
        <CustomerNavbar />
      </div>
      <main className="flex-1">{children}</main>
      <div className="print:hidden">
        <CustomerFooter />
      </div>
    </div>
  );
};
