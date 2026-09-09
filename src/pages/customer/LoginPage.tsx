import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { CustomerLayout } from '../../components/layout/CustomerLayout';
import { useAuth } from '../../lib/authContext';
import { Building2, LogIn, AlertCircle, Loader2, Mail, Lock, CheckCircle2 } from 'lucide-react';

export const LoginPage: React.FC = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';
  const isConfirmed = searchParams.get('confirmed') === 'true';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError(null);
      const res = await signIn(email.trim(), password);
      if (res?.error) {
        setError(res.error.message);
        return;
      }
      navigate(redirect);
    } catch (err: any) {
      setError(err.message || 'Invalid email or password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <CustomerLayout>
      <div className="min-h-[80vh] flex items-center justify-center px-4 py-12 bg-[#FDFBF7]">
        <div className="max-w-md w-full bg-white rounded-3xl border border-[#EAE3D2] p-8 shadow-xl space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-[#1E7A5E] text-[#C89B3C] flex items-center justify-center mx-auto shadow-md">
              <Building2 className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-serif font-black text-[#0B1F3A]">Welcome Back</h2>
            <p className="text-xs text-slate-500">Sign in to manage your event trips and bookings</p>
          </div>

          {isConfirmed && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2 animate-fadeIn">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>Your email has been confirmed successfully! Please sign in with your credentials to access your account.</span>
            </div>
          )}

          {error && (
            <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2 animate-fadeIn">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Email Address</label>
              <div className="relative">
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 pl-9 text-xs text-slate-900 focus:ring-2 focus:ring-[#1E7A5E] outline-none"
                />
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">Password</label>
              <div className="relative">
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full bg-slate-50 border border-slate-300 rounded-xl px-3.5 py-2.5 pl-9 text-xs text-slate-900 focus:ring-2 focus:ring-[#1E7A5E] outline-none"
                />
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 px-4 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-60"
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

          <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-600">
            Don't have an account yet?{' '}
            <Link to="/signup" className="text-[#1E7A5E] font-bold hover:underline">
              Create an Account
            </Link>
          </div>
        </div>
      </div>
    </CustomerLayout>
  );
};
