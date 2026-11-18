import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Crown,
  KeyRound,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Sparkles,
  Stamp,
  UserPlus,
} from 'lucide-react';
import {
  supabase,
  supabaseProjectUrl,
  supabasePublishableKey,
} from '../lib/supabaseClient.ts';

type AuthTab = 'login' | 'register' | 'forgot';

export const AuthGateScreen: React.FC<{ isSupabaseConfigured: boolean }> = ({
  isSupabaseConfigured,
}) => {
  const [tab, setTab] = useState<AuthTab>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  // Auto-detect whether Google OAuth is enabled on Supabase Auth settings
  useEffect(() => {
    if (!isSupabaseConfigured || !supabaseProjectUrl || !supabasePublishableKey) {
      return;
    }
    let active = true;
    fetch(`${supabaseProjectUrl}/auth/v1/settings`, {
      headers: { apikey: supabasePublishableKey },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.external) {
          setGoogleEnabled(Boolean(data.external.google));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isSupabaseConfigured]);

  if (!isSupabaseConfigured || !supabase) {
    return (
      <div className="min-h-screen w-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-6 select-none">
        <div className="max-w-lg w-full bg-zinc-900 border border-zinc-800 rounded-2xl p-7 shadow-2xl space-y-5">
          <div className="flex items-center gap-3">
            <img
              src="/logo-cgm.png"
              alt="CGM Studio"
              className="w-11 h-11 rounded-xl border border-zinc-800 object-cover"
            />
            <div>
              <h1 className="text-base font-bold text-zinc-100">
                Cấu hình Cổng Đăng Nhập Supabase — CGM Studio
              </h1>
              <p className="text-xs text-zinc-400">
                Hoàn tất 3 bước ngắn bên dưới để kích hoạt Đăng nhập &amp; Phân cấp Tài khoản
              </p>
            </div>
          </div>

          <ol className="space-y-3 text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-xl p-4 list-decimal list-inside leading-relaxed">
            <li>
              Tạo project trên <strong>Supabase</strong>, mở mục{' '}
              <code className="text-indigo-300">SQL Editor</code> và chạy toàn bộ file{' '}
              <code className="text-emerald-300">supabase/schema.sql</code>.
            </li>
            <li>
              Sao chép <code className="text-indigo-300">Project URL</code>,{' '}
              <code className="text-indigo-300">anon public key</code> và{' '}
              <code className="text-indigo-300">service_role key</code> từ mục{' '}
              <strong>Project Settings → API</strong>.
            </li>
            <li>
              Điền vào file <code className="text-emerald-300">.env</code> (theo mẫu{' '}
              <code className="text-zinc-400">.env.example</code>) rồi khởi động lại{' '}
              <code className="text-indigo-300">npm run dev</code>.
            </li>
          </ol>
        </div>
      </div>
    );
  }

  const handleGoogleSignIn = async () => {
    if (!supabase) return;
    setErrorMsg(null);
    setInfoMsg(null);

    if (!googleEnabled) {
      setErrorMsg(
        'Đăng nhập Google chưa được bật Client ID & Client Secret trong Supabase Dashboard (Authentication → Providers → Google).'
      );
      return;
    }

    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin,
      },
    });
    if (error) {
      setErrorMsg(error.message);
      setSubmitting(false);
    }
  };

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase) return;
    setErrorMsg(null);
    setInfoMsg(null);
    setSubmitting(true);

    try {
      const trimmedEmail = email.trim();
      if (tab === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (error) {
          throw new Error(
            error.message.includes('Invalid login credentials')
              ? 'Email hoặc mật khẩu không chính xác.'
              : error.message
          );
        }
      } else if (tab === 'register') {
        if (password.length < 6) {
          throw new Error('Mật khẩu phải có ít nhất 6 ký tự.');
        }
        const { data, error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            data: { full_name: fullName.trim() },
          },
        });
        if (error) throw error;
        if (!data.session) {
          setInfoMsg(
            'Đăng ký thành công! Vui lòng kiểm tra hộp thư Email để xác nhận tài khoản trước khi đăng nhập.'
          );
          setTab('login');
        }
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(
          trimmedEmail,
          { redirectTo: window.location.origin }
        );
        if (error) throw error;
        setInfoMsg(
          'Đã gửi liên kết đặt lại mật khẩu tới Email của bạn. Vui lòng kiểm tra hộp thư.'
        );
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể xử lý yêu cầu đăng nhập.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4 sm:p-8 select-none">
      <div className="max-w-4xl w-full grid grid-cols-1 lg:grid-cols-12 bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-2xl">
        {/* Left Feature Showcase Column */}
        <div className="lg:col-span-6 p-7 sm:p-9 bg-zinc-950/75 border-b lg:border-b-0 lg:border-r border-zinc-800 flex flex-col justify-between space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <img
                src="/logo-cgm.png"
                alt="CGM Studio Logo"
                className="w-11 h-11 rounded-xl border border-zinc-800 object-cover shadow-md"
              />
              <div>
                <span className="text-lg font-bold tracking-tight text-white block">
                  CGM Studio
                </span>
                <span className="text-xs text-zinc-400">
                  Nền tảng Lọc, Chỉnh màu &amp; Ghép Đa Logo Sự Kiện Tốc Độ Cao
                </span>
              </div>
            </div>

            <div className="space-y-3 pt-2 text-xs text-zinc-300">
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800/80">
                <Stamp className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-zinc-100">
                    Ghép Đa Logo &amp; Kéo-thả Tự do
                  </div>
                  <p className="text-zinc-400 mt-0.5 leading-relaxed">
                    Đóng dấu đồng thời Logo Ban tổ chức, Nhà tài trợ &amp; Studio với kích thước tỷ lệ thông minh.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-zinc-900/90 border border-zinc-800/80">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold text-zinc-100">
                    AI Lọc Ảnh Lỗi &amp; Xuất 4 Luồng Siêu Tốc
                  </div>
                  <p className="text-zinc-400 mt-0.5 leading-relaxed">
                    Tự động phát hiện ảnh nhắm mắt, rung nhòe và xuất hàng nghìn ảnh độ phân giải gốc qua OffscreenCanvas.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/25 flex items-center gap-3 text-xs">
            <Crown className="w-5 h-5 text-amber-400 shrink-0" />
            <div className="text-zinc-300 leading-relaxed">
              Đăng nhập miễn phí để bắt đầu ngay. Hỗ trợ nâng cấp{' '}
              <strong className="text-amber-300">Mở khóa Full chức năng</strong>{' '}
              qua VietQR tự động hoặc Mã Kích Hoạt VIP.
            </div>
          </div>
        </div>

        {/* Right Login / Sign-up Form Column */}
        <div className="lg:col-span-6 p-7 sm:p-9 flex flex-col justify-center space-y-5">
          {/* Tab Switcher */}
          <div className="grid grid-cols-2 gap-1 p-1 bg-zinc-950 rounded-xl border border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                tab === 'login'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Đăng nhập
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setErrorMsg(null);
                setInfoMsg(null);
              }}
              className={`py-2 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                tab === 'register'
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Đăng ký tài khoản mới
            </button>
          </div>

          {/* Google OAuth 1-Click */}
          <button
            type="button"
            disabled={submitting}
            onClick={handleGoogleSignIn}
            className="w-full py-2.5 px-4 rounded-xl bg-white hover:bg-zinc-100 text-zinc-900 font-semibold text-xs flex items-center justify-center gap-2.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.79-.07-1.54-.19-2.27h-11.3v4.51h6.47c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.54-5.17 3.54-8.97z"
              />
              <path
                fill="#34A853"
                d="M12.255 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96h-4.01v3.14C3.515 21.3 7.615 24 12.255 24z"
              />
              <path
                fill="#FBBC05"
                d="M5.535 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62h-4.01C.705 8.24.255 10.06.255 12s.45 3.76 1.27 5.38l4.01-3.14z"
              />
              <path
                fill="#EA4335"
                d="M12.255 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C18.205 1.19 15.495 0 12.255 0 7.615 0 3.515 2.7 1.525 6.62l4.01 3.14c.95-2.85 3.6-4.96 6.72-4.96z"
              />
            </svg>
            <span>Tiếp tục nhanh bằng tài khoản Google</span>
          </button>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-zinc-800 w-full" />
            <span className="bg-zinc-900 px-3 text-[11px] text-zinc-500 whitespace-nowrap">
              hoặc dùng Email
            </span>
            <div className="border-t border-zinc-800 w-full" />
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {infoMsg && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/35 text-xs text-emerald-200 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>{infoMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmitForm} className="space-y-3.5">
            {tab === 'register' && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-zinc-300 block">
                  Tên hiển thị / Tên Studio
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="VD: Minh Vũ Studio"
                  className="w-full px-3.5 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-indigo-500"
                />
              </div>
            )}

            <div className="space-y-1">
              <label className="text-xs font-medium text-zinc-300 block">
                Địa chỉ Email
              </label>
              <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl px-3 focus-within:border-indigo-500">
                <Mail className="w-4 h-4 text-zinc-500 mr-2 shrink-0" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="studio@domain.com"
                  className="w-full py-2 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
                />
              </div>
            </div>

            {tab !== 'forgot' && (
              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-zinc-300">
                    Mật khẩu
                  </label>
                  {tab === 'login' && (
                    <button
                      type="button"
                      onClick={() => {
                        setTab('forgot');
                        setErrorMsg(null);
                      }}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 cursor-pointer"
                    >
                      Quên mật khẩu?
                    </button>
                  )}
                </div>
                <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl px-3 focus-within:border-indigo-500">
                  <Lock className="w-4 h-4 text-zinc-500 mr-2 shrink-0" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Tối thiểu 6 ký tự"
                    className="w-full py-2 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
                  />
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-sm disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Đang xử lý...</span>
                </>
              ) : tab === 'login' ? (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Đăng nhập vào CGM Studio</span>
                </>
              ) : tab === 'register' ? (
                <>
                  <UserPlus className="w-4 h-4" />
                  <span>Tạo tài khoản miễn phí</span>
                </>
              ) : (
                <>
                  <KeyRound className="w-4 h-4" />
                  <span>Gửi link khôi phục mật khẩu</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};
