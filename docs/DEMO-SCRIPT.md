# NearPill demo script (about 10 minutes)

Before: run START-SERVICES.bat, run MIGRATE-STAGING.bat once (applies 0031), open http://127.0.0.1:5173/app/ and have the Android phone ready. Use test accounts only.

## A. Customer (phone and website side by side)
1. Home: pharmacies near you. Tap **Open now** to show only open stores.
2. Tap the **heart** on two pharmacies, then the **Favourites** chip. Same on website and phone.
3. Search a medicine, open a pharmacy, add to cart. Show that prescription medicines cannot be bought without an approved prescription.
4. Checkout (test payment mode) -> order placed, one order per pharmacy.

## B. Pharmacy portal
1. Open Orders, move the order to **Preparing** then **Ready for pickup**.
2. Inventory: edit a medicine, set **Expiry date** (e.g. 10 days from now) and **Low-stock warning at** 50. Show the "Expires soon" and "Low stock" badges and the "Expired or expiring within 30 days" card on Needs action.

## C. Back to the customer
1. Profile shows a dot; open the **bell (Order updates)**. Messages: "is preparing your order", "ready for pickup". Tap Mark all as read.

## D. Admin
1. **Staff accounts**: pick a pharmacy, add an Account ID with a role, then remove access.
2. **Reports**: Medicines sold, Pharmacy performance (CSV export).
3. **Audit log**: search for the inventory change you just made (UPDATE_INVENTORY_TRACKING).

## E. Closing points
Server owns prices, stock and payment; location is never stored on the server; automatic tests run on every push (GitHub Actions); backup/restore proof in docs/BACKUP-RESTORE-PROOF.md.
