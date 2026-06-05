const nodemailer = require('nodemailer');

// ─── Transport ────────────────────────────────────────────────────────────────

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

async function sendEmail({ to, subject, html }) {
  if (!to || !process.env.EMAIL_USER || !process.env.EMAIL_PASS) {
    console.log(`📧 Email skipped (no email address or SMTP config): ${subject}`);
    return;
  }
  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || `KaziShow <${process.env.EMAIL_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`📧 Email sent to ${to}: ${subject}`);
  } catch (err) {
    console.error(`❌ Email failed to ${to}:`, err.message);
  }
}

// ─── Shared layout ────────────────────────────────────────────────────────────

function layout(content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>KaziShow</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background:linear-gradient(135deg,#FF6B2B,#FF8C42);padding:28px 32px;text-align:center;">
              <span style="color:#ffffff;font-size:26px;font-weight:900;letter-spacing:-0.5px;">Kazi<span style="color:#fff3ee;">Show</span></span>
              <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:13px;">Kenya's All-in-One Service Marketplace</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 32px 28px;">
              ${content}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f9f9f9;padding:20px 32px;text-align:center;border-top:1px solid #ebebeb;">
              <p style="margin:0;color:#9ca3af;font-size:12px;">© 2026 KaziShow · Kenya's Service Marketplace</p>
              <p style="margin:6px 0 0;color:#9ca3af;font-size:12px;">You received this email because you have an account on KaziShow.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// ─── Templates ────────────────────────────────────────────────────────────────

// 1. New Booking — sent to provider when offline
function tplNewBooking({ providerName, customerName, service, location, amount, scheduledDate }) {
  return layout(`
    <h2 style="margin:0 0 8px;color:#1a1714;font-size:22px;font-weight:800;">You Have a New Booking! 🔔</h2>
    <p style="color:#6b7280;font-size:14px;margin:0 0 24px;">Hi <strong>${providerName}</strong>, a new booking is waiting for your response.</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7f3;border:1.5px solid #ffd5bc;border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:20px 24px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Customer</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${customerName}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Service</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${service}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Location</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${location}</td>
          </tr>
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Amount</td>
            <td style="padding:6px 0;color:#FF6B2B;font-size:16px;font-weight:900;">KSh ${amount.toLocaleString()}</td>
          </tr>
          ${scheduledDate ? `<tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Scheduled</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${scheduledDate}</td>
          </tr>` : ''}
        </table>
      </td></tr>
    </table>

    <p style="background:#fff3cd;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;color:#92400e;font-size:13px;margin:0 0 24px;">
      ⚡ Open the KaziShow app to accept or decline. Bookings auto-decline after 30 seconds of inactivity.
    </p>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        Open KaziShow App →
      </a>
    </div>
  `);
}

// 2. Provider profile approved
function tplProviderApproved({ providerName, businessName }) {
  return layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;background:#d1fae5;border-radius:50%;padding:18px;margin-bottom:12px;">
        <span style="font-size:36px;">✅</span>
      </div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:24px;font-weight:900;">You're Live on KaziShow! 🎉</h2>
      <p style="color:#6b7280;font-size:15px;margin:0;">Congratulations, <strong>${providerName}</strong>!</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Your business <strong>${businessName}</strong> has been verified and approved by the KaziShow team. Your profile is now <strong style="color:#10b981;">live</strong> and visible to thousands of customers across Kenya.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;margin-bottom:28px;">
      <tr><td style="padding:18px 22px;">
        <p style="margin:0 0 10px;color:#166534;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">What's next?</p>
        <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:2;">
          <li>Customers can now find and book you on the app</li>
          <li>Keep your profile updated with photos and services</li>
          <li>Respond quickly to bookings to grow your rating</li>
          <li>Share your profile link to attract more clients</li>
        </ul>
      </td></tr>
    </table>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        View My Profile →
      </a>
    </div>
  `);
}

