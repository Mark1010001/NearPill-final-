import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import type { ComponentType } from 'react';
import { Link, NavLink, useLocation } from 'react-router';
import { categories, faqs, features, partnerPoints, steps, trustItems, type FeatureId } from './content';
import { Icon, type IconName } from './icons';
import './site.css';

const featureIcon: Record<FeatureId, IconName> = { map: 'pin', search: 'search', stock: 'box', pickup: 'store', pay: 'wallet', receipt: 'receipt', assistant: 'bot' };
const trustIcon: Record<string, IconName> = { verified: 'shield', pickup: 'store', privacy: 'lock' };
const categoryIcon: Record<string, IconName> = { otc: 'pill', rx: 'file', non: 'clipboard' };

function usePage(title: string, description: string) {
  useEffect(() => {
    const previous = document.title;
    const meta = document.querySelector('meta[name="description"]');
    const previousDescription = meta?.getAttribute('content') ?? null;
    document.title = title;
    meta?.setAttribute('content', description);
    return () => {
      document.title = previous;
      if (meta && previousDescription !== null) meta.setAttribute('content', previousDescription);
    };
  }, [title, description]);
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  useEffect(() => {
    if (hash) { document.getElementById(hash.slice(1))?.scrollIntoView(); return; }
    window.scrollTo(0, 0);
  }, [pathname, hash]);
  return null;
}

function Logo() {
  return <Link to="/" className="st-logo" aria-label="NearPill home">
    <img className="st-logo-img" src="/brand-mark.png" width="36" height="36" alt="" aria-hidden="true" />
    <span>NearPill</span>
  </Link>;
}

function Header() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', close);
    return () => document.removeEventListener('keydown', close);
  }, [open]);
  return <header className="st-header">
    <div className="st-wrap st-header-row">
      <Logo />
      <nav id="st-nav" className={`st-nav${open ? ' open' : ''}`} aria-label="Main">
        <NavLink to="/features">Features</NavLink>
        <Link to="/#how-it-works">How it works</Link>
        <NavLink to="/partners">For pharmacies</NavLink>
        <Link to="/#faq">FAQ</Link>
        <NavLink to="/about">About</NavLink>
        <a className="st-btn st-btn-primary st-nav-cta" href="/app/">Open web app</a>
      </nav>
      <button type="button" className="st-menu-btn" aria-expanded={open} aria-controls="st-nav" aria-label={open ? 'Close menu' : 'Open menu'}
        onClick={() => setOpen(!open)}><Icon name={open ? 'close' : 'menu'} /></button>
    </div>
  </header>;
}

function Footer() {
  return <footer className="st-footer">
    <div className="st-wrap st-footer-grid">
      <div>
        <Logo />
        <p className="st-muted">Find nearby pharmacies, check stock and prices, and reserve for pickup in Cebu City.</p>
      </div>
      <nav aria-label="Product">
        <h2>Product</h2>
        <a href="/app/">Open web app</a>
        <Link to="/features">Features</Link>
        <Link to="/#faq">FAQ</Link>
      </nav>
      <nav aria-label="Pharmacies">
        <h2>Pharmacies</h2>
        <Link to="/partners">Partner with NearPill</Link>
        <a href="/portal">Pharmacy and admin sign in</a>
      </nav>
      <nav aria-label="Legal">
        <h2>Legal</h2>
        <Link to="/policies">Policies</Link>
        <Link to="/about">About this project</Link>
        <Link to="/contact">Contact</Link>
      </nav>
    </div>
    <div className="st-wrap st-footer-base">
      <p>NearPill capstone project, Cebu City.</p>
      <p>NearPill does not provide medical advice. Consult a licensed pharmacist or doctor.</p>
    </div>
  </footer>;
}

function Section({ id, title, intro, tone, children }: { id?: string; title: string; intro?: string; tone?: 'white'; children: ReactNode }) {
  const heading = id ? `${id}-heading` : undefined;
  return <section id={id} aria-labelledby={heading} className={`st-section${tone === 'white' ? ' st-white' : ''}`}>
    <div className="st-wrap">
      <div className="st-section-head"><h2 id={heading}>{title}</h2>{intro && <p className="st-lead">{intro}</p>}</div>
      {children}
    </div>
  </section>;
}

