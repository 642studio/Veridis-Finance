# veridis-finance-frontend

Production-ready SaaS frontend for **veridis-finance** built with **Next.js 14**, **App Router**, **TypeScript**, **Tailwind CSS**, and **shadcn/ui**.

## Stack

- Next.js 14 (App Router)
- React + TypeScript
- Tailwind CSS
- shadcn/ui components
- Notification libraries:
  - Sonner
  - React Hot Toast
  - Sileo
  - React-Toastify
- JWT auth via secure cookie + Next middleware

## Implemented Pages

- `/login`
- `/register`
- `/dashboard`
- `/dashboard/transactions`
- `/dashboard/invoices`
- `/dashboard/reports`
- `/dashboard/planning`
- `/dashboard/accounts`
- `/dashboard/contacts`
- `/dashboard/categories`
- `/dashboard/members`
- `/dashboard/clients`
- `/dashboard/vendors`
- `/dashboard/settings`

## Phase 1 Frontend (Core Operational Accounting)

The frontend now supports the backend Phase 1 model:

- Transaction create/edit now supports:
  - `account_id`
  - `contact_id`
  - `status`
  - `source`
  - `tags`
- Transactions table includes:
  - account, status, source, linked entity badges
- Transactions filters include:
  - member, contact, account, status, source
- Transactions now include split management modal:
  - list splits
  - create split
  - edit split
  - delete split
- Dashboard overview now includes recurring-candidate insights:
  - pulls from `/api/finance/transactions/recurring-candidates`
  - shows frequency, confidence, and projected next occurrence
- Dashboard overview includes recurring alerts panel:
  - pulls from `/api/finance/transactions/recurring-alerts`
  - highlights `due_soon` and `overdue` expected recurring movements
- Recurring management actions in dashboard:
  - `Approve` candidate as persistent rule
  - `Suppress 30d` to mute alerts
  - `Unsuppress` from suppressed rules list
- New operational CRUD sections:
  - Accounts
  - Contacts
  - Categories + Subcategories
- Accounts, Contacts, and Categories now include:
  - text search
  - client-side pagination
  - page size selector
- Added Next.js API proxy handlers for:
  - `/api/finance/accounts*`
  - `/api/finance/contacts*`
  - `/api/finance/categories*`
  - `/api/finance/subcategories*`
  - `/api/finance/transactions/:transactionId/splits`
  - `/api/finance/transaction-splits/:splitId`

## Implemented UI Components

- `Navbar`
- `Sidebar`
- `Footer`
- Reusable `DataTable` for transactions/invoices
- Reusable chart components (Recharts)
- Planning dashboard tabs (Overview, Budget, Cashflow, Products, Investments, Loans, Import)

## Notification Abstraction

The app uses a provider + hook abstraction:

- `src/components/notification/notification-provider.tsx`
- `src/hooks/use-notify.ts`
- `src/lib/notifications/adapters.ts`

Use `useNotify()` anywhere in client components:

```tsx
const notify = useNotify();
notify.success({ title: "Saved", description: "Transaction created." });
notify.error("Something failed");
```

### Active Library Switching

You can switch notification engine in two ways:

1. **Environment variable** (default on load):
   - `NEXT_PUBLIC_NOTIFICATION_LIBRARY=sonner`
   - Allowed values: `sonner`, `hot-toast`, `sileo`, `toastify`
2. **Runtime selector in UI**:
   - `/dashboard/settings` persists selection in `localStorage`

All toaster containers are mounted globally in:

- `src/components/providers.tsx`

## Auth Strategy

- JWT is stored in an `httpOnly` cookie (`vf_token`)
- Login/Register API routes set cookie
- Logout route clears cookie
- Middleware protects `/dashboard/*`

Relevant files:

- `src/middleware.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/register/route.ts`
- `src/app/api/auth/logout/route.ts`

## Local Development

1. Install dependencies:

```bash
npm install
```

2. Create env file:

```bash
cp .env.example .env.local
```

3. Make sure backend is running (`veridis-finance` on port `4000`).

4. Start frontend:

```bash
npm run dev
```

Frontend URL:

- [http://localhost:3000](http://localhost:3000)

## Build and Deploy

Build production bundle:

```bash
npm run build
```

Run production server:

```bash
npm run start
```

Recommended deploy targets:

- Vercel
- Dockerized Node runtime
- Any platform supporting Next.js standalone/server deployment

## Useful Scripts

- `npm run dev` - development server
- `npm run lint` - lint checks
- `npm run typecheck` - TypeScript checks
- `npm run build` - production build
- `npm run start` - production server

## Backend Integration Notes

Frontend proxies requests through Next route handlers to avoid browser CORS issues.

- Auth proxy: `src/app/api/auth/*`
- Finance proxy: `src/app/api/finance/*`
- Planning proxy: `src/app/api/planning/*`

Planning import v3 expected sheets:

- `MODEL_INFO`
- `INCOME_STATEMENT_ANNUAL`
- `PRODUCT_MIX`
- `MONTHLY_BUDGET`
- `CASHFLOW`
- `INVESTMENTS`
- `LOANS`

Set `VERIDIS_API_URL` to your backend URL.