// 3. Provider profile rejected
function tplProviderRejected({ providerName, businessName, reason }) {
  return layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;background:#fee2e2;border-radius:50%;padding:18px;margin-bottom:12px;">
        <span style="font-size:36px;">❌</span>
      </div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:24px;font-weight:900;">Application Not Approved</h2>
      <p style="color:#6b7280;font-size:15px;margin:0;">Hi <strong>${providerName}</strong>, we reviewed your application for <strong>${businessName}</strong>.</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Unfortunately, your KaziShow application was not approved at this time. Here's the reason from our review team:
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:18px 22px;">
        <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;font-style:italic;">"${reason}"</p>
      </td></tr>
    </table>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 24px;">
      Don't worry — you can fix the issue and reapply. Make sure your documents are clear, your business details are accurate, and your description is complete.
    </p>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/auth/register/business" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        Try Again →
      </a>
    </div>
  `);
}

// 4. Tip/Guide approved
function tplTipApproved({ authorName, tipTitle }) {
  return layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <span style="font-size:48px;">📖</span>
      <h2 style="margin:12px 0 8px;color:#1a1714;font-size:24px;font-weight:900;">Your Guide is Live! 🎉</h2>
      <p style="color:#6b7280;font-size:15px;margin:0;">Great news, <strong>${authorName}</strong>!</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Your guide <strong>"${tipTitle}"</strong> has been reviewed and approved by our team. It is now published and visible to all KaziShow users in the Tips & Guides section.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#eff6ff;border:1.5px solid #93c5fd;border-radius:12px;margin-bottom:28px;">
      <tr><td style="padding:18px 22px;text-align:center;">
        <p style="margin:0;color:#1e40af;font-size:14px;font-weight:700;">📚 "${tipTitle}"</p>
        <p style="margin:8px 0 0;color:#3b82f6;font-size:13px;">Is now live on KaziShow Tips &amp; Guides</p>
      </td></tr>
    </table>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/tips" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        View My Guide →
      </a>
    </div>
  `);
}

// 5. Tip/Guide rejected
function tplTipRejected({ authorName, tipTitle, reason }) {
  return layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <span style="font-size:48px;">📝</span>
      <h2 style="margin:12px 0 8px;color:#1a1714;font-size:24px;font-weight:900;">Guide Not Approved</h2>
      <p style="color:#6b7280;font-size:15px;margin:0;">Hi <strong>${authorName}</strong>, we reviewed your submission.</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Your guide <strong>"${tipTitle}"</strong> was not approved. Here's what our team noted:
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:18px 22px;">
        <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;font-style:italic;">"${reason || 'Content did not meet our publishing guidelines.'}"</p>
      </td></tr>
    </table>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 24px;">
      You can edit your guide and resubmit it for review. Make sure your content is original, helpful, and follows our community guidelines.
    </p>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/tips/my-guides" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        Edit &amp; Resubmit →
      </a>
    </div>
  `);
}

// 6. Testimonial approved
function tplTestimonialApproved({ customerName }) {
  return layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <span style="font-size:48px;">🎥</span>
      <h2 style="margin:12px 0 8px;color:#1a1714;font-size:24px;font-weight:900;">Your Testimonial is Live! 🌟</h2>
      <p style="color:#6b7280;font-size:15px;margin:0;">Amazing, <strong>${customerName}</strong>!</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Your testimonial has been approved and is now visible to thousands of users on the KaziShow platform. Thank you for helping the community make better decisions!
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;margin-bottom:28px;">
      <tr><td style="padding:18px 22px;text-align:center;">
        <p style="margin:0;color:#166534;font-size:14px;font-weight:700;">✅ Your video is now featured on KaziShow</p>
        <p style="margin:8px 0 0;color:#16a34a;font-size:13px;">It may appear on provider profiles and the home feed</p>
      </td></tr>
    </table>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        View on KaziShow →
      </a>
    </div>
  `);
}