function PhoneMockup() {
  return <div className="st-phone" role="img" aria-label="Preview of the NearPill app: nearby drugstores on a map and a pharmacy with a medicine to add to the cart. Sample data.">
    <div className="st-phone-screen" aria-hidden="true">
      <div className="st-ph-status"><strong>9:41 AM</strong><i className="st-phone-notch" /><span>UTC+8</span></div>
      <div className="st-ph-head">
        <img className="st-logo-img" src="/brand-mark.png" width="26" height="26" alt="" />
        <div><strong>NearPill</strong><small><Icon name="pin" size={12} /> Cebu City · Sample data</small></div>
        <span className="st-ph-expand">Expand</span>
      </div>
      <div className="st-ph-search"><Icon name="search" size={16} /> Search medicines or pharmacies…</div>
      <div className="st-ph-panel">
        <div className="st-ph-panel-head"><strong>Nearby Drugstores</strong><span>3 open</span></div>
        <svg viewBox="0 0 320 110" className="st-ph-map" focusable="false">
          <rect className="st-map-bg" width="320" height="110" rx="10" />
          <path className="st-map-road" d="M0 78h320M100 0v110M220 0v110" />
          <path className="st-ph-route" d="M92 82C130 50 190 44 236 52" />
          <circle cx="42" cy="34" r="6" className="st-ph-closed-dot" />
          <circle cx="236" cy="52" r="7" className="st-ph-open-dot" />
          <circle cx="288" cy="82" r="6" className="st-ph-open-dot" />
          <circle cx="92" cy="82" r="8" className="st-map-you" />
        </svg>
      </div>
      <div className="st-ph-panel">
        <div className="st-ph-panel-head"><strong>Sample Pharmacy A</strong><em className="st-open">Open</em></div>
        <small>Fuente Osmeña · 0.6 km · Sample data</small>
        <div className="st-ph-item">
          <div><strong>Sample Paracetamol 500 mg</strong><small>₱12.00 / tablet · 48 in stock</small></div>
          <span className="st-ph-add"><Icon name="plus" size={14} /> Add</span>
        </div>
      </div>
      <div className="st-ph-nav">
        <span className="on"><Icon name="home" size={20} />Home</span>
        <span><Icon name="search" size={20} />Search</span>
        <span><Icon name="pin" size={20} />Map</span>
        <span><Icon name="receipt" size={20} />Orders</span>
        <span><Icon name="user" size={20} />Profile</span>
      </div>
    </div>
  </div>;
}

function MapCard() {
  return <div className="st-mapcard">
    <svg viewBox="0 0 520 340" role="img" aria-label="Illustration of a map with one blue marker for you and green markers for pharmacies">
      <rect className="st-map-bg" width="520" height="340" />
      <path className="st-map-water" d="M360 0h160v120c-50 20-110-10-160-30Z" />
      <path className="st-map-road" d="M0 220 160 160 330 210 520 140" />
      <path className="st-map-road" d="M120 340 180 170 250 0" />
      <path className="st-map-road" d="M330 340 340 200 420 0" />
      <path className="st-map-route" d="M200 210 270 190 340 215" />
      <g className="st-map-pin"><circle cx="150" cy="120" r="11" /><circle cx="150" cy="120" r="4" className="st-map-dot" /></g>
      <g className="st-map-pin"><circle cx="270" cy="190" r="11" /><circle cx="270" cy="190" r="4" className="st-map-dot" /></g>
      <g className="st-map-pin"><circle cx="340" cy="215" r="11" /><circle cx="340" cy="215" r="4" className="st-map-dot" /></g>
      <g className="st-map-pin"><circle cx="400" cy="120" r="11" /><circle cx="400" cy="120" r="4" className="st-map-dot" /></g>
      <circle className="st-map-you-ring" cx="200" cy="210" r="22" />
      <circle className="st-map-you" cx="200" cy="210" r="11" />
    </svg>
    <ul className="st-legend" aria-label="Map legend"><li><i className="st-dot-you" />You</li><li><i className="st-dot-ph" />Pharmacies</li></ul>
    <p className="st-note">Illustration only. The real map in the web app uses your location and live pharmacy data.</p>
  </div>;
}

function FeatureCard({ id, title, text, detail }: { id: FeatureId; title: string; text: string; detail: string }) {
  return <article className="st-card st-feature">
    <span className="st-chip"><Icon name={featureIcon[id]} /></span>
    <h3>{title}</h3>
    <p>{text}</p>
    <p className="st-detail">{detail}</p>
  </article>;
}

function Faq() {
  return <div className="st-faq">{faqs.map((item, index) => <details key={item.q} open={index === 0}>
    <summary>{item.q}</summary><p>{item.a}</p>
  </details>)}</div>;
}

