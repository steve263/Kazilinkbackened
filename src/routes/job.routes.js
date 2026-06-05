const express = require('express');
const router = express.Router();
const ctrl = require('../controllers/job.controller');
const { auth } = require('../middleware/auth');
const { upload } = require('../middleware/upload');

// ── Public ────────────────────────────────────────────────────────────────────
router.get('/', ctrl.getAllJobs);

// ── Public worker listing ─────────────────────────────────────────────────────
router.get('/workers/all', ctrl.getAllWorkers);
router.get('/workers/:id', ctrl.getWorkerById);

// ── Static worker routes (must be before /:id) ────────────────────────────────
router.post('/worker/register', auth, upload.fields([{ name: 'idPhoto', maxCount: 1 }]), ctrl.registerWorker);
router.get('/worker/profile',      auth, ctrl.getWorkerProfile);
router.put('/worker/availability', auth, ctrl.updateAvailability);
router.get('/worker/applications', auth, ctrl.getMyApplications);

// ── Static employer routes ────────────────────────────────────────────────────
router.post('/employer/register', auth, ctrl.registerEmployer);
router.get('/employer/profile',   auth, ctrl.getEmployerProfile);
router.get('/employer/jobs',      auth, ctrl.getMyPostedJobs);
router.get('/employer/dashboard', auth, ctrl.getEmployerDashboard);
router.get('/employer/jobs/:jobId/applicants',    auth, ctrl.getJobApplicants);
router.put('/employer/applications/:appId/hire',  auth, ctrl.employerHire);
router.put('/employer/applications/:appId/reject',auth, ctrl.employerReject);

// ── Static post route ─────────────────────────────────────────────────────────
router.post('/post', auth, ctrl.postJob);

// ── Application action routes (static :appId paths before /:id) ───────────────
router.post('/applications/:appId/complete', auth, ctrl.markJobComplete);
router.put('/applications/:appId/hire',      auth, ctrl.hireWorker);
router.put('/applications/:appId/decline',   auth, ctrl.declineWorker);
router.post('/applications/:appId/pay',      auth, ctrl.confirmPayment);

// ── Parameterised routes ──────────────────────────────────────────────────────
router.post('/:jobId/apply',         auth, ctrl.applyForJob);
router.get('/:jobId/applications',   auth, ctrl.getJobApplications);
router.get('/:id',                        ctrl.getJobById);   // catch-all last

module.exports = router;
