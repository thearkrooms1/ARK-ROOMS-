import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './lib/authContext';
import { ErrorBoundary } from './components/common/ErrorBoundary';

// Customer Pages
import { HomePage } from './pages/customer/HomePage';
import { SearchPage } from './pages/customer/SearchPage';
import { PropertyDetailPage } from './pages/customer/PropertyDetailPage';
import { BookingPage } from './pages/customer/BookingPage';
import { TripDetailPage } from './pages/customer/TripDetailPage';
import { MyTripsPage } from './pages/customer/MyTripsPage';
import { AirportServicesPage } from './pages/customer/AirportServicesPage';
import { HowItWorksPage } from './pages/customer/HowItWorksPage';
import { FAQsPage } from './pages/customer/FAQsPage';
import { LoginPage } from './pages/customer/LoginPage';
import { SignupPage } from './pages/customer/SignupPage';

// Admin Pages
import { AdminDashboardPage } from './pages/admin/AdminDashboardPage';
import { AdminBookingsPage } from './pages/admin/AdminBookingsPage';
import { AdminPropertiesPage } from './pages/admin/AdminPropertiesPage';
import { AdminRoomsPage } from './pages/admin/AdminRoomsPage';
import { AdminVenuesPage } from './pages/admin/AdminVenuesPage';
import { AdminCustomersPage } from './pages/admin/AdminCustomersPage';
import { AdminLogisticsPage } from './pages/admin/AdminLogisticsPage';
import { AdminPaymentsPage } from './pages/admin/AdminPaymentsPage';

// Host Pages (Phase 1)
import { HostDashboardPage } from './pages/host/HostDashboardPage';
import { HostPropertiesPage } from './pages/host/HostPropertiesPage';
import { HostBookingsPage } from './pages/host/HostBookingsPage';
import { HostProfilePage } from './pages/host/HostProfilePage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
          {/* Public & Customer Routes */}
          <Route path="/" element={<HomePage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/results" element={<SearchPage />} />
          <Route path="/property/:id" element={<PropertyDetailPage />} />
          <Route path="/book" element={<BookingPage />} />
          <Route path="/checkout" element={<BookingPage />} />
          <Route path="/trips/:id" element={<TripDetailPage />} />
          <Route path="/confirmation/:id" element={<TripDetailPage />} />
          <Route path="/booking/:id" element={<TripDetailPage />} />
          <Route path="/my-trips" element={<MyTripsPage />} />
          <Route path="/profile" element={<MyTripsPage />} />
          <Route path="/airport-services" element={<AirportServicesPage />} />
          <Route path="/logistics" element={<AirportServicesPage />} />
          <Route path="/how-it-works" element={<HowItWorksPage />} />
          <Route path="/faqs" element={<FAQsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/auth" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />

          {/* Host Portal Routes */}
          <Route path="/host" element={<HostDashboardPage />} />
          <Route path="/host/dashboard" element={<HostDashboardPage />} />
          <Route path="/host/properties" element={<HostPropertiesPage />} />
          <Route path="/host/bookings" element={<HostBookingsPage />} />
          <Route path="/host/profile" element={<HostProfilePage />} />

          {/* Admin Operations Console */}
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/overview" element={<AdminDashboardPage />} />
          <Route path="/admin/bookings" element={<AdminBookingsPage />} />
          <Route path="/admin/properties" element={<AdminPropertiesPage />} />
          <Route path="/admin/rooms" element={<AdminRoomsPage />} />
          <Route path="/admin/venues" element={<AdminVenuesPage />} />
          <Route path="/admin/customers" element={<AdminCustomersPage />} />
          <Route path="/admin/logistics" element={<AdminLogisticsPage />} />
          <Route path="/admin/payments" element={<AdminPaymentsPage />} />

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  );
}
