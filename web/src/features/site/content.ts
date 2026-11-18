export type FeatureId = 'map' | 'search' | 'stock' | 'pickup' | 'pay' | 'receipt' | 'assistant';

export const trustItems = [
  { id: 'verified', label: 'Verified pharmacies', text: 'Drugstores apply as partners and are reviewed by the platform team before they appear in listings.' },
  { id: 'pickup', label: 'Pickup in store', text: 'Reserve items ahead of time, choose a pickup date and collect at the pharmacy counter.' },
  { id: 'privacy', label: 'Your location stays on your device', text: 'Your location is used in your browser or phone to sort nearby drugstores. NearPill never stores it on the server.' },
] as const;

export const features: { id: FeatureId; title: string; text: string; detail: string }[] = [
  { id: 'map', title: 'Nearby Drugstores map', text: 'See open and closed Cebu City pharmacies around you, with your own location marked separately and route previews.', detail: 'Clear Open and Closed labels and the distance from you.' },
  { id: 'search', title: 'Medicine search with prices', text: 'Search by name and compare each pharmacy’s own price in pesos before you head out.', detail: 'Every listing shows its ₱ price and selling unit, such as per tablet or per box.' },
  { id: 'stock', title: 'Real stock per pharmacy', text: 'Each pharmacy keeps its own quantities and prices, so you can avoid a wasted trip.', detail: 'Works across Non-Prescriptions, Prescriptions and Non Medicines.' },
  { id: 'pickup', title: 'Order and pick up', text: 'Build a cart from one pharmacy, reserve your items and collect them when the order is ready.', detail: 'Each pharmacy has its own order, payment and pickup.' },
  { id: 'pay', title: 'Pay in full or a deposit', text: 'Pay the whole amount, or put down a deposit of at least ₱100 (or half the total, whichever is larger) and pay the rest at pickup.', detail: 'Orders of ₱100 or less are paid in full. A pharmacy order needs at least ₱100.' },
  { id: 'receipt', title: 'Pickup date and PDF receipt', text: 'Choose a pickup date in Manila time, up to a week ahead, with an optional time window, and download a PDF receipt.', detail: 'You can change the pickup date once, before the order is ready.' },
  { id: 'assistant', title: 'Ask NearPill assistant', text: 'Rule-based in-app help for searching, categories and pickup steps.', detail: 'It never diagnoses, prescribes or advises dosage. Ask a licensed pharmacist or doctor.' },
];

export const steps = [
  { title: 'Find a pharmacy', text: 'Browse the map or search for a medicine to see which nearby pharmacies list it.' },
  { title: 'Add items to cart', text: 'Review each pharmacy’s price and stock, then add items. Prescription items need a prescription approved first.' },
  { title: 'Choose a pickup date and pay', text: 'Pick a date in Manila time, then pay in full or put down a deposit.' },
  { title: 'Collect and get your receipt', text: 'Show your order reference or PDF receipt at the counter and collect your items.' },
];

export const categories = [
  { id: 'otc', title: 'Non-Prescriptions', sub: 'OTC remedies, vitamins, supplements', text: 'Everyday over-the-counter items you can reserve and check out directly.', note: 'Direct checkout', examples: ['Pain and fever tablets', 'Vitamins and minerals', 'Oral rehydration sachets'] },
  { id: 'rx', title: 'Prescriptions', sub: 'Upload doctor’s prescription', text: 'Upload a clear photo of your prescription. Staff at the pharmacy you pick review it, and checkout opens only after approval for that item.', note: 'Approval required', examples: ['Maintenance medicines', 'Antibiotics', 'Doctor-issued refills'] },
  { id: 'non', title: 'Non Medicines', sub: 'Personal care, hygiene and supplies', text: 'First-aid supplies, sanitizers, bandages and daily personal care items.', note: 'Direct checkout', examples: ['Rubbing alcohol', 'Bandages and gauze', 'Daily hygiene items'] },
];

export const partnerPoints = [
  { title: 'Manage your own stock and prices', text: 'Update quantities and ₱ prices from the Partner portal whenever a delivery arrives.' },
  { title: 'Add medicines', text: 'Send stock with the CSV template, or one medicine at a time. An admin reviews it before it goes on sale.' },
  { title: 'Handle pickup orders', text: 'See each order’s pickup date, prepare it, mark it ready and complete the handover.' },
  { title: 'Review prescriptions', text: 'Open uploaded prescriptions, then approve or reject with a reason the customer can read.' },
];

export const faqs = [
  { q: 'How does in-store pickup work?', a: 'Add items from one pharmacy to your cart, choose a pickup date and pay. When the pharmacy marks your order ready, show your order reference or PDF receipt at the counter.' },
  { q: 'Can I pay a deposit instead of the full amount?', a: 'Yes. The deposit is the larger of ₱100 or half the total, and never the whole total. You pay the balance at the pharmacy. Orders of ₱100 or less are paid in full.' },
  { q: 'How do prescription medicines work?', a: 'Prescription items need an uploaded prescription reviewed by the pharmacy you ordered from. Approval applies to that pharmacy and that item only. Bring the physical prescription when you collect.' },
  { q: 'Is my location stored or shared?', a: 'No. Your location is used on your own device to sort nearby pharmacies and preview routes. NearPill does not store it on its servers.' },
  { q: 'What is on the PDF receipt?', a: 'The order reference, the pharmacy, your items with prices in pesos, what you paid and the balance due, and your pickup date and time window.' },
  { q: 'What can Ask NearPill do?', a: 'It explains how to search, check stock, upload prescriptions and manage pickups. It does not diagnose, prescribe or give dosage advice. Please ask a licensed pharmacist or doctor.' },
  { q: 'Can I cancel an order?', a: 'You can cancel an order that has not been completed. The order page shows what applies before you confirm.' },
  { q: 'How are pharmacies listed?', a: 'Drugstores apply through Partner onboarding and are reviewed by the platform team before going live.' },
];