// 7. Testimonial rejected
function tplTestimonialRejected({ customerName, reason }) {
  return layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <span style="font-size:48px;">🎥</span>
      <h2 style="margin:12px 0 8px;color:#1a1714;font-size:24px;font-weight:900;">Testimonial Not Approved</h2>
      <p style="color:#6b7280;font-size:15px;margin:0;">Hi <strong>${customerName}</strong>, we reviewed your testimonial.</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Unfortunately your testimonial could not be approved at this time. Here's the reason:
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fef2f2;border:1.5px solid #fca5a5;border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:18px 22px;">
        <p style="margin:0;color:#991b1b;font-size:14px;line-height:1.6;font-style:italic;">"${reason || 'Content did not meet our community guidelines.'}"</p>
      </td></tr>
    </table>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 24px;">
      You're welcome to submit a new testimonial that follows our guidelines. We'd love to feature your experience!
    </p>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        Try Again →
      </a>
    </div>
  `);
}

// 8. Booking reminder
function tplBookingReminder({ name, role, providerName, customerName, customerPhone, serviceName, scheduledDate, scheduledTime, address, amount, label }) {
  const isProvider = role === 'provider';
  return layout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:52px;margin-bottom:8px;">⏰</div>
      <h2 style="margin:0 0 6px;color:#1a1714;font-size:22px;font-weight:900;">
        ${isProvider ? 'Job Reminder!' : 'Booking Reminder!'}
      </h2>
      <p style="color:#6b7280;font-size:14px;margin:0;">
        Hi <strong>${name}</strong>, you have ${isProvider ? 'a job' : 'a booking'} in <strong style="color:#FF6B2B;">${label}</strong>
      </p>
    </div>

    <div style="background:#fff7f3;border-left:4px solid #FF6B2B;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:22px;">
      <p style="margin:0;color:#FF6B2B;font-weight:700;font-size:15px;">⏰ ${label} remaining</p>
      <p style="margin:4px 0 0;color:#6b7280;font-size:13px;">${isProvider ? 'Make sure you arrive on time!' : 'Please be ready at the location.'}</p>
    </div>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f7f4;border-radius:12px;margin-bottom:24px;">
      <tr><td style="padding:20px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          ${isProvider ? `
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Customer</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${customerName}</td>
          </tr>
          <tr style="border-top:1px solid #ebebeb;">
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Phone</td>
            <td style="padding:6px 0;color:#FF6B2B;font-size:14px;font-weight:700;">${customerPhone}</td>
          </tr>` : `
          <tr>
            <td style="padding:6px 0;color:#6b7280;font-size:13px;width:120px;">Provider</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${providerName}</td>
          </tr>`}
          <tr style="border-top:1px solid #ebebeb;">
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Service</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${serviceName}</td>
          </tr>
          <tr style="border-top:1px solid #ebebeb;">
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Date</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${scheduledDate}</td>
          </tr>
          <tr style="border-top:1px solid #ebebeb;">
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Time</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${scheduledTime}</td>
          </tr>
          <tr style="border-top:1px solid #ebebeb;">
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Location</td>
            <td style="padding:6px 0;color:#1a1714;font-size:14px;font-weight:700;">${address}</td>
          </tr>
          <tr style="border-top:1px solid #ebebeb;">
            <td style="padding:6px 0;color:#6b7280;font-size:13px;">Amount</td>
            <td style="padding:6px 0;color:#FF6B2B;font-size:16px;font-weight:900;">KSh ${Number(amount).toLocaleString()}</td>
          </tr>
        </table>
      </td></tr>
    </table>

    <div style="text-align:center;">
      <a href="https://kazishow.vercel.app/${isProvider ? 'provider/notifications' : 'profile'}"
         style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:15px;font-weight:800;padding:14px 36px;border-radius:50px;box-shadow:0 4px 14px rgba(255,107,43,0.35);">
        View Booking →
      </a>
    </div>
  `);
}

// 9. OTP / Password reset
function tplOTPEmail({ name, otp }) {
  return layout(`
    <div style="text-align:center;margin-bottom:28px;">
      <div style="font-size:52px;margin-bottom:8px;">🔐</div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:24px;font-weight:900;">Password Reset Code</h2>
      <p style="color:#6b7280;font-size:15px;margin:0;">Hi <strong>${name}</strong>, here is your reset code.</p>
    </div>

    <div style="background:#fff7f3;border:2px solid #FF6B2B;border-radius:16px;padding:28px;text-align:center;margin-bottom:24px;">
      <p style="margin:0 0 8px;color:#6b7280;font-size:13px;text-transform:uppercase;letter-spacing:1px;">Your OTP Code</p>
      <p style="margin:0;color:#FF6B2B;font-size:42px;font-weight:900;letter-spacing:10px;">${otp}</p>
      <p style="margin:12px 0 0;color:#9ca3af;font-size:12px;">Valid for 10 minutes · Do not share this code</p>
    </div>

    <p style="color:#6b7280;font-size:13px;text-align:center;margin:0;">
      If you did not request this, please ignore this email. Your account is safe.
    </p>
  `);
}

// 10. Job application submitted (to applicant)
function tplJobApplicationSubmitted({ applicantName, jobTitle, jobLocation, fee }) {
  return layout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:52px;margin-bottom:8px;">📋</div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:22px;font-weight:900;">Application Submitted!</h2>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi <strong>${applicantName}</strong>, your application is being reviewed.</p>
    </div>

    <div style="background:#fff7f3;border:1.5px solid #ffd5bc;border-radius:12px;padding:20px;margin-bottom:20px;">
      <p style="margin:0 0 4px;color:#FF6B2B;font-weight:800;font-size:16px;">${jobTitle}</p>
      <p style="margin:0;color:#6b7280;font-size:13px;">📍 ${jobLocation}</p>
      <p style="margin:8px 0 0;color:#374151;font-size:13px;">Application fee paid: <strong>KSh ${fee}</strong></p>
    </div>

    <div style="background:#f0fdf4;border-left:4px solid #10b981;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:20px;">
      <p style="margin:0;color:#166534;font-size:13px;font-weight:700;">What happens next?</p>
      <p style="margin:4px 0 0;color:#374151;font-size:13px;">Admin will verify your Equity payment within 1 hour. Once verified, the employer will review and call you if selected.</p>
    </div>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/jobs" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:12px 32px;border-radius:50px;">
        View My Applications →
      </a>
    </div>
  `);
}

// 11. Payment verified — to applicant
function tplJobPaymentVerified({ applicantName, jobTitle }) {
  return layout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:52px;margin-bottom:8px;">✅</div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:22px;font-weight:900;">Payment Verified!</h2>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi <strong>${applicantName}</strong>, great news!</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Your payment for <strong>"${jobTitle}"</strong> has been verified by KaziShow. Your application has been sent to the employer. They will review it and contact you directly if you are selected.
    </p>

    <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:18px;text-align:center;margin-bottom:20px;">
      <p style="margin:0;color:#166534;font-size:14px;font-weight:700;">Keep your phone on! 📱</p>
      <p style="margin:6px 0 0;color:#16a34a;font-size:13px;">The employer may call you at any time.</p>
    </div>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/jobs" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:12px 32px;border-radius:50px;">
        View Application →
      </a>
    </div>
  `);
}

