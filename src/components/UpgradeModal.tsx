import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  KeyRound,
  Loader2,
  Plus,
  QrCode,
  Shield,
  Sparkles,
  X,
} from 'lucide-react';
import type {
  BillingPlanOption,
  LicenseKeyRecord,
  PlanId,
  UserProfile,
  VietQrOrderResponse,
} from '../types/auth.ts';
import { formatVndCurrency } from '../utils/entitlements.ts';
import { getAuthHeaders } from '../lib/supabaseClient.ts';

interface UpgradeModalProps {
  isOpen: boolean;
  reasonBanner?: string | null;
  profile: UserProfile | null;
  onClose: () => void;
  onUnlockedSuccess: (updatedProfile: UserProfile | null, msg: string) => void;
}

type ModalTab = 'vietqr' | 'license' | 'admin';

const DEFAULT_FALLBACK_PLANS: BillingPlanOption[] = [
  {
    id: 'monthly',
    name: 'Gói 1 Tháng',
    durationLabel: '30 ngày Full chức năng',
    amountVnd: 99_000,
  },
  {
    id: 'yearly',
    name: 'Gói 1 Năm',
    badge: 'Phổ biến nhất',
    durationLabel: '365 ngày Full chức năng',
    amountVnd: 599_000,
  },
  {
    id: 'lifetime',
    name: 'Mở khóa Vĩnh viễn',
    badge: 'Tiết kiệm nhất',
    durationLabel: 'Trọn đời không giới hạn',
    amountVnd: 1_290_000,
  },
];

