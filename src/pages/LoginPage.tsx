import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { useAuth } from '../lib/authContext';
import { Building2, Lock, Mail, AlertCircle, Loader2, LogIn, CheckCircle2 } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [urlParams] = useSearchParams();
  const redirectUrl = urlParams.get('redirect') || '/';
  const isConfirmed = urlParams.get('confirmed') === 'true';
  const navigate = useNavigate();
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { error: err } = await signIn(email.trim(), password);
    if (err) {
      setError(err.message);
      setSubmitting(false);
    } else {
      navigate(redirectUrl);
    }
  };

  return (
    <CustomerLayout>
      <div className="flex-1 flex items-center justify-center p-6 bg-[#FDFBF7] min-h-[80vh]">
        <div className="max-w-md w-full bg-white border border-[#EAE3D2] rounded-3xl p-8 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[#1E7A5E] flex items-center justify-center text-white mx-auto shadow-md">
              <Building2 className="w-6 h-6" />
            </div>
            <h1 className="text-2xl font-serif font-black text-[#1E2D2F]">
              Welcome Back
            </h1>
            <p className="text-xs text-slate-500">
              Sign in to manage your event bookings &amp; ground logistics vouchers.
            </p>
          </div>

          {isConfirmed && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Your email has been confirmed successfully! Please sign in with your credentials to access your account.</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Email Address
              </label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white pl-10"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Password
              </label>
              <div className="relative">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white pl-10"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 px-4 rounded-xl bg-[#1E7A5E] hover:bg-[#155642] text-white font-bold text-xs shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Signing In...</span>
                </>
              ) : (
                <>
                  <LogIn className="w-4 h-4 text-[#C89B3C]" />
                  <span>Sign In to Account</span>
                </>
              )}
            </button>
          </form>

          <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
            Don't have an account?{' '}
            <Link to="/signup" className="text-[#1E7A5E] font-bold hover:underline">
              Create an Account
            </Link>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