function Home() {
  const [androidNote, setAndroidNote] = useState(false);
  usePage('NearPill - Find medicine at a pharmacy near you in Cebu City', 'Find nearby verified pharmacies in Cebu City, check each pharmacy’s stock and prices in pesos, and reserve items for in-store pickup with NearPill.');
  return <>
    <section aria-labelledby="hero-heading" className="st-hero">
      <div className="st-wrap st-hero-grid">
        <div>
          <p className="st-eyebrow">Cebu City · Smart Geo Drugstore Finder with AI Support</p>
          <h1 id="hero-heading">Find the medicine you need at a pharmacy near you</h1>
          <p className="st-lead">Check each pharmacy’s stock and prices in pesos before you leave home. Reserve your items online, pay in full or put down a deposit, and pick up in store.</p>
          <div className="st-actions">
            <a className="st-btn st-btn-primary st-btn-lg" href="/app/">Open web app <Icon name="arrow" size={18} /></a>
            <button type="button" className="st-btn st-btn-outline st-btn-lg" aria-expanded={androidNote} aria-controls="st-android-note" onClick={() => setAndroidNote(!androidNote)}><Icon name="phone" size={18} /> Get the Android app (coming soon)</button>
          </div>
          {androidNote && <p id="st-android-note" className="st-note" role="status">The Android app is not on the Play Store yet. Use the web app for now, or <Link to="/partners">see how pharmacies join</Link>.</p>}
          <p className="st-note">The phone preview shows <strong>Sample data</strong>. Prices are in Philippine pesos (₱) and pickup dates use Manila time (UTC+8).</p>
        </div>
        <div className="st-hero-art"><PhoneMockup /></div>
      </div>
    </section>

    <section aria-label="Platform commitments" className="st-trust">
      <div className="st-wrap st-trust-grid">
        {trustItems.map((item) => <div key={item.id} className="st-trust-item">
          <span className="st-chip"><Icon name={trustIcon[item.id]} /></span>
          <div><h2>{item.label}</h2><p>{item.text}</p></div>
        </div>)}
      </div>
    </section>

    <Section id="features" title="Built for faster, calmer pharmacy trips" intro="Everything in the website matches the Android app, so you can check stock, compare ₱ prices and prepare a pickup in one place.">
      <div className="st-split">
        <MapCard />
        <div className="st-stack">{features.slice(0, 3).map((f) => <FeatureCard key={f.id} {...f} />)}</div>
      </div>
      <div className="st-grid-4">{features.slice(3).map((f) => <FeatureCard key={f.id} {...f} />)}</div>
      <p className="st-more"><Link to="/features">Explore all features <Icon name="arrow" size={16} /></Link></p>
    </Section>

    <Section id="how-it-works" tone="white" title="How NearPill works in four steps" intro="From finding an open drugstore to collecting your order with a PDF receipt.">
      <ol className="st-steps">{steps.map((s, i) => <li key={s.title} className="st-card">
        <span className="st-step-no" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
        <h3>{s.title}</h3><p>{s.text}</p>
      </li>)}</ol>
    </Section>

    <Section id="categories" title="Three clear item categories" intro="Each listing shows whether you can check out directly or need an approved prescription first.">
      <div className="st-grid-3">{categories.map((c) => <article key={c.id} className="st-card st-category">
        <div className="st-category-top"><span className="st-chip st-chip-lg"><Icon name={categoryIcon[c.id]} /></span><span className={`st-badge${c.id === 'rx' ? ' st-badge-neutral' : ''}`}>{c.note}</span></div>
        <h3>{c.title}</h3><p className="st-sub">{c.sub}</p><p>{c.text}</p>
        <ul>{c.examples.map((e) => <li key={e}><Icon name="check" size={16} />{e}</li>)}</ul>
      </article>)}</div>
    </Section>

    <Section id="for-pharmacies" tone="white" title="Built for Cebu City pharmacies too" intro="Partner pharmacies get a portal to keep stock accurate, handle pickup orders and review prescriptions before checkout.">
      <div className="st-grid-4">{partnerPoints.map((p) => <article key={p.title} className="st-card"><h3>{p.title}</h3><p>{p.text}</p></article>)}</div>
      <p className="st-more"><Link className="st-btn st-btn-primary" to="/partners">Partner with NearPill <Icon name="arrow" size={16} /></Link></p>
    </Section>

    <Section id="faq" title="Frequently asked questions" intro="Pickup, deposits, prescriptions, location privacy and what the assistant can and cannot do."><Faq /></Section>
  </>;
}