// 12. Employer notified — payment verified (to employer)
function tplEmployerNewApplicant({ jobTitle, applicantName, applicantPhone }) {
  return layout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:52px;margin-bottom:8px;">👤</div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:22px;font-weight:900;">New Verified Applicant!</h2>
      <p style="color:#6b7280;font-size:14px;margin:0;">Someone applied for your job and payment is confirmed.</p>
    </div>

    <div style="background:#fff7f3;border:1.5px solid #ffd5bc;border-radius:12px;padding:20px;margin-bottom:20px;">
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Job</p>
      <p style="margin:0 0 12px;color:#1a1714;font-weight:800;font-size:16px;">${jobTitle}</p>
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:0.5px;">Applicant</p>
      <p style="margin:0 0 4px;color:#1a1714;font-weight:700;font-size:15px;">${applicantName}</p>
      <p style="margin:0;color:#FF6B2B;font-weight:700;font-size:14px;">📞 ${applicantPhone}</p>
    </div>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/jobs/employer" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:12px 32px;border-radius:50px;">
        Review Applicant →
      </a>
    </div>
  `);
}

// 13. Hired — to applicant
function tplJobHired({ applicantName, jobTitle, jobLocation, employerPhone }) {
  return layout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:52px;margin-bottom:8px;">🎉</div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:22px;font-weight:900;">You Got the Job!</h2>
      <p style="color:#6b7280;font-size:14px;margin:0;">Congratulations <strong>${applicantName}</strong>!</p>
    </div>

    <div style="background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px;margin-bottom:20px;">
      <p style="margin:0 0 4px;color:#166534;font-weight:800;font-size:16px;">${jobTitle}</p>
      <p style="margin:0;color:#16a34a;font-size:13px;">📍 ${jobLocation}</p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px;">
      The employer has selected you! Please contact them to confirm your start date and details.
    </p>

    <div style="background:#fff7f3;border:2px solid #FF6B2B;border-radius:12px;padding:18px;text-align:center;margin-bottom:20px;">
      <p style="margin:0 0 4px;color:#6b7280;font-size:12px;">Call the employer now</p>
      <p style="margin:0;color:#FF6B2B;font-size:22px;font-weight:900;">📞 ${employerPhone || 'Check your KaziShow app'}</p>
    </div>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/jobs" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:12px 32px;border-radius:50px;">
        Open KaziShow →
      </a>
    </div>
  `);
}

// 14. Rejected — to applicant
function tplJobRejected({ applicantName, jobTitle }) {
  return layout(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:52px;margin-bottom:8px;">💪</div>
      <h2 style="margin:0 0 8px;color:#1a1714;font-size:22px;font-weight:900;">Keep Applying!</h2>
      <p style="color:#6b7280;font-size:14px;margin:0;">Hi <strong>${applicantName}</strong></p>
    </div>

    <p style="color:#374151;font-size:14px;line-height:1.7;margin:0 0 20px;">
      Thank you for applying for <strong>"${jobTitle}"</strong> on KaziShow. Unfortunately, the employer selected another candidate this time. Don't give up — new jobs are posted daily!
    </p>

    <div style="text-align:center;">
      <a href="https://kazishow.co.ke/jobs" style="display:inline-block;background:linear-gradient(135deg,#FF6B2B,#FF8C42);color:#ffffff;text-decoration:none;font-size:14px;font-weight:800;padding:12px 32px;border-radius:50px;">
        Browse More Jobs →
      </a>
    </div>
  `);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  sendEmail,
  tplNewBooking,
  tplProviderApproved,
  tplProviderRejected,
  tplTipApproved,
  tplTipRejected,
  tplTestimonialApproved,
  tplTestimonialRejected,
  tplBookingReminder,
  tplOTPEmail,
  tplJobApplicationSubmitted,
  tplJobPaymentVerified,
  tplEmployerNewApplicant,
  tplJobHired,
  tplJobRejected,
};
