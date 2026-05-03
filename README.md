# KaziShow Backend API

Kenya's all-in-one service marketplace — Fundis, shops, hotels, restaurants, and tech companies, all bookable and payable via M-Pesa.

## Stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** PostgreSQL (Prisma ORM)
- **Real-time:** Socket.io
- **SMS:** Africa's Talking
- **Payments:** Safaricom Daraja API (M-Pesa STK Push)
- **Auth:** JWT + bcrypt
- **File uploads:** Multer + Cloudinary

---

## Quick Start

### 1. Install dependencies

```bash
cd kazishow-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Run database migrations

```bash
npm run prisma:generate   # Generate Prisma client
npm run prisma:migrate    # Apply migrations (creates tables)
```

### 4. Seed test data

```bash
npm run prisma:seed
```

This inserts 3 customers, 5 providers, 10 services, 5 bookings with payments and reviews. See the console output for all test credentials.

### 5. Start the server

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Server runs on `http://localhost:5000` by default.

---

## API Endpoints

### AUTH

#### POST /api/auth/register
```json
{
  "phone": "+254712345678",
  "password": "password123",
  "name": "Amara Wanjiku",
  "role": "CUSTOMER"
}
```
Provider registration also requires:
```json
{
  "role": "PROVIDER",
  "category": "FUNDI",
  "businessName": "Brian Plumbing"
}
```
Response:
```json
{
  "success": true,
  "data": { "user": { "id": "...", "name": "Amara Wanjiku", "role": "CUSTOMER" }, "token": "eyJ..." }
}
```

#### POST /api/auth/login
```json
{ "phone": "+254712345678", "password": "password123" }
```

#### POST /api/auth/refresh
Headers: `Authorization: Bearer <token>`

#### PUT /api/auth/device-token
```json
{ "deviceToken": "firebase-device-token-here" }
```

---

### PROVIDERS

#### GET /api/providers
Query params: `type`, `minRating`, `verified`, `lat`, `lng`, `radius`

```
GET /api/providers?type=FUNDI&minRating=4.5&lat=-1.2676&lng=36.8032&radius=10
```

#### GET /api/providers/nearby
```
GET /api/providers/nearby?lat=-1.2676&lng=36.8032&radius=5&category=FUNDI
```

#### GET /api/providers/:id
Returns full profile with services and reviews.

#### PUT /api/providers/:id
Auth required (provider or admin):
```json
{ "businessName": "Updated Name", "description": "...", "radiusKm": 20 }
```

#### PUT /api/providers/:id/online
Toggles the provider's online/offline status.

#### PUT /api/providers/:id/location
```json
{ "lat": -1.2739, "lng": 36.7689, "location": "Lavington, Nairobi" }
```

#### GET /api/providers/:id/earnings
Auth required (own provider or admin). Returns today / week / month / allTime breakdown.

---

### BOOKINGS

#### POST /api/bookings
Auth required (CUSTOMER):
```json
{
  "providerId": "clx...",
  "serviceId": "clx...",
  "scheduledDate": "2025-04-25",
  "scheduledTime": "10:00 AM",
  "address": "14 Muthangari Drive, Westlands",
  "lat": -1.268,
  "lng": 36.803,
  "notes": "Burst pipe in kitchen"
}
```
This triggers a real-time Socket.io event to the provider and sends an SMS. If the provider doesn't respond within 30 seconds the booking is auto-declined.

#### GET /api/bookings
Auth required. Customers see their own, providers see theirs, admins see all.
Query params: `status`, `page`, `limit`

#### GET /api/bookings/:id

#### PUT /api/bookings/:id/accept
Auth required (PROVIDER).

#### PUT /api/bookings/:id/decline
Auth required (PROVIDER).

#### PUT /api/bookings/:id/status
Auth required (PROVIDER):
```json
{ "status": "EN_ROUTE" }
```
Valid statuses: `EN_ROUTE`, `ARRIVED`, `IN_PROGRESS`, `COMPLETED`

#### DELETE /api/bookings/:id
Auth required (CUSTOMER). Cancels the booking.

---

### PAYMENTS

