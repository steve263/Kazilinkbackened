const prisma = require('../config/db');
const { randomUUID } = require('crypto');
const smsSvc = require('../services/sms.service');
const { cloudinary } = require('../middleware/upload');

// ─── Get all open jobs ────────────────────────────────────────────────────────

async function getAllJobs(req, res) {
  try {
    const { category, location, urgent, search, page = 1, limit = 20 } = req.query;

    const where = { status: 'OPEN' };
    if (category) where.category = category;
    if (urgent === 'true') where.isUrgent = true;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (search) {
      where.OR = [
        { title:       { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { location:    { contains: search, mode: 'insensitive' } },
      ];
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          employer: { include: { employerProfile: true } },
          _count:   { select: { applications: true } },
        },
        orderBy: [{ isUrgent: 'desc' }, { createdAt: 'desc' }],
        skip:  (parseInt(page) - 1) * parseInt(limit),
        take:  parseInt(limit),
      }),
      prisma.job.count({ where }),
    ]);

    res.json({ success: true, data: jobs, total });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get job by ID ────────────────────────────────────────────────────────────

async function getJobById(req, res) {
  try {
    await prisma.job.update({
      where: { id: req.params.id },
      data:  { viewCount: { increment: 1 } },
    }).catch(() => {});

    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        employer: { include: { employerProfile: true } },
        applications: {
          where:  { status: 'HIRED' },
          select: { id: true, worker: { select: { name: true } } },
        },
        _count: { select: { applications: true } },
      },
    });

    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Register as worker ───────────────────────────────────────────────────────

