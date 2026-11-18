import type { SubscriptionPlan } from '../api/types';

/** What each subscription plan includes. The plan list itself comes from the server. */
export function PlanCards({ plans, current }: { plans: SubscriptionPlan[]; current?: string }) {
  return <div className="plan-grid" role="list" aria-label="Subscription plans">
    {plans.map((plan) => <article key={plan.tier} className={`plan-card${current === plan.tier ? ' plan-current' : ''}`} role="listitem">
      <h3>{plan.tier}{current === plan.tier && <span className="plan-badge">Current plan</span>}</h3>
      <p className="section-hint">{plan.summary}</p>
      {plan.partnershipMonths ? <p className="section-hint"><strong>Partnership length:</strong> {plan.partnershipMonths === 12 ? '1 year' : `${plan.partnershipMonths} months`}</p> : null}
      <ul>{plan.features.map((feature) => <li key={feature}>{feature}</li>)}</ul>
    </article>)}
  </div>;
}
