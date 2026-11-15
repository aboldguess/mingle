import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type PlanInfo } from '../api';
import { useOrg } from '../components/AppShell';

export function BillingPage() {
  const { details, reload } = useOrg();
  const [params] = useSearchParams();
  const [plans, setPlans] = useState<PlanInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const orgId = details.org.id;
  const current = details.org.effectivePlan;
  const checkout = params.get('checkout');

  useEffect(() => {
    api<{ plans: PlanInfo[] }>('/plans').then((r) => setPlans(r.plans));
    // Stripe redirects back before the webhook may have landed; refresh shortly after.
    if (checkout === 'success') setTimeout(() => void reload(), 2500);
  }, [checkout, reload]);

  const go = async (path: string, body: unknown, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(path, { body });
      window.location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const hasSubscription = Boolean(details.org.subscriptionStatus && details.org.subscriptionStatus !== 'canceled');

  return (
    <div className="stack">
      <h1>Plan &amp; billing</h1>
      {checkout === 'success' && <div className="notice">Thanks! Your subscription is being activated.</div>}
      {checkout === 'cancelled' && <div className="notice">Checkout cancelled. You have not been charged.</div>}
      {!details.billingEnabled && <div className="notice">Billing is not configured on this server yet. Add Stripe keys to enable upgrades (see docs/DEPLOYMENT.md).</div>}
      {error && <div className="error">{error}</div>}

      <div className="card row spread">
        <div>
          <div className="muted small">Current plan</div>
          <h2 style={{ margin: 0 }}>{details.limits.name}</h2>
          {details.org.subscriptionStatus && (
            <div className="small muted">
              Status: {details.org.subscriptionStatus}
              {details.org.currentPeriodEnd && ` · Renews ${new Date(details.org.currentPeriodEnd).toLocaleDateString()}`}
            </div>
          )}
        </div>
        {hasSubscription && (
          <button className="btn" disabled={busy !== null || !details.billingEnabled} onClick={() => go(`/orgs/${orgId}/billing/portal`, {}, 'portal')}>
            {busy === 'portal' ? 'Opening…' : 'Manage billing and invoices'}
          </button>
        )}
      </div>

      <div className="grid">
        {plans.map((p) => (
          <div key={p.id} className={`card plan-card ${p.id === current ? 'featured' : ''}`}>
            <h3>{p.name}</h3>
            <div className="price">${p.monthlyPriceUsd}<span className="muted small"> /host/mo</span></div>
            <ul>{p.features.map((f) => <li key={f}>{f}</li>)}</ul>
            {p.id === current ? (
              <span className="badge badge-brand">Current plan</span>
            ) : p.id === 'free' ? null : hasSubscription ? (
              <button className="btn" disabled={busy !== null || !details.billingEnabled} onClick={() => go(`/orgs/${orgId}/billing/portal`, {}, 'portal')}>Switch in billing portal</button>
            ) : (
              <button className="btn btn-primary" disabled={busy !== null || !details.billingEnabled} onClick={() => go(`/orgs/${orgId}/billing/checkout`, { plan: p.id }, p.id)}>
                {busy === p.id ? 'Redirecting…' : `Upgrade to ${p.name}`}
              </button>
            )}
          </div>
        ))}
      </div>
      <p className="small muted">Billed per member ({details.usage.members} today). Payments are processed securely by Stripe.</p>
    </div>
  );
}
