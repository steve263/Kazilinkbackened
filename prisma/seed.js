require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding KaziShow database with Nairobi test data...\n');

  // ─── Clear existing data (safe order for FK constraints) ──────────────────
  await prisma.message.deleteMany();
  await prisma.review.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.service.deleteMany();
  await prisma.provider.deleteMany();
  await prisma.user.deleteMany();
  console.log('🗑️  Cleared existing data');

  const hash = (pw) => bcrypt.hash(pw, 10);

  // ─── Customers ─────────────────────────────────────────────────────────────
  const [amara, james, mary] = await Promise.all([
    prisma.user.create({
      data: {
        phone: '+254712345678',
        password: await hash('password123'),
        name: 'Amara Wanjiku',
        role: 'CUSTOMER',
        location: 'Westlands, Nairobi',
        lat: -1.2676,
        lng: 36.8032,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+254723456789',
        password: await hash('password123'),
        name: 'James Kariuki',
        role: 'CUSTOMER',
        location: 'Kilimani, Nairobi',
        lat: -1.2908,
        lng: 36.7852,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+254734567890',
        password: await hash('password123'),
        name: 'Mary Wangari',
        role: 'CUSTOMER',
        location: 'CBD, Nairobi',
        lat: -1.2864,
        lng: 36.8172,
      },
    }),
  ]);
  console.log('👥 Customers created: Amara, James, Mary');

  // ─── Provider users ────────────────────────────────────────────────────────
  const [brianUser, janeUser, techmartUser, sereneUser, mamaUser, adminUser] = await Promise.all([
    prisma.user.create({
      data: {
        phone: '+254745678901',
        password: await hash('password123'),
        name: 'Brian Otieno',
        role: 'PROVIDER',
        location: 'Lavington, Nairobi',
        lat: -1.2739,
        lng: 36.7689,
        isOnline: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+254756789012',
        password: await hash('password123'),
        name: 'Jane Muthoni',
        role: 'PROVIDER',
        location: 'Kilimani, Nairobi',
        lat: -1.2908,
        lng: 36.7852,
        isOnline: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+254767890123',
        password: await hash('password123'),
        name: 'TechMart Kenya',
        role: 'PROVIDER',
        location: 'Westlands, Nairobi',
        lat: -1.2676,
        lng: 36.8032,
        isOnline: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+254778901234',
        password: await hash('password123'),
        name: 'Serene Suites',
        role: 'PROVIDER',
        location: 'Upper Hill, Nairobi',
        lat: -1.2961,
        lng: 36.8219,
        isOnline: false,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+254789012345',
        password: await hash('password123'),
        name: 'Mama Oliech',
        role: 'PROVIDER',
        location: 'South C, Nairobi',
        lat: -1.3097,
        lng: 36.827,
        isOnline: true,
      },
    }),
    prisma.user.create({
      data: {
        phone: '+254700000000',
        password: await hash('admin123'),
        name: 'KaziShow Admin',
        role: 'ADMIN',
        location: 'Nairobi',
      },
    }),
  ]);
  console.log('👤 Provider users created');

  // ─── Provider profiles ─────────────────────────────────────────────────────
  const [brian, jane, techmart, serene, mama] = await Promise.all([
    prisma.provider.create({
      data: {
        userId: brianUser.id,
        category: 'FUNDI',
        businessName: 'Brian Otieno Plumbing',
        description: 'Professional plumber with 8+ years experience in Nairobi. Pipe fitting, water heaters, drain unblocking, and full bathroom installations.',
        idNumber: '24567891',
        idVerified: true,
        isVerified: true,
        verificationStatus: 'APPROVED',
        badge: 'Verified Fundi',
        rating: 4.8,
        totalReviews: 124,
        workingHoursStart: '07:00',
        workingHoursEnd: '19:00',
        radiusKm: 15,
        minJobValue: 800,
        portfolioPhotos: [
          'https://placehold.co/800x600/1a1a1a/ff6b2b?text=Pipe+Install',
          'https://placehold.co/800x600/1a1a1a/ff6b2b?text=Bathroom+Fit',
        ],
      },
    }),
    prisma.provider.create({
      data: {
        userId: janeUser.id,
        category: 'FUNDI',
        businessName: 'Jane Sparkle Cleaning',
        description: 'Professional home and office cleaning. Deep clean, move-in/move-out cleaning, carpet washing, and regular housekeeping packages.',
        idNumber: '31234567',
        idVerified: true,
        isVerified: true,
        verificationStatus: 'APPROVED',
        badge: 'Verified Fundi',
        rating: 4.9,
        totalReviews: 89,
        workingHoursStart: '08:00',
        workingHoursEnd: '18:00',
        radiusKm: 20,
        minJobValue: 500,
        portfolioPhotos: [
          'https://placehold.co/800x600/1a1a1a/00c896?text=Office+Clean',
        ],
      },
    }),
    prisma.provider.create({
      data: {
        userId: techmartUser.id,
        category: 'SHOP',
        businessName: 'TechMart Kenya',
        description: 'Your one-stop electronics shop. Phones, laptops, accessories, and repairs. Official dealers for Samsung, Tecno, and Infinix in Westlands.',
        idNumber: 'BUS123456',
        idVerified: true,
        isVerified: true,
        verificationStatus: 'APPROVED',
        badge: 'Verified Business',
        rating: 4.6,
        totalReviews: 211,
        workingHoursStart: '09:00',
        workingHoursEnd: '20:00',
        radiusKm: 5,
        minJobValue: 1000,
      },
    }),
    prisma.provider.create({
      data: {
        userId: sereneUser.id,
        category: 'HOTEL',
        businessName: 'Serene Suites Upper Hill',
        description: 'Boutique hotel in Upper Hill. Standard, Deluxe, and Executive rooms. Conference facilities, restaurant, and rooftop bar available.',
        idNumber: 'HTL789012',
        idVerified: true,
        isVerified: true,
        verificationStatus: 'APPROVED',
        badge: 'Verified Business',
        rating: 4.7,
        totalReviews: 54,
        workingHoursStart: '00:00',
        workingHoursEnd: '23:59',
        radiusKm: 50,
        minJobValue: 4500,
      },
    }),
    prisma.provider.create({
      data: {
        userId: mamaUser.id,
        category: 'RESTAURANT',
        businessName: 'Mama Oliech Restaurant',
        description: 'Authentic Kenyan cuisine — fish, ugali, sukuma wiki, and nyama choma. Takeaway and delivery available across Nairobi.',
        idNumber: 'REST345678',
        idVerified: true,
        isVerified: true,
        verificationStatus: 'APPROVED',
        badge: 'Verified Business',
        rating: 4.9,
        totalReviews: 312,
        workingHoursStart: '10:00',
        workingHoursEnd: '22:00',
        radiusKm: 10,
        minJobValue: 300,
      },
    }),
  ]);
  console.log('🏪 Provider profiles created');

  // ─── Services ──────────────────────────────────────────────────────────────
  const [pipeFix, drainUnblock, heaterInstall, deepClean, regularClean, phoneRepair, laptopRepair, standardRoom, tilapiaPlate, nyamaChoma] = await Promise.all([
    prisma.service.create({ data: { providerId: brian.id, name: 'Pipe Repair & Replacement', description: 'Fix burst or leaking pipes. Any size, any location in your property.', price: 1500, priceType: 'FROM', duration: 90 } }),
    prisma.service.create({ data: { providerId: brian.id, name: 'Drain Unblocking', description: 'Clear blocked sinks, toilets, and outdoor drains. Same-day service available.', price: 800, priceType: 'FROM', duration: 60 } }),
    prisma.service.create({ data: { providerId: brian.id, name: 'Water Heater Installation', description: 'Install solar or electric geysers. Supply + installation packages available.', price: 6500, priceType: 'FROM', duration: 240 } }),
    prisma.service.create({ data: { providerId: jane.id, name: 'Deep Cleaning', description: 'Full property deep clean — kitchen, bathrooms, bedrooms, living areas.', price: 3500, priceType: 'FROM', duration: 240 } }),
    prisma.service.create({ data: { providerId: jane.id, name: 'Regular Housekeeping', description: 'Weekly or bi-weekly home cleaning. Flexible schedule.', price: 1800, priceType: 'FIXED', duration: 180 } }),
    prisma.service.create({ data: { providerId: techmart.id, name: 'Phone Screen Replacement', description: 'Original screen replacements for all major brands. 90-day warranty.', price: 3500, priceType: 'FROM', duration: 60 } }),
    prisma.service.create({ data: { providerId: techmart.id, name: 'Laptop Repair', description: 'Software issues, hardware faults, battery replacement, screen repair.', price: 2000, priceType: 'FROM', duration: 120 } }),
    prisma.service.create({ data: { providerId: serene.id, name: 'Standard Room (Per Night)', description: 'Comfortable standard room with en-suite bathroom, WiFi, and breakfast.', price: 4500, priceType: 'FIXED', duration: 1440 } }),
    prisma.service.create({ data: { providerId: mama.id, name: 'Fried Tilapia + Ugali', description: 'Fresh whole tilapia, ugali, and kachumbari. Feeds 2.', price: 850, priceType: 'FIXED', duration: 30 } }),
    prisma.service.create({ data: { providerId: mama.id, name: 'Nyama Choma (Per Kg)', description: 'Slow-roasted goat or beef. Served with kachumbari and ugali.', price: 1200, priceType: 'FIXED', duration: 45 } }),
  ]);
  console.log('🛠️  Services created (10 across all providers)');

  // ─── Bookings ──────────────────────────────────────────────────────────────
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const twoDaysAgo = new Date();
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const threeDaysAgo = new Date();
  threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

  const [booking1, booking2, booking3, booking4, booking5] = await Promise.all([
    prisma.booking.create({
      data: {
        customerId: amara.id,
        providerId: brian.id,
        serviceId: pipeFix.id,
        status: 'COMPLETED',
        scheduledDate: twoDaysAgo,
        scheduledTime: '10:00 AM',
        address: '14 Muthangari Drive, Westlands',
        lat: -1.268,
        lng: 36.803,
        totalAmount: 2200,
        paymentStatus: 'PAID',
        mpesaRef: 'QBD7F4H2K1',
        notes: 'Burst pipe in kitchen. Please bring fittings.',
      },
    }),
    prisma.booking.create({
      data: {
        customerId: james.id,
        providerId: jane.id,
        serviceId: deepClean.id,
        status: 'COMPLETED',
        scheduledDate: twoDaysAgo,
        scheduledTime: '09:00 AM',
        address: '22 Ngong Road, Kilimani',
        lat: -1.291,
        lng: 36.785,
        totalAmount: 3500,
        paymentStatus: 'PAID',
        mpesaRef: 'QCA8G5I3L2',
      },
    }),
    prisma.booking.create({
      data: {
        customerId: mary.id,
        providerId: techmart.id,
        serviceId: phoneRepair.id,
        status: 'COMPLETED',
        scheduledDate: yesterday,
        scheduledTime: '02:00 PM',
        address: 'Westlands Mall, Westlands',
        lat: -1.267,
        lng: 36.803,
        totalAmount: 4200,
        paymentStatus: 'PAID',
        mpesaRef: 'QDB9H6J4M3',
      },
    }),
    prisma.booking.create({
      data: {
        customerId: amara.id,
        providerId: mama.id,
        serviceId: tilapiaPlate.id,
        status: 'COMPLETED',
        scheduledDate: threeDaysAgo,
        scheduledTime: '01:00 PM',
        address: 'Delivery to Westlands',
        lat: -1.268,
        lng: 36.803,
        totalAmount: 850,
        paymentStatus: 'PAID',
        mpesaRef: 'QEC0I7K5N4',
        notes: 'Extra lemon on the side please.',
      },
    }),
    prisma.booking.create({
      data: {
        customerId: james.id,
        providerId: serene.id,
        serviceId: standardRoom.id,
        status: 'COMPLETED',
        scheduledDate: threeDaysAgo,
        scheduledTime: '02:00 PM',
        address: 'Serene Suites, Upper Hill',
        lat: -1.296,
        lng: 36.822,
        totalAmount: 4500,
        paymentStatus: 'PAID',
        mpesaRef: 'QFD1J8L6O5',
        notes: 'One night. Late check-out if possible.',
      },
    }),
  ]);
  console.log('📋 5 bookings created');

  // ─── Payments ──────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.payment.create({ data: { bookingId: booking1.id, amount: 2200, phone: amara.phone, mpesaRef: 'QBD7F4H2K1', status: 'SUCCESS', type: 'CALLBACK' } }),
    prisma.payment.create({ data: { bookingId: booking2.id, amount: 3500, phone: james.phone, mpesaRef: 'QCA8G5I3L2', status: 'SUCCESS', type: 'CALLBACK' } }),
    prisma.payment.create({ data: { bookingId: booking3.id, amount: 4200, phone: mary.phone,  mpesaRef: 'QDB9H6J4M3', status: 'SUCCESS', type: 'CALLBACK' } }),
    prisma.payment.create({ data: { bookingId: booking4.id, amount: 850,  phone: amara.phone, mpesaRef: 'QEC0I7K5N4', status: 'SUCCESS', type: 'CALLBACK' } }),
    prisma.payment.create({ data: { bookingId: booking5.id, amount: 4500, phone: james.phone, mpesaRef: 'QFD1J8L6O5', status: 'SUCCESS', type: 'CALLBACK' } }),
  ]);
  console.log('💳 5 payments created');

  // ─── Reviews ───────────────────────────────────────────────────────────────
  await Promise.all([
    prisma.review.create({ data: { bookingId: booking1.id, customerId: amara.id, providerId: brian.id, rating: 5, comment: 'Brian was fantastic! Fixed the burst pipe in under an hour. Very professional and clean work. Highly recommend.' } }),
    prisma.review.create({ data: { bookingId: booking2.id, customerId: james.id, providerId: jane.id, rating: 5, comment: 'Jane and her team did an incredible job. The apartment was spotless afterwards. Will definitely book again!' } }),
    prisma.review.create({ data: { bookingId: booking3.id, customerId: mary.id, providerId: techmart.id, rating: 4, comment: 'Good service, screen was replaced quickly. A bit pricey but quality was excellent.' } }),
    prisma.review.create({ data: { bookingId: booking4.id, customerId: amara.id, providerId: mama.id, rating: 5, comment: 'Best tilapia in Nairobi! Delivered hot and on time. The ugali was perfectly made.' } }),
    prisma.review.create({ data: { bookingId: booking5.id, customerId: james.id, providerId: serene.id, rating: 5, comment: 'Beautiful room, great breakfast, and the rooftop bar view is stunning. Will come back.' } }),
  ]);
  console.log('⭐ 5 reviews created');

  // ─── Update provider ratings ───────────────────────────────────────────────
  for (const p of [brian, jane, techmart, serene, mama]) {
    const agg = await prisma.review.aggregate({ where: { providerId: p.id }, _avg: { rating: true }, _count: true });
    await prisma.provider.update({ where: { id: p.id }, data: { rating: Math.round((agg._avg.rating || 0) * 10) / 10, totalReviews: agg._count } });
  }
  console.log('📊 Provider ratings updated');

  // ─── Sample notifications ──────────────────────────────────────────────────
  await Promise.all([
    prisma.notification.create({ data: { userId: brianUser.id, type: 'NEW_BOOKING', title: 'New Booking Request', body: 'Amara Wanjiku wants Pipe Repair at 14 Muthangari Drive', bookingId: booking1.id, isRead: true } }),
    prisma.notification.create({ data: { userId: amara.id, type: 'BOOKING_ACCEPTED', title: 'Booking Accepted!', body: 'Brian Otieno Plumbing accepted your booking.', bookingId: booking1.id, isRead: true } }),
    prisma.notification.create({ data: { userId: amara.id, type: 'PAYMENT_RECEIVED', title: 'Payment Confirmed', body: 'KSh 2,200 received. Ref: QBD7F4H2K1', bookingId: booking1.id, isRead: true } }),
  ]);
  console.log('🔔 Sample notifications created');

  console.log('\n✅ Seeding complete!\n');
  console.log('─────────────────────────────────────────');
  console.log('📱 Test credentials (all passwords: password123)');
  console.log('');
  console.log('CUSTOMERS:');
  console.log('  Amara Wanjiku     +254712345678');
  console.log('  James Kariuki     +254723456789');
  console.log('  Mary Wangari      +254734567890');
  console.log('');
  console.log('PROVIDERS:');
  console.log('  Brian Otieno      +254745678901  (Fundi - Plumber)');
  console.log('  Jane Muthoni      +254756789012  (Fundi - Cleaner)');
  console.log('  TechMart Kenya    +254767890123  (Shop)');
  console.log('  Serene Suites     +254778901234  (Hotel)');
  console.log('  Mama Oliech       +254789012345  (Restaurant)');
  console.log('');
  console.log('ADMIN:');
  console.log('  KaziShow Admin    +254700000000  (password: admin123)');
  console.log('─────────────────────────────────────────\n');
}

main()
  .catch((err) => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