#### POST /api/payments/stk-push
Auth required (CUSTOMER):
```json
{
  "bookingId": "clx...",
  "phone": "+254712345678"
}
```
Sends an M-Pesa STK Push prompt to the customer's phone.

Response:
```json
{
  "success": true,
  "data": {
    "message": "M-Pesa payment prompt sent to your phone",
    "checkoutRequestId": "ws_CO_..."
  }
}
```

#### POST /api/payments/callback
Public endpoint called by Safaricom Daraja. On success, marks booking as PAID and notifies both parties via Socket.io + SMS.

#### GET /api/payments/:bookingId
Auth required. Returns payment status for a booking.

---

### NOTIFICATIONS

#### GET /api/notifications
Auth required. Returns notifications for the logged-in user with unread count.

#### PUT /api/notifications/:id/read
Marks a single notification as read.

#### PUT /api/notifications/read-all
Marks all notifications as read.

---

### REVIEWS

#### POST /api/reviews
Auth required (CUSTOMER). Booking must be COMPLETED:
```json
{
  "bookingId": "clx...",
  "rating": 5,
  "comment": "Excellent service, very professional!"
}
```
Automatically recalculates the provider's average rating.

#### GET /api/reviews/provider/:id
Public. Query params: `page`, `limit`

---

## Real-time Events (Socket.io)

Connect to the server and join a room by emitting your userId:

```js
const socket = io('http://localhost:5000');
socket.emit('join', userId);
```

### Events the server emits to providers

| Event | Payload |
|---|---|
| `new_booking` | `{ booking, customer }` |
| `booking_cancelled` | `{ bookingId }` |
| `payment_received` | `{ bookingId, amount, mpesaRef }` |

### Events the server emits to customers

| Event | Payload |
|---|---|
| `booking_accepted` | `{ booking, providerName }` |
| `booking_declined` | `{ booking }` |
| `provider_en_route` | `{ booking, providerName }` |
| `provider_arrived` | `{ booking, providerName }` |

### Events the client emits to the server

| Event | Payload |
|---|---|
| `provider_online` | `{ userId }` |
| `provider_offline` | `{ userId }` |
| `provider_location` | `{ userId, lat, lng }` |

---

## Testing M-Pesa (Sandbox)

1. Set `MPESA_ENV=sandbox` in `.env`
2. Get sandbox credentials from [Safaricom Developer Portal](https://developer.safaricom.co.ke/)
3. Use Shortcode `174379` and the sandbox passkey
4. For the callback, expose your local server with [ngrok](https://ngrok.com/):
   ```bash
   ngrok http 5000
   ```
5. Set `MPESA_CALLBACK_URL=https://your-ngrok-url.ngrok.io/api/payments/callback`
6. Use test phone `254708374149` for sandbox STK pushes

---

## Testing Africa's Talking SMS (Sandbox)

1. Sign up at [africastalking.com](https://africastalking.com)
2. Set `AT_USERNAME=sandbox` and use your sandbox API key
3. Add test phone numbers in the Africa's Talking sandbox dashboard
4. SMS will show in the sandbox inbox — no real SIM needed

---

## Database Management

```bash
npm run prisma:studio    # Visual DB browser at http://localhost:5555
npm run prisma:reset     # Drop all data and re-seed
npm run prisma:migrate   # Apply pending migrations
npm run prisma:generate  # Regenerate Prisma client after schema changes
```

---

## Test Accounts (after seeding)

All passwords: `password123` (admin password: `admin123`)

| Name | Phone | Role |
|---|---|---|
| Amara Wanjiku | +254712345678 | CUSTOMER |
| James Kariuki | +254723456789 | CUSTOMER |
| Mary Wangari | +254734567890 | CUSTOMER |
| Brian Otieno | +254745678901 | PROVIDER (Fundi) |
| Jane Muthoni | +254756789012 | PROVIDER (Fundi) |
| TechMart Kenya | +254767890123 | PROVIDER (Shop) |
| Serene Suites | +254778901234 | PROVIDER (Hotel) |
| Mama Oliech | +254789012345 | PROVIDER (Restaurant) |
| KaziShow Admin | +254700000000 | ADMIN |
