import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CustomerLayout } from '../components/layout/CustomerLayout';
import { useAuth } from '../lib/authContext';
import {
  Building2,
  Lock,
  Mail,
  User,
  Phone,
  AlertCircle,
  Loader2,
  CheckCircle2,
  RotateCw,
  LogIn,
  Inbox,
  HelpCircle,
  ShieldCheck,
  ArrowLeft,
} from 'lucide-react';

export const SignUpPage: React.FC = () => {
  const navigate = useNavigate();
  const { signUp, resendVerification } = useAuth();

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('Nigeria');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Email confirmation state
  const [verificationRequired, setVerificationRequired] = useState(false);
  const [submittedEmail, setSubmittedEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [cooldownSeconds, setCooldownSeconds] = useState(0);
  const [resendStatus, setResendStatus] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Cooldown countdown timer for rate limiting email resend
  useEffect(() => {
    if (cooldownSeconds <= 0) return;
    const timer = setInterval(() => {
      setCooldownSeconds((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldownSeconds]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    try {
      setSubmitting(true);
      setError(null);
      setResendStatus(null);

      const res = await signUp({
        fullName: fullName.trim(),
        email: email.trim(),
        phone: phone.trim(),
        country: country.trim() || 'Nigeria',
        password,
      });

      if (res.error) {
        setError(res.error.message);
        return;
      }

      if (res.requiresVerification) {
        setSubmittedEmail(email.trim());
        setVerificationRequired(true);
        setCooldownSeconds(60); // 60s cooldown for email rate limit safety
        return;
      }

      // If active session was immediately granted (e.g. dev mode or email confirmation disabled)
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleResend = async () => {
    if (resending || cooldownSeconds > 0 || !submittedEmail) return;

    try {
      setResending(true);
      setResendStatus(null);

      const res = await resendVerification(submittedEmail);
      if (res.error) {
        setResendStatus({
          type: 'error',
          message: res.error.message,
        });
      } else {
        setResendStatus({
          type: 'success',
          message: 'A new confirmation email has been dispatched. Please check your inbox.',
        });
        setCooldownSeconds(60);
      }
    } catch (err: any) {
      setResendStatus({
        type: 'error',
        message: err?.message || 'Failed to resend confirmation email. Please try again.',
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <CustomerLayout>
      <div className="flex-1 flex items-center justify-center p-6 bg-[#FDFBF7] min-h-[80vh]">
        <div className="max-w-md w-full bg-white border border-[#EAE3D2] rounded-3xl p-8 shadow-xl space-y-6">
          {verificationRequired ? (
            /* Dedicated "Check your email" confirmation state */
            <div className="space-y-6 text-center animate-fadeIn">
              <div className="w-16 h-16 rounded-3xl bg-[#1E7A5E]/10 border border-[#1E7A5E]/20 text-[#1E7A5E] flex items-center justify-center mx-auto shadow-sm">
                <Mail className="w-8 h-8 text-[#1E7A5E]" />
              </div>

              <div className="space-y-2">
                <h2 className="text-2xl font-serif font-black text-[#0B1F3A]">
                  Check your email
                </h2>
                <p className="text-xs text-slate-600 leading-relaxed">
                  We've sent a registration link to
                </p>
                <div className="p-3 bg-[#FDFBF7] border border-[#EAE3D2] rounded-2xl flex items-center justify-center gap-2 text-xs font-bold text-[#0B1F3A] break-all shadow-inner">
                  <Mail className="w-4 h-4 text-[#C89B3C] shrink-0" />
                  <span>{submittedEmail}</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed pt-1">
                  Please open your email and click the confirmation link to activate your account.
                </p>
              </div>

              {/* Supporting Instructions Checklist */}
              <div className="text-left bg-slate-50 border border-slate-200/80 rounded-2xl p-4 space-y-2.5 text-xs text-slate-600">
                <div className="flex items-start gap-2.5">
                  <Inbox className="w-4 h-4 text-[#1E7A5E] shrink-0 mt-0.5" />
                  <span>Check your inbox for the confirmation email from <strong>TheArk Rooms</strong>.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <HelpCircle className="w-4 h-4 text-[#C89B3C] shrink-0 mt-0.5" />
                  <span>Check your <strong>Spam, Junk, or Promotions</strong> folder if it is not visible.</span>
                </div>
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="w-4 h-4 text-[#0B1F3A] shrink-0 mt-0.5" />
                  <span>You must click the confirmation link before signing in to your account.</span>
                </div>
              </div>

              {/* Resend Status Message */}
              {resendStatus && (
                <div
                  className={`p-3.5 rounded-xl text-xs flex items-start gap-2 text-left ${
                    resendStatus.type === 'success'
                      ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                      : 'bg-rose-50 border border-rose-200 text-rose-800'
                  }`}
                >
                  {resendStatus.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{resendStatus.message}</span>
                </div>
              )}

              {/* Actions */}
              <div className="space-y-3 pt-2">
                <Link
                  to="/login"
                  className="w-full py-3.5 px-4 rounded-xl bg-[#0B1F3A] hover:bg-[#1E7A5E] text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <LogIn className="w-4 h-4 text-[#C89B3C]" />
                  <span>Back to Sign In</span>
                </Link>

                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending || cooldownSeconds > 0}
                  className="w-full py-3 px-4 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold text-xs transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {resending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-[#1E7A5E]" />
                      <span>Resending confirmation email...</span>
                    </>
                  ) : (
                    <>
                      <RotateCw className="w-3.5 h-3.5 text-[#1E7A5E]" />
                      <span>
                        {cooldownSeconds > 0
                          ? `Resend confirmation email (${cooldownSeconds}s)`
                          : 'Resend confirmation email'}
                      </span>
                    </>
                  )}
                </button>

                <div className="pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setVerificationRequired(false);
                      setResendStatus(null);
                    }}
                    className="text-xs text-slate-500 hover:text-[#1E7A5E] font-medium transition-colors cursor-pointer flex items-center justify-center gap-1 mx-auto"
                  >
                    <ArrowLeft className="w-3 h-3" />
                    <span>Wrong email? Edit registration details</span>
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Registration Form */
            <>
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-[#1E7A5E] flex items-center justify-center text-white mx-auto shadow-md">
                  <Building2 className="w-6 h-6" />
                </div>
                <h1 className="text-2xl font-serif font-black text-[#1E2D2F]">
                  Create Attendee Account
                </h1>
                <p className="text-xs text-slate-500">
                  Access preferential event hotel rates &amp; coordinated ground logistics.
                </p>
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Full Name *
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="e.g. Adebayo Okonkwo"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white pl-10"
                    />
                    <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Email Address *
                  </label>
                  <div className="relative">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="adebayo@example.com"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white pl-10"
                    />
                    <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3.5" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Phone Number *
                    </label>
                    <div className="relative">
                      <input
                        type="tel"
                        required
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="+234 800 000"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white pl-3.5"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Country *
                    </label>
                    <input
                      type="text"
                      required
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-xs font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#1E7A5E] focus:bg-white"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Password *
                  </label>
                  <div className="relative">
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 6 characters"
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
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <>
                      <User className="w-4 h-4 text-[#C89B3C]" />
                      <span>Register Account</span>
                    </>
                  )}
                </button>
              </form>

              <div className="pt-4 border-t border-slate-100 text-center text-xs text-slate-500">
                Already registered?{' '}
                <Link to="/login" className="text-[#1E7A5E] font-bold hover:underline">
                  Sign In Here
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </CustomerLayout>
  );
};
