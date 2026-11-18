const TECHNICAL_JARGON_PATTERN =
  /\b(api[_\s-]?key|gemini_api_key|google_api_key|supabase|postgres|sql|schema|\.env|vercel|http\s*\d{3}|status\s*\d{3}|offscreencanvas|worker|proxy|rpc|jwt|token|bearer|client\s*id|client\s*secret|vietqr_bank|stack|undefined|null|exception|fetch)\b/i;

/**
 * Converts any backend, network, or third-party auth error into a clean,
 * non-technical Vietnamese message suitable for end-users / customers.
 */
export function toUserFriendlyError(
  err: unknown,
  fallback = 'Hệ thống đang tạm thời gián đoạn. Vui lòng thử lại sau ít phút.'
): string {
  const raw =
    typeof err === 'string'
      ? err.trim()
      : err && typeof (err as any).message === 'string'
      ? String((err as any).message).trim()
      : '';

  if (!raw) return fallback;

  const lower = raw.toLowerCase();

  // Map common English Auth / Network errors to natural Vietnamese
  if (lower.includes('invalid login credentials')) {
    return 'Email hoặc mật khẩu không chính xác.';
  }
  if (lower.includes('email not confirmed')) {
    return 'Tài khoản chưa được xác nhận Email. Vui lòng kiểm tra hộp thư đến (hoặc mục Thư rác).';
  }
  if (
    lower.includes('user already registered') ||
    lower.includes('already been registered')
  ) {
    return 'Email này đã có tài khoản. Vui lòng chuyển sang mục Đăng nhập.';
  }
  if (lower.includes('password should be at least')) {
    return 'Mật khẩu cần có ít nhất 6 ký tự.';
  }
  if (
    lower.includes('rate limit') ||
    lower.includes('too many requests') ||
    lower.includes('for security purposes')
  ) {
    return 'Bạn vừa thao tác quá nhiều lần liên tiếp. Vui lòng đợi ít phút rồi thử lại.';
  }
  if (
    lower.includes('unable to validate email') ||
    lower.includes('invalid format') ||
    lower.includes('is invalid')
  ) {
    return 'Địa chỉ Email không hợp lệ. Vui lòng kiểm tra lại.';
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('load failed') ||
    lower.includes('network request failed')
  ) {
    return 'Kết nối mạng bị gián đoạn. Vui lòng kiểm tra Internet và thử lại.';
  }
  if (lower.includes('unsupported provider')) {
    return 'Phương thức đăng nhập này hiện đang tạm bảo trì. Vui lòng dùng Email và mật khẩu.';
  }

  // Strip any accidental developer / server / env / HTTP jargon
  if (TECHNICAL_JARGON_PATTERN.test(raw)) {
    return fallback;
  }

  return raw;
}
