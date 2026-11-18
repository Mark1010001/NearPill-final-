import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';

const pages = [
  { title: 'Find Medicines Nearby', description: 'Search for medicines at pharmacies near you and check availability before you go.', image: '/onboarding/onboarding_0.png' },
  { title: 'Browse Pharmacies', description: 'See nearby pharmacies and the medicines each one offers.', image: '/onboarding/onboarding_1.png' },
  { title: 'Order Ahead', description: 'Send an order request and track its status before you visit the pharmacy.', image: '/onboarding/onboarding_2.png' },
  { title: 'Verified Pharmacies', description: 'Only pharmacies verified by NearPill are listed in the app.', image: '/onboarding/onboarding_3.png' },
];

const KEY = 'np-onboarding-done';
export function onboardingDone(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return true; }
}
function markDone() { try { localStorage.setItem(KEY, '1'); } catch { /* storage unavailable */ } }

/** Same four intro pages as the Android app. Skip jumps to the last page; Get Started opens sign-in. */
export function OnboardingPage() {
  const [index, setIndex] = useState(0);
  const navigate = useNavigate();
  const page = pages[index]!;
  const last = index === pages.length - 1;
  return <section className="onboarding" aria-roledescription="carousel" aria-label="Welcome to NearPill">
    <div className="onboarding-skip">
      <button type="button" className="shop-text-link" onClick={() => setIndex(pages.length - 1)} hidden={last} aria-hidden={last}>Skip</button>
    </div>
    <div className="onboarding-page" role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${pages.length}`}>
      <img src={page.image} alt="" width="250" height="250" />
      <h1>{page.title}</h1>
      <p>{page.description}</p>
    </div>
    <div className="onboarding-dots" aria-hidden="true">
      {pages.map((_, dot) => <span key={dot} data-active={dot === index} />)}
    </div>
    <button type="button" className="primary onboarding-next" onClick={() => {
      if (!last) { setIndex(index + 1); return; }
      markDone();
      void navigate('/app/sign-in');
    }}>{last ? 'Get Started' : 'Next'}</button>
  </section>;
}

/** First visit only: send visitors who have not seen the intro to it. */
export function FirstVisitGate({ children }: { children: React.ReactNode }) {
  return onboardingDone() ? <>{children}</> : <Navigate to="/app/welcome" replace />;
}