function Features() {
  usePage('NearPill features', 'Everything NearPill offers customers and partner pharmacies: nearby map, prices, stock, pickup, deposits, receipts and an assistant.');
  return <>
    <PageHead title="Features" text="What customers and partner pharmacies can do with NearPill." />
    <Section title="For customers"><div className="st-grid-3">{features.map((f) => <FeatureCard key={f.id} {...f} />)}</div></Section>
    <Section tone="white" title="Item categories"><div className="st-grid-3">{categories.map((c) => <article key={c.id} className="st-card st-category">
      <div className="st-category-top"><span className="st-chip st-chip-lg"><Icon name={categoryIcon[c.id]} /></span><span className={`st-badge${c.id === 'rx' ? ' st-badge-neutral' : ''}`}>{c.note}</span></div>
      <h3>{c.title}</h3><p className="st-sub">{c.sub}</p><p>{c.text}</p></article>)}</div></Section>
    <Section title="For pharmacies"><div className="st-grid-4">{partnerPoints.map((p) => <article key={p.title} className="st-card"><h3>{p.title}</h3><p>{p.text}</p></article>)}</div></Section>
  </>;
}

function PageHead({ title, text }: { title: string; text: string }) {
  return <section className="st-pagehead"><div className="st-wrap"><h1>{title}</h1><p className="st-lead">{text}</p></div></section>;
}

function Partners() {
  usePage('NearPill for pharmacies', 'Join NearPill as a partner pharmacy: manage stock and prices, handle pickup orders and review prescriptions.');
  return <>
    <PageHead title="NearPill for pharmacies" text="Reach customers who are looking for medicine nearby, and run pickup orders from one portal." />
    <Section title="What you can do"><div className="st-grid-4">{partnerPoints.map((p) => <article key={p.title} className="st-card"><h3>{p.title}</h3><p>{p.text}</p></article>)}</div></Section>
    <Section tone="white" title="How to join in three steps">
      <ol className="st-steps st-steps-3">
        <li className="st-card"><span className="st-step-no" aria-hidden="true">01</span><h3>Apply</h3><p>Send your branch details to the NearPill team through the contact page.</p></li>
        <li className="st-card"><span className="st-step-no" aria-hidden="true">02</span><h3>Get reviewed</h3><p>The platform team reviews your pharmacy before it appears in customer listings.</p></li>
        <li className="st-card"><span className="st-step-no" aria-hidden="true">03</span><h3>Go live</h3><p>Sign in to the Partner portal, add your medicines and stock, and start receiving pickup orders.</p></li>
      </ol>
      <div className="st-actions"><Link className="st-btn st-btn-primary" to="/contact">Contact the team</Link><a className="st-btn st-btn-outline" href="/portal">Partner sign in</a></div>
    </Section>
  </>;
}

function About() {
  usePage('About NearPill', 'NearPill is a Cebu City capstone project: a smart geo drugstore finder with AI support for web and mobile.');
  return <>
    <PageHead title="About NearPill" text="A Cebu City capstone project: Smart Geo Drugstore Finder with AI Support and Subscription-Based Services (Web & Mobile)." />
    <Section title="What is in the project">
      <div className="st-grid-3">
        <article className="st-card"><h3>Customer app</h3><p>An Android app and this website’s web app help customers find pharmacies, search medicines and arrange pickup.</p></article>
        <article className="st-card"><h3>Pharmacy Partner portal</h3><p>Pharmacy staff manage stock and prices, prepare pickup orders and review prescriptions.</p></article>
        <article className="st-card"><h3>Platform Admin portal</h3><p>The platform team manages partners, the catalogue and platform orders.</p></article>
      </div>
      <div className="st-callout"><h3>Important</h3><p>NearPill does not provide medical advice, diagnosis or dosage guidance. The in-app assistant only explains app features and helps find listed products. Always consult a licensed pharmacist or doctor. This is a student project and is being tested; online payments are in test mode only.</p></div>
    </Section>
  </>;
}

function Contact() {
  usePage('Contact NearPill', 'How to reach the NearPill project team.');
  return <>
    <PageHead title="Contact" text="NearPill is a capstone project, so there is no public support desk yet." />
    <Section title="Get in touch">
      <div className="st-grid-3">
        <article className="st-card"><h3>Customers</h3><p>Open the web app, then use Ask NearPill in the app for help with searching, orders and pickup.</p><a className="st-btn st-btn-outline" href="/app/">Open web app</a></article>
        <article className="st-card"><h3>Pharmacies</h3><p>To become a partner, contact the project team through your school or project coordinator. Existing partners can sign in to the portal.</p><a className="st-btn st-btn-outline" href="/portal">Partner sign in</a></article>
        <article className="st-card"><h3>Policies</h3><p>Read how NearPill handles your data and what the rules are for orders and prescriptions.</p><Link className="st-btn st-btn-outline" to="/policies">View policies</Link></article>
      </div>
    </Section>
  </>;
}


