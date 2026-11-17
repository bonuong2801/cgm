import {
  getServerBillingPlans,
  getVietQrBankConfig,
  jsonApi,
} from '../_lib/supabaseAdmin.ts';

export async function GET(): Promise<Response> {
  const plansMap = getServerBillingPlans();
  const bank = getVietQrBankConfig();

  return jsonApi({
    plans: [plansMap.monthly, plansMap.yearly, plansMap.lifetime],
    vietqrConfigured: bank.configured,
  });
}

export default { fetch: GET };