export const UpgradeModal: React.FC<UpgradeModalProps> = ({
  isOpen,
  reasonBanner,
  profile,
  onClose,
  onUnlockedSuccess,
}) => {
  const [tab, setTab] = useState<ModalTab>('vietqr');
  const [plans, setPlans] = useState<BillingPlanOption[]>(
    DEFAULT_FALLBACK_PLANS
  );
  const [vietqrConfigured, setVietqrConfigured] = useState<boolean>(true);
  const [selectedPlanId, setSelectedPlanId] = useState<PlanId>('yearly');

  // VietQR Order state
  const [activeOrder, setActiveOrder] = useState<VietQrOrderResponse | null>(
    null
  );
  const [creatingOrder, setCreatingOrder] = useState<boolean>(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // License Redeem state
  const [licenseInput, setLicenseInput] = useState<string>('');
  const [redeeming, setRedeeming] = useState<boolean>(false);

  // Admin Key Generator state
  const [adminPlanType, setAdminPlanType] = useState<PlanId>('lifetime');
  const [adminCount, setAdminCount] = useState<number>(5);
  const [adminMaxUses, setAdminMaxUses] = useState<number>(1);
  const [adminNote, setAdminNote] = useState<string>('');
  const [adminKeys, setAdminKeys] = useState<LicenseKeyRecord[]>([]);
  const [adminBusy, setAdminBusy] = useState<boolean>(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Load server pricing on open
  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg(null);
    setActiveOrder(null);

    fetch('/api/billing/plans')
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data?.plans) && data.plans.length > 0) {
          setPlans(data.plans);
        }
        if (typeof data?.vietqrConfigured === 'boolean') {
          setVietqrConfigured(data.vietqrConfigured);
          if (!data.vietqrConfigured) setTab('license');
        }
      })
      .catch(() => {});
  }, [isOpen]);

  // Poll order status every 3s while VietQR is displayed
  useEffect(() => {
    if (!isOpen || !activeOrder) return;

    let stopped = false;
    const interval = window.setInterval(async () => {
      if (stopped) return;
      try {
        const res = await fetch(
          `/api/billing/order-status?orderCode=${encodeURIComponent(
            activeOrder.orderCode
          )}`,
          { headers: getAuthHeaders() }
        );
        if (!res.ok) return;
        const data = await res.json();
        if (data?.status === 'paid' && !stopped) {
          stopped = true;
          onUnlockedSuccess(
            data.profile || null,
            'Thanh toán VietQR thành công! Đã mở khóa Full toàn bộ chức năng CGM Studio!'
          );
          onClose();
        }
      } catch {
        // ignore transient poll error
      }
    }, 3000);

    return () => {
      stopped = true;
      window.clearInterval(interval);
    };
  }, [isOpen, activeOrder, onUnlockedSuccess, onClose]);

  // Load existing keys when Admin tab opens
  useEffect(() => {
    if (!isOpen || tab !== 'admin' || profile?.role !== 'admin') return;
    fetch('/api/admin/licenses', { headers: getAuthHeaders() })
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.licenses)) setAdminKeys(d.licenses);
      })
      .catch(() => {});
  }, [isOpen, tab, profile?.role]);

  if (!isOpen) return null;

  const copyText = (label: string, val: string) => {
    navigator.clipboard?.writeText(val);
    setCopiedField(label);
    window.setTimeout(
      () => setCopiedField((prev) => (prev === label ? null : prev)),
      2000
    );
  };

  const handleCreateVietQrOrder = async () => {
    setErrorMsg(null);
    setCreatingOrder(true);
    try {
      const res = await fetch('/api/billing/create-order', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ planId: selectedPlanId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Không thể tạo mã thanh toán VietQR.');
      }
      setActiveOrder(data as VietQrOrderResponse);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Không thể khởi tạo đơn VietQR.');
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseInput.trim()) return;
    setErrorMsg(null);
    setRedeeming(true);

    try {
      const res = await fetch('/api/billing/redeem', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({ code: licenseInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Mã kích hoạt không hợp lệ.');
      }
      setLicenseInput('');
      onUnlockedSuccess(
        data.profile || null,
        'Kích hoạt Mã VIP thành công! Tài khoản của bạn đã mở khóa Full chức năng!'
      );
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi kích hoạt mã.');
    } finally {
      setRedeeming(false);
    }
  };

  const handleGenerateAdminKeys = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setAdminBusy(true);
    try {
      const res = await fetch('/api/admin/licenses', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders(),
        },
        body: JSON.stringify({
          planType: adminPlanType,
          count: adminCount,
          maxUses: adminMaxUses,
          note: adminNote,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || 'Không thể tạo mã.');
      if (Array.isArray(data?.created)) {
        setAdminKeys((prev) => [...data.created, ...prev]);
      }
      setAdminNote('');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Lỗi tạo mã VIP.');
    } finally {
      setAdminBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Nâng cấp Mở khóa Full chức năng CGM Studio"
      className="fixed inset-0 z-50 bg-black/85 backdrop-blur-xs flex items-center justify-center p-4 select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-gradient-to-r from-amber-500/10 via-indigo-500/10 to-zinc-900">
          <div className="flex items-center gap-2.5">
            <Crown className="w-5 h-5 text-amber-400" aria-hidden="true" />
            <div>
              <h2 className="text-sm font-bold text-white">
                Mở Khóa Full Chức Năng — CGM Studio Pro
              </h2>
              <p className="text-[11px] text-zinc-400">
                Không giới hạn số lượng xuất · Ghép Đa Logo · Kéo-thả tự do · AI lọc ảnh lỗi
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng bảng nâng cấp"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Contextual Reason Banner when triggered from a locked feature */}
          {reasonBanner && (
            <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/35 text-xs text-amber-200 flex items-center gap-2.5">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
              <span>{reasonBanner}</span>
            </div>
          )}

          {/* Free vs Pro Quick Benefits */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
            <div className="p-3 rounded-xl bg-zinc-950 border border-zinc-800 space-y-1.5">
              <div className="font-semibold text-zinc-400">
                Tài khoản Thường (Hiện tại)
              </div>
              <ul className="space-y-1 text-[11px] text-zinc-500">
                <li>• Xuất tối đa 20 ảnh / lượt (2048px)</li>
                <li>• Chỉ ghép tối đa 1 Logo cố định</li>
                <li>• Khóa kéo-thả Logo tự do &amp; Bộ Logo mẫu</li>
                <li>• Khóa AI lọc ảnh lỗi &amp; đổi tên tùy chỉnh</li>
              </ul>
            </div>

            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 space-y-1.5">
              <div className="font-semibold text-emerald-300 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                <span>Tài khoản Mở khóa Full (Pro)</span>
              </div>
              <ul className="space-y-1 text-[11px] text-zinc-200">
                <li>• Xuất không giới hạn hàng nghìn ảnh &amp; video</li>
                <li>• Ghép Đa Logo không giới hạn + Kéo-thả tự do</li>
                <li>• Xuất Độ phân giải gốc 100%, 4K, PNG, giữ EXIF</li>
                <li>• Mở khóa Gemini AI lọc ảnh lỗi &amp; đổi tên mẫu</li>
              </ul>
            </div>
          </div>

          {/* Method Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-zinc-950 rounded-xl border border-zinc-800">
            <button
              type="button"
              onClick={() => {
                setTab('vietqr');
                setErrorMsg(null);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                tab === 'vietqr'
                  ? 'bg-indigo-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" />
              <span>Thanh toán tự động VietQR</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setTab('license');
                setErrorMsg(null);
              }}
              className={`flex-1 py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                tab === 'license'
                  ? 'bg-emerald-600 text-white'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Nhập Mã Kích Hoạt</span>
            </button>

            {profile?.role === 'admin' && (
              <button
                type="button"
                onClick={() => {
                  setTab('admin');
                  setErrorMsg(null);
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer transition-colors ${
                  tab === 'admin'
                    ? 'bg-amber-600 text-white'
                    : 'text-amber-300/80 hover:text-amber-200'
                }`}
              >
                <Shield className="w-3.5 h-3.5" />
                <span>Tạo Mã VIP</span>
              </button>
            )}
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/35 text-xs text-rose-200 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* TAB 1: AUTOMATIC VIETQR */}
          {tab === 'vietqr' && (
            <div className="space-y-4">
              {!activeOrder ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                    {plans.map((p) => {
                      const selected = selectedPlanId === p.id;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPlanId(p.id)}
                          className={`relative p-3.5 rounded-xl border text-left transition-colors cursor-pointer ${
                            selected
                              ? 'bg-indigo-500/15 border-indigo-500 text-white ring-1 ring-indigo-500/40'
                              : 'bg-zinc-950 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                          }`}
                        >
                          {p.badge && (
                            <span className="inline-block mb-1.5 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-semibold">
                              {p.badge}
                            </span>
                          )}
                          <div className="text-xs font-bold">{p.name}</div>
                          <div className="text-base font-bold font-mono text-indigo-300 mt-1">
                            {formatVndCurrency(p.amountVnd)}
                          </div>
                          <div className="text-[11px] text-zinc-400 mt-0.5">
                            {p.durationLabel}
                          </div>
                        </button>
                      );
                    })}
                  </div>

                  <button
                    type="button"
                    disabled={creatingOrder || !vietqrConfigured}
                    onClick={handleCreateVietQrOrder}
                    className="w-full py-3 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-45 text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer shadow-sm"
                  >
                    {creatingOrder ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Đang tạo mã QR chuyển khoản...</span>
                      </>
                    ) : (
                      <>
                        <QrCode className="w-4 h-4" />
                        <span>
                          Tạo mã VietQR &amp; Mở khóa tự động sau 3 giây
                        </span>
                      </>
                    )}
                  </button>
                </>
              ) : (
                <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 grid grid-cols-1 sm:grid-cols-12 gap-5 items-center">
                  <div className="sm:col-span-5 flex flex-col items-center">
                    <div className="bg-white p-2.5 rounded-xl shadow-md">
                      <img
                        src={activeOrder.qrImageUrl}
                        alt={`VietQR ${activeOrder.orderCode}`}
                        className="w-48 h-48 object-contain"
                      />
                    </div>
                    <span className="text-[11px] text-emerald-400 flex items-center gap-1.5 mt-2.5 font-medium">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Đang chờ xác nhận tự động...</span>
                    </span>
                  </div>

                  <div className="sm:col-span-7 space-y-2.5 text-xs">
                    <div className="text-zinc-300 font-semibold">
                      Quét mã QR bằng bất kỳ App Ngân hàng nào:
                    </div>

                    <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Ngân hàng:</span>
                        <span className="font-semibold text-zinc-100">
                          {activeOrder.bankId}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Chủ tài khoản:</span>
                        <span className="font-semibold text-zinc-100">
                          {activeOrder.accountName}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Số tài khoản:</span>
                        <button
                          type="button"
                          onClick={() =>
                            copyText('acc', activeOrder.accountNo)
                          }
                          className="font-mono font-semibold text-indigo-300 hover:text-white flex items-center gap-1 cursor-pointer"
                        >
                          <span>{activeOrder.accountNo}</span>
                          {copiedField === 'acc' ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-zinc-400">Số tiền:</span>
                        <span className="font-mono font-bold text-emerald-300">
                          {formatVndCurrency(activeOrder.amountVnd)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-zinc-800">
                        <span className="text-zinc-400">
                          Nội dung CK (bắt buộc):
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            copyText('memo', activeOrder.orderCode)
                          }
                          className="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-500/40 font-mono font-bold text-amber-300 flex items-center gap-1 cursor-pointer"
                        >
                          <span>{activeOrder.orderCode}</span>
                          {copiedField === 'memo' ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                        </button>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveOrder(null)}
                      className="text-[11px] text-zinc-400 hover:text-white underline cursor-pointer"
                    >
                      ← Chọn gói thời hạn khác
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: REDEEM LICENSE KEY */}
          {tab === 'license' && (
            <form onSubmit={handleRedeemCode} className="space-y-3.5">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                <label className="text-xs font-semibold text-zinc-200 block">
                  Nhập Mã Kích Hoạt (License Key / VIP Code)
                </label>
                <input
                  type="text"
                  required
                  value={licenseInput}
                  onChange={(e) =>
                    setLicenseInput(e.target.value.toUpperCase())
                  }
                  placeholder="VD: CGM-VIP-ABCD-1234"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-800 text-sm font-mono tracking-wider text-emerald-300 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 uppercase"
                />
                <p className="text-[11px] text-zinc-400">
                  Sau khi nhập mã hợp lệ, tài khoản{' '}
                  <strong className="text-zinc-200">{profile?.email}</strong> sẽ
                  được kích hoạt mở khóa Full chức năng ngay lập tức.
                </p>
              </div>

              <button
                type="submit"
                disabled={redeeming || !licenseInput.trim()}
                className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-45 text-white font-semibold text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                {redeeming ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Đang kiểm tra &amp; kích hoạt...</span>
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    <span>Kích hoạt Mở khóa Full ngay</span>
                  </>
                )}
              </button>
            </form>
          )}

          {/* TAB 3: ADMIN LICENSE GENERATOR */}
          {tab === 'admin' && profile?.role === 'admin' && (
            <div className="space-y-4">
              <form
                onSubmit={handleGenerateAdminKeys}
                className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3 text-xs"
              >
                <div className="font-semibold text-amber-300">
                  Tạo nhanh Mã Kích Hoạt VIP cho khách hàng
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Thời hạn mã
                    </label>
                    <select
                      value={adminPlanType}
                      onChange={(e) =>
                        setAdminPlanType(e.target.value as PlanId)
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200"
                    >
                      <option value="lifetime">Vĩnh viễn</option>
                      <option value="yearly">1 Năm (365 ngày)</option>
                      <option value="monthly">1 Tháng (30 ngày)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Số lượng mã tạo
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={adminCount}
                      onChange={(e) =>
                        setAdminCount(Number(e.target.value) || 1)
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-zinc-200"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1">
                      Lượt dùng / 1 mã
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={adminMaxUses}
                      onChange={(e) =>
                        setAdminMaxUses(Number(e.target.value) || 1)
                      }
                      className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 font-mono text-zinc-200"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="Ghi chú khách hàng / sự kiện (tùy chọn)..."
                    className="flex-1 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-zinc-200 placeholder-zinc-500"
                  />
                  <button
                    type="submit"
                    disabled={adminBusy}
                    className="px-3.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold flex items-center gap-1 cursor-pointer shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tạo mã</span>
                  </button>
                </div>
              </form>

              {adminKeys.length > 0 && (
                <div className="max-h-44 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 divide-y divide-zinc-800/80 text-xs">
                  {adminKeys.map((k) => (
                    <div
                      key={k.code}
                      className="px-3 py-2 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <span className="font-mono font-semibold text-emerald-300">
                          {k.code}
                        </span>
                        <span className="text-[11px] text-zinc-500 ml-2">
                          ({k.plan_type} · đã dùng {k.used_count}/{k.max_uses})
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => copyText(k.code, k.code)}
                        className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-[11px] text-zinc-300 flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        {copiedField === k.code ? (
                          <>
                            <Check className="w-3 h-3 text-emerald-400" />
                            <span>Đã chép</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3 h-3" />
                            <span>Sao chép</span>
                          </>
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