interface PolicySection { id: string; title: string; body: string }
interface PolicyDocument { updated: string; status: string; sections: PolicySection[] }

function validPolicy(value: unknown): value is PolicyDocument {
  const doc = value as PolicyDocument | null;
  return !!doc && typeof doc.updated === 'string' && typeof doc.status === 'string' && Array.isArray(doc.sections) && doc.sections.length > 0
    && doc.sections.every((item) => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.body === 'string');
}

/** Reads the same /policies.json the policies page and the apps use, so the text is never duplicated here. */
function Policies() {
  usePage('NearPill policies', 'Privacy, orders and refunds, terms of use, and browser storage information for NearPill.');
  const [doc, setDoc] = useState<PolicyDocument | null>(null);
  const [failed, setFailed] = useState(false);
  const [active, setActive] = useState(0);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  function load() {
    setFailed(false);
    fetch('/policies.json').then((response) => { if (!response.ok) throw new Error('unavailable'); return response.json() as Promise<unknown>; })
      .then((value) => { if (!validPolicy(value)) throw new Error('invalid'); setDoc(value); })
      .catch(() => setFailed(true));
  }
  useEffect(load, []);

  function move(event: ReactKeyboardEvent<HTMLButtonElement>, count: number) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -active, End: count - 1 - active };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = (active + keys[event.key] + count) % count;
    setActive(next);
    tabs.current[next]?.focus();
  }

  return <>
    <PageHead title="Policies" text="How NearPill handles your data, orders and refunds. This is the prelaunch version." />
    <Section title="Service information">
      <div className="st-callout"><h3>Medical disclaimer</h3><p>NearPill does not provide medical advice. Always consult a licensed pharmacist or doctor. In a medical emergency, call 911 or go to the nearest hospital.</p></div>
      {failed && <div className="st-card st-state" role="alert"><p>The policies could not be loaded.</p><button type="button" className="st-btn st-btn-outline" onClick={load}>Try again</button></div>}
      {!doc && !failed && <p className="st-note" role="status">Loading service information…</p>}
      {doc && <div className="st-policy">
        <p className="st-note">{doc.status} Updated {doc.updated}.</p>
        <div className="st-tabs" role="tablist" aria-label="Policy sections">
          {doc.sections.map((item, index) => <button key={item.id} type="button" role="tab" id={`pt-${item.id}`} aria-selected={index === active} aria-controls={`pp-${item.id}`}
            tabIndex={index === active ? 0 : -1} ref={(node) => { tabs.current[index] = node; }} onClick={() => setActive(index)} onKeyDown={(event) => move(event, doc.sections.length)}>{item.title}</button>)}
        </div>
        {doc.sections.map((item, index) => <article key={item.id} role="tabpanel" id={`pp-${item.id}`} aria-labelledby={`pt-${item.id}`} hidden={index !== active} className="st-card st-policy-body">
          <h2>{item.title}</h2>
          {item.body.split(/\n\s*\n/).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
        </article>)}
      </div>}
    </Section>
  </>;
}

function NotFound() {
  usePage('Page not found - NearPill', 'This page could not be found.');
  return <PageHead title="Page not found" text="We could not find that page." />;
}

function Shell({ children }: { children: ReactNode }) {
  return <div className="st-root">
    <a className="st-skip" href="#st-main">Skip to content</a>
    <ScrollToTop />
    <Header />
    <main id="st-main">{children}</main>
    <Footer />
  </div>;
}

/** The landing page, shown at "/" to visitors who are not signed in. */
export function SiteLanding() {
  return <Shell><Home /></Shell>;
}

const SITE_PAGES: Record<string, ComponentType> = {
  '/': Home,
  '/features': Features,
  '/partners': Partners,
  '/about': About,
  '/contact': Contact,
  '/policies': Policies,
};

export default function SiteApp() {
  const { pathname } = useLocation();
  const Page = SITE_PAGES[pathname.replace(/\/+$/, '') || '/'] ?? NotFound;
  return <Shell><Page /></Shell>;
}