async function registerWorker(req, res) {
  try {
    const { skills, experience, location, idNumber, bio } = req.body;
    const userId = req.user.id;

    const existing = await prisma.workerProfile.findUnique({ where: { userId } });
    if (existing) return res.status(400).json({ success: false, message: 'Worker profile already exists' });

    if (!skills?.trim() || !location?.trim() || !idNumber?.trim()) {
      return res.status(400).json({ success: false, message: 'skills, location and idNumber are required' });
    }

    let idPhotoUrl = null;
    if (req.files?.idPhoto?.[0]) {
      idPhotoUrl = await new Promise((resolve, reject) => {
        cloudinary.uploader.upload_stream(
          { folder: 'kazishow/worker-ids' },
          (err, result) => { if (err) reject(err); else resolve(result.secure_url); }
        ).end(req.files.idPhoto[0].buffer);
      });
    }

    const worker = await prisma.workerProfile.create({
      data: {
        id: randomUUID(),
        userId,
        skills:     skills.trim(),
        experience: experience?.trim() || null,
        location:   location.trim(),
        idNumber:   idNumber.trim(),
        idPhotoUrl,
        bio:        bio?.trim() || null,
      },
    });

    smsSvc.sendSMS(
      req.user.phone,
      `Welcome to KaziShow Jobs! Your worker profile is ready. You can now apply for casual jobs near ${location}. Visit kazishow.co.ke to find jobs now.`
    ).catch(console.error);

    res.json({ success: true, data: worker });
  } catch (err) {
    console.error('registerWorker error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Register as employer ─────────────────────────────────────────────────────

async function registerEmployer(req, res) {
  try {
    const { companyName, contactPerson, phone, location, companyType, description } = req.body;
    const userId = req.user.id;

    const existing = await prisma.employerProfile.findUnique({ where: { userId } });
    if (existing) return res.status(400).json({ success: false, message: 'Employer profile already exists' });

    if (!companyName?.trim() || !contactPerson?.trim() || !phone?.trim() || !location?.trim()) {
      return res.status(400).json({ success: false, message: 'companyName, contactPerson, phone and location are required' });
    }

    const employer = await prisma.employerProfile.create({
      data: {
        id:           randomUUID(),
        userId,
        companyName:  companyName.trim(),
        contactPerson: contactPerson.trim(),
        phone:        phone.trim(),
        location:     location.trim(),
        companyType:  companyType?.trim() || null,
        description:  description?.trim() || null,
      },
    });

    res.json({ success: true, data: employer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Post a job ───────────────────────────────────────────────────────────────

async function postJob(req, res) {
  try {
    const {
      title, description, category, location, address,
      pay, payType, workersNeeded, startDate, endDate,
      duration, skills, requirements, isUrgent,
    } = req.body;

    if (!title?.trim() || !description?.trim() || !category || !location?.trim() || !pay || !startDate) {
      return res.status(400).json({ success: false, message: 'title, description, category, location, pay and startDate are required' });
    }

    // Ensure employer profile exists (create minimal one if not)
    let employerProfile = await prisma.employerProfile.findUnique({ where: { userId: req.user.id } });
    if (!employerProfile) {
      employerProfile = await prisma.employerProfile.create({
        data: {
          id:            randomUUID(),
          userId:        req.user.id,
          companyName:   req.user.name || 'Private',
          contactPerson: req.user.name || 'Owner',
          phone:         req.user.phone || '',
          location:      location.trim(),
        },
      });
    }

    const job = await prisma.job.create({
      data: {
        id:             randomUUID(),
        employerId:     req.user.id,
        title:          title.trim(),
        description:    description.trim(),
        category,
        location:       location.trim(),
        address:        address?.trim() || null,
        pay:            parseFloat(pay),
        payType:        payType || 'per day',
        workersNeeded:  parseInt(workersNeeded) || 1,
        startDate:      new Date(startDate),
        endDate:        endDate ? new Date(endDate) : null,
        duration:       duration || '1 day',
        skills:         skills?.trim() || null,
        requirements:   requirements?.trim() || null,
        isUrgent:       isUrgent === 'true' || isUrgent === true,
      },
    });

    // Increment employer's job count
    await prisma.employerProfile.update({
      where: { userId: req.user.id },
      data:  { totalJobsPosted: { increment: 1 } },
    }).catch(() => {});

    console.log(`📢 Job posted: "${title}" in ${location} — KSh ${pay}`);
    res.json({ success: true, data: job, message: 'Job posted successfully!' });
  } catch (err) {
    console.error('postJob error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Apply for job ────────────────────────────────────────────────────────────

async function applyForJob(req, res) {
  try {
    const { jobId } = req.params;
    const { workerNote, applicantName, applicantPhone, applicantBio, mpesaRef, applicationFee } = req.body;
    const workerId = req.user.id;

    const existing = await prisma.jobApplication.findFirst({ where: { jobId, workerId } });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already applied for this job' });
    }

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: { employer: { include: { employerProfile: true } } },
    });
    if (!job || job.status !== 'OPEN') {
      return res.status(400).json({ success: false, message: 'This job is no longer available' });
    }
    if (job.workersHired >= job.workersNeeded) {
      return res.status(400).json({ success: false, message: 'This job is already fully filled' });
    }

    // Determine payment status: if applicant provided M-Pesa ref, mark as pending verification
    const isPaidFlow = !!(applicantName && applicantPhone && mpesaRef);
    const paymentStatus = isPaidFlow ? 'PENDING_VERIFICATION' : 'PENDING';

    const application = await prisma.jobApplication.create({
      data: {
        id:        randomUUID(),
        jobId,
        workerId,
        ...(workerNote     ? { workerNote:     workerNote.trim()     } : {}),
        ...(applicantName  ? { applicantName:  applicantName.trim()  } : {}),
        ...(applicantPhone ? { applicantPhone: applicantPhone.trim() } : {}),
        ...(applicantBio   ? { applicantBio:   applicantBio.trim()   } : {}),
        ...(mpesaRef       ? { mpesaRef:       mpesaRef.trim()       } : {}),
        ...(applicationFee ? { applicationFee: parseFloat(applicationFee) } : {}),
        paymentStatus,
      },
    });

    // Notify employer
    const employerPhone = job.employer?.employerProfile?.phone;
    if (employerPhone) {
      smsSvc.sendSMS(
        employerPhone,
        `New application for "${job.title}" on KaziShow! ${applicantName || req.user.name} applied. Open KaziShow to review and hire. kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, data: application, message: 'Application submitted!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Hire a worker ────────────────────────────────────────────────────────────

async function hireWorker(req, res) {
  try {
    const { appId } = req.params;

    const application = await prisma.jobApplication.update({
      where: { id: appId },
      data:  { status: 'HIRED' },
      include: { job: true, worker: true },
    });

    await prisma.job.update({
      where: { id: application.jobId },
      data:  { workersHired: { increment: 1 } },
    });

    // Auto-fill if all workers hired
    const job = await prisma.job.findUnique({ where: { id: application.jobId } });
    if (job && job.workersHired >= job.workersNeeded) {
      await prisma.job.update({ where: { id: job.id }, data: { status: 'FILLED' } });
    }

    // SMS to hired worker
    if (application.worker?.phone) {
      const startStr = new Date(application.job.startDate).toLocaleString('en-KE', {
        weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      });
      smsSvc.sendSMS(
        application.worker.phone,
        `Congratulations! You have been hired for "${application.job.title}" on KaziShow. Report to ${application.job.address || application.job.location} on ${startStr}. You will receive KSh ${Math.round(application.job.pay * 0.9)} via M-Pesa after completion. kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, message: 'Worker hired!' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Decline worker ───────────────────────────────────────────────────────────

async function declineWorker(req, res) {
  try {
    const { appId } = req.params;

    const application = await prisma.jobApplication.update({
      where: { id: appId },
      data:  { status: 'DECLINED' },
      include: { worker: true },
    });

    if (application.worker?.phone) {
      smsSvc.sendSMS(
        application.worker.phone,
        `Your application was not successful this time. Keep applying for more jobs on KaziShow! kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, message: 'Application declined' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Mark job complete ────────────────────────────────────────────────────────

async function markJobComplete(req, res) {
  try {
    const { appId } = req.params;

    const application = await prisma.jobApplication.update({
      where: { id: appId },
      data:  { status: 'COMPLETED', completedAt: new Date() },
      include: {
        job: { include: { employer: { include: { employerProfile: true } } } },
        worker: true,
      },
    });

    const employerPhone = application.job.employer?.employerProfile?.phone;
    if (employerPhone) {
      smsSvc.sendSMS(
        employerPhone,
        `${application.worker?.name} has completed "${application.job.title}" on KaziShow. Please confirm and pay KSh ${Math.round(application.job.pay * 0.9)} to the worker via M-Pesa. Open KaziShow to confirm. kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, message: 'Job marked as complete. Employer has been notified to pay.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Confirm payment ──────────────────────────────────────────────────────────

async function confirmPayment(req, res) {
  try {
    const { appId } = req.params;
    const { mpesaRef } = req.body;

    const application = await prisma.jobApplication.findUnique({
      where: { id: appId },
      include: { job: true, worker: true },
    });
    if (!application) return res.status(404).json({ success: false, message: 'Application not found' });

    const workerPay  = Math.round(application.job.pay * 0.9);
    const commission = Math.round(application.job.pay * 0.1);

    await prisma.jobApplication.update({
      where: { id: appId },
      data: {
        paymentStatus: 'PAID',
        paymentAmount: workerPay,
        mpesaRef:      mpesaRef?.trim() || null,
      },
    });

    await prisma.workerProfile.update({
      where: { userId: application.workerId },
      data: {
        totalJobs:     { increment: 1 },
        totalEarnings: { increment: workerPay },
      },
    }).catch(() => {});

    if (application.worker?.phone) {
      smsSvc.sendSMS(
        application.worker.phone,
        `Payment confirmed! KSh ${workerPay} for "${application.job.title}" via M-Pesa${mpesaRef ? ` (${mpesaRef})` : ''}. KaziShow took KSh ${commission} commission. Find more jobs at kazishow.co.ke`
      ).catch(console.error);
    }

    res.json({ success: true, message: 'Payment confirmed', workerPay, commission });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get my applications (worker) ─────────────────────────────────────────────

async function getMyApplications(req, res) {
  try {
    const applications = await prisma.jobApplication.findMany({
      where: { workerId: req.user.id },
      include: {
        job: { include: { employer: { include: { employerProfile: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: applications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get job applications (employer) ─────────────────────────────────────────

async function getJobApplications(req, res) {
  try {
    const { jobId } = req.params;
    const applications = await prisma.jobApplication.findMany({
      where: { jobId },
      include: { worker: { include: { workerProfile: true } } },
      orderBy: { createdAt: 'asc' },
    });
    res.json({ success: true, data: applications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get my posted jobs (employer) ────────────────────────────────────────────

async function getMyPostedJobs(req, res) {
  try {
    const jobs = await prisma.job.findMany({
      where: { employerId: req.user.id },
      include: { _count: { select: { applications: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ success: true, data: jobs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get worker profile ───────────────────────────────────────────────────────

async function getWorkerProfile(req, res) {
  try {
    const profile = await prisma.workerProfile.findUnique({ where: { userId: req.user.id } });
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get employer profile ─────────────────────────────────────────────────────

async function getEmployerProfile(req, res) {
  try {
    const profile = await prisma.employerProfile.findUnique({ where: { userId: req.user.id } });
    res.json({ success: true, data: profile });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Update availability ──────────────────────────────────────────────────────

async function updateAvailability(req, res) {
  try {
    const { isAvailable } = req.body;
    await prisma.workerProfile.update({
      where: { userId: req.user.id },
      data:  { isAvailable: Boolean(isAvailable) },
    });
    res.json({ success: true, message: `Availability set to ${isAvailable}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get all worker profiles (public) ────────────────────────────────────────

async function getAllWorkers(req, res) {
  try {
    const { skills, location, search } = req.query;
    const where = {};

    if (skills && skills !== 'All') {
      where.skills = { contains: skills, mode: 'insensitive' };
    }
    if (location) {
      where.location = { contains: location, mode: 'insensitive' };
    }
    if (search) {
      where.OR = [
        { skills:    { contains: search, mode: 'insensitive' } },
        { location:  { contains: search, mode: 'insensitive' } },
        { bio:       { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const workers = await prisma.workerProfile.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
      orderBy: [{ isAvailable: 'desc' }, { rating: 'desc' }, { totalJobs: 'desc' }],
    });

    res.json({ success: true, data: workers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ─── Get worker by userId (public profile) ────────────────────────────────────

async function getWorkerById(req, res) {
  try {
    const worker = await prisma.workerProfile.findUnique({
      where: { userId: req.params.id },
      include: {
        user: { select: { id: true, name: true, phone: true } },
      },
    });

    if (!worker) return res.status(404).json({ success: false, message: 'Worker not found' });
    res.json({ success: true, data: worker });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

module.exports = {
  getAllJobs, getJobById,
  registerWorker, registerEmployer,
  postJob, applyForJob,
  hireWorker, declineWorker,
  markJobComplete, confirmPayment,
  getMyApplications, getJobApplications,
  getMyPostedJobs, getWorkerProfile,
  getEmployerProfile, updateAvailability,
  getAllWorkers, getWorkerById,
};
