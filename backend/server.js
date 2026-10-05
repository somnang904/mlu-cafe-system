const { assertRequiredEnv, env } = require('./src/config/env');
const { STORE } = require('./src/config/store');
assertRequiredEnv();

const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./db'); // Import our database connection pool
const { resolveDbHost } = require('./db');
const {
    normalizeIncomingTarget,
    targetIdSelectSql,
    findPendingOrderId,
    createPendingOrder,
    insertOrderItem,
    validateOrderLine,
    logOrderError,
    pendingOrderWhereClause,
    resolveTableForeignKey,
    ensureOrderItemsSchema,
    formatOrderLineName,
    pickLinePrices,
    billMatchesBase,
    pendingOrderLockName,
    tableLockName,
} = require('./src/utils/orderTargets');
const { normalizeAllowedRole, passwordPolicyError, assignableRoleError } = require('./src/utils/accountPolicy');
const { generateTemporaryPassword, hashPassword } = require('./src/utils/userAccounts');
const { saveMenuImage } = require('./src/utils/menuImage');
const { downloadRemoteImage } = require('./src/utils/remoteImage');
const {
    ensureSessionSecuritySchema,
    invalidateUserTokens,
    startRevokedTokenCleanup,
    signSessionToken,
    SESSION_DAYS,
} = require('./src/utils/sessionSecurity');
const {
    normalizePermissions,
    assertPermissionsForSave,
    isAdminRole,
    userHasPermission,
    VALID_PERMISSIONS,
} = require('./src/constants/permissions');
const {
    authenticateToken,
    rejectUntilPasswordChanged,
    requireAdmin,
    requirePermission,
    requireAnyPermission,
} = require('./src/middleware/auth');
const multer = require('multer');
const { exportBusinessDataFile } = require('./src/utils/backupExport');
const { createSalesPdf } = require('./src/utils/salesPdf');
const { createReportExport } = require('./src/utils/reportExport');
const { refundDateSql, refundedStatusSql, saleStatusSql } = require('./src/utils/salesTotals');
const { createDownloadDump, pipeDownload, restoreDatabaseFromFile } = require('./src/utils/backupSql');
const { ensureApplicationSchema } = require('./src/utils/ensureAppSchema');
const { applyStocktake, stocktakeNote, buildStocktakeWorkbook } = require('./src/utils/stocktake');
const { isUnderMaintenance, maintenanceMessage } = require('./src/utils/maintenance');
const { parseBackupPeriod, buildBackupFilename } = require('./src/utils/backupPeriod');
const { buildActiveAlerts } = require('./src/utils/alertEngine');
const {
    ensureMenuItemsSchema,
    menuCategoryFieldSql,
    normalizeMenuCategory,
    normalizeMenuImageUrl,
    normalizeMenuPrices,
    serializeMenuItem,
} = require('./src/utils/menuItemsSchema');
const { buildSalesReport } = require('./src/utils/reports');
const { ensureInventorySchema } = require('./src/utils/inventorySchema');
const { createInventoryItem, editInventoryItem } = require('./src/utils/inventoryItems');
const { ensureStockSchema } = require('./src/utils/stockSchema');
const {
    reconcileOrderStock,
    addReceivedStock,
    adjustStockToCount,
    withTransaction,
} = require('./src/utils/stockLedger');
const { planSplitCheckout } = require('./src/utils/splitCheckout');
const {
    assertRefundable,
    createApprovalLimiter,
    resolveRefundApprover,
} = require('./src/utils/refund');
const { ensureOrdersSchema } = require('./src/utils/ordersSchema');
const {
    getCurrentShift,
    startShift,
    endShift,
    listShiftHistory,
} = require('./src/utils/shifts');
const { normalizeCheckoutPayment } = require('./src/utils/cashDrawer');
const {
    ensureExpensesSchema,
    listExpenses,
    createExpense,
    deleteExpense,
    summarizeExpensesToday,
} = require('./src/utils/expenses');
const {
    ensureAuditSchema,
    writeAuditLog,
    auditFromRequest,
    listAuditLogs,
} = require('./src/utils/auditLog');
const helmet = require('helmet');
const { sanitizeRequest } = require('./src/middleware/sanitize');
const { apiLimiter, createPasswordResetLimiter, sensitiveOperationLimiter } = require('./src/middleware/rateLimit');
const { errorHandler, notFoundHandler } = require('./src/middleware/errorHandler');
const { logError, logSecurity } = require('./src/utils/logger');
const { publicAuthRouter, privateAuthRouter, rejectPublicSignup } = require('./src/routes/auth');
const {
    listUnreadUserAlerts,
    markNotificationRead,
    ensureAdminNotificationsSchema,
    notifyAdminsOfExpense,
} = require('./src/utils/adminNotifications');
const { ensureUsersEmailColumn } = require('./src/utils/userAccounts');
const {
    ensureReservationsSchema,
    listFloorTables,
    listReservations,
    getReservation,
    createReservation,
    updateReservation,
    checkInReservation,
    deleteReservation,
    getAvailableTables,
    getLiveFloorReservations,
    TIME_SLOTS,
    ALL_STATUSES,
} = require('./src/utils/reservations');
const { processReservationReminders, startReservationReminderJob, notifyReservationCreated } = require('./src/utils/reservationReminders');
const { sendReservationConfirmationLetter } = require('./src/utils/reservationLetter');
const { getLiveConditions } = require('./src/utils/liveConditions');
const { createUserSession } = require('./src/utils/userSessions');
const {
    ensureLoginSecuritySchema,
    createMysqlSecurityStore,
    createBlockedDeviceMiddleware,
    listNewSecurityAlertFeed,
    startLoginSecurityCleanup,
} = require('./src/utils/loginSecurity');
const { createSecurityAlertsRouter } = require('./src/routes/securityAlerts');
const { createSecuritySessionsRouter } = require('./src/routes/securitySessions');

const app = express();

// Behind a reverse proxy this makes req.ip the real client address so rate limiting
// keys correctly. Left off by default: trusting the header without a proxy in front
// would let anyone spoof X-Forwarded-For and bypass the login limiter.
app.set('trust proxy', env.security.trustProxy ? 1 : false);
app.disable('x-powered-by');

// req.secure already follows the trust-proxy setting, so X-Forwarded-Proto is
// honored only when TRUST_PROXY is on. 308 keeps the original method and body.
// Health checks stay on the original scheme so reverse-proxy / load-balancer
// probes over plain HTTP do not get stuck in a redirect loop.
if (env.isProduction) {
    app.use((req, res, next) => {
        if (String(req.originalUrl || '').startsWith('/api/health')) return next();
        if (req.secure) return next();
        const host = req.get('host');
        if (!host) return next();
        return res.redirect(308, `https://${host}${req.originalUrl}`);
    });
}

app.use(helmet({
    // The API serves JSON plus menu photo downloads; it never renders HTML itself.
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            objectSrc: ["'none'"],
            frameAncestors: ["'none'"],
            baseUri: ["'self'"],
        },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    hsts: env.isProduction ? { maxAge: 31536000, includeSubDomains: true } : false,
}));

const allowedOrigins = env.security.allowedOrigins;
app.use(cors({
    origin(origin, callback) {
        // Same-origin and server-to-server calls arrive without an Origin header.
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin.replace(/\/$/, ''))) return callback(null, true);
        logSecurity('cors_blocked', { origin });
        return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    exposedHeaders: ['Retry-After', 'X-Renewed-Token'],
    maxAge: 600,
}));

// Bounded body size keeps a single request from exhausting memory.
app.use(express.json({ limit: env.security.jsonBodyLimit }));
app.use(express.urlencoded({ extended: false, limit: env.security.jsonBodyLimit }));
app.use(sanitizeRequest);

// ==========================================
// 🩺 PUBLIC HEALTH (no auth — for uptime / deploy probes)
// ==========================================
app.get('/api/health', async (_req, res) => {
    const started = Date.now();
    try {
        await db.execute('SELECT 1');
        return res.status(200).json({
            ok: true,
            service: 'mlu-kitchen-cafe-api',
            database: 'up',
            uptimeSec: Math.round(process.uptime()),
            latencyMs: Date.now() - started,
        });
    } catch (error) {
        logError(error, { route: 'GET /api/health' });
        return res.status(503).json({
            ok: false,
            service: 'mlu-kitchen-cafe-api',
            database: 'down',
            uptimeSec: Math.round(process.uptime()),
            latencyMs: Date.now() - started,
        });
    }
});

// ==========================================
// 🖼️ STATIC UPLOADS (menu images, uploads — public access for <img> tags)
// ==========================================
const uploadsDir = path.join(__dirname, 'uploads');
const menuUploadsDir = path.join(uploadsDir, 'menu');
if (!fs.existsSync(menuUploadsDir)) {
    fs.mkdirSync(menuUploadsDir, { recursive: true });
}
app.use('/api/uploads', express.static(uploadsDir, { maxAge: '7d' }));
app.use('/uploads', express.static(uploadsDir, { maxAge: '7d' }));

// ==========================================
// 🔐 PUBLIC AUTH (login, password reset — no JWT)
// Blocked devices are rejected before login or any other API route.
// ==========================================
const loginSecurityStore = createMysqlSecurityStore(db);
app.use('/api', createBlockedDeviceMiddleware(loginSecurityStore));
app.use('/api/auth', publicAuthRouter);
app.post('/api/register', rejectPublicSignup);
app.post('/api/signup', rejectPublicSignup);
app.get('/api/register', rejectPublicSignup);
app.get('/api/signup', rejectPublicSignup);

// ==========================================
// 🔐 AUTHENTICATED API ROUTES (JWT + live DB permissions)
// ==========================================
app.use('/api', apiLimiter, authenticateToken, rejectUntilPasswordChanged);
app.use('/api/auth', privateAuthRouter);
app.use('/api/security-alerts', createSecurityAlertsRouter({
    store: loginSecurityStore,
    requireAdmin,
}));
app.use('/api/security', createSecuritySessionsRouter());

// ==========================================
// 🛡️ FEATURE-LEVEL AUTHORIZATION GUARDS
// ------------------------------------------
// Server-side mirror of the frontend permission model. The UI already hides
// screens a user cannot access; these guards enforce the same rules on the API
// so a permission can't be bypassed by calling an endpoint directly. Admins
// always pass (userHasPermission short-circuits for the admin role).
// ==========================================
const requirePosFloorAccess = requireAnyPermission('order', 'payment', 'table');
const requireOrderWriteAccess = requireAnyPermission('order', 'payment');
const requireSalesHistoryAccess = requirePermission('sales_history');
const requireExpenseAccess = requirePermission('reports');
const requireExpenseWriteAccess = requireAnyPermission('reports', 'inventory_stock');
const requireExpenseSummaryAccess = requirePermission('reports');
const requireDashboardAccess = requirePermission('dashboard');
const requireStockAccess = requirePermission('inventory_stock');
const requireBackupDownloadAccess = requirePermission('backup_recovery');

// ==========================================
// 👥 EMPLOYEES & USER MANAGEMENT API ROUTES
// ==========================================

function serializePermissionsForRole(role, permissions) {
    if (isAdminRole(role)) {
        return { ok: true, list: [...VALID_PERMISSIONS], json: JSON.stringify(VALID_PERMISSIONS) };
    }
    return assertPermissionsForSave(permissions);
}

async function countActiveAdmins(executor = db) {
    const [rows] = await executor.execute(
        `SELECT COUNT(*) AS admin_count FROM users WHERE LOWER(role) = 'admin' AND is_active = 1`,
    );
    return Number(rows[0]?.admin_count || 0);
}

function permissionListLabel(list) {
    return list.length ? list.join(', ') : 'none';
}

// 1. FETCH ALL USER PROFILES WITH SYSTEM PERMISSIONS
app.get('/api/users', requireAdmin, async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT id, display_name, username, role, permissions
             FROM users
             ORDER BY CASE WHEN LOWER(role) = 'admin' THEN 0 ELSE 1 END, display_name ASC`,
        );

        // Safely parse the permissions JSON string back into an array for React
        const users = rows.map((u) => ({
            id: u.id,
            display_name: u.display_name,
            username: u.username,
            role: u.role,
            permissions: isAdminRole(u.role) ? [...VALID_PERMISSIONS] : normalizePermissions(u.permissions),
        }));

        res.status(200).json(users);
    } catch (error) {
        console.error("❌ FETCH USERS ERROR:", error.message);
        res.status(500).json({ message: "Failed to load employee profiles" });
    }
});

// 2. REGISTER A SECURE ACCOUNT WITH ENCRYPTED PASSWORD
app.post('/api/users', requireAdmin, async (req, res) => {
    const { display_name, username, password, role, permissions } = req.body ?? {};

    if (!display_name || !username || !password) {
        return res.status(400).json({ message: "All identification boxes are required" });
    }

    const trimmedPassword = String(password);
    const policyError = passwordPolicyError(trimmedPassword);
    if (policyError) {
        return res.status(400).json({ message: policyError });
    }

    const allowedRole = normalizeAllowedRole(role || 'Staff');
    if (!allowedRole || allowedRole === 'Admin') {
        return res.status(400).json({ message: assignableRoleError(role || 'Admin') || 'Role must be Cashier or Staff.' });
    }
    const assignError = assignableRoleError(role);
    if (assignError) {
        return res.status(400).json({ message: assignError });
    }

    const savedPermissions = serializePermissionsForRole(allowedRole, permissions);
    if (!savedPermissions.ok) {
        return res.status(400).json({ message: savedPermissions.message });
    }

    try {
        const normalizedUsername = String(username).trim().toLowerCase();
        const [existing] = await db.execute('SELECT id FROM users WHERE username = ?', [normalizedUsername]);
        if (existing.length > 0) {
            return res.status(400).json({ message: "Username is already taken" });
        }

        const passwordHash = await hashPassword(trimmedPassword);

        const [created] = await db.execute(
            'INSERT INTO users (display_name, username, password_hash, role, permissions) VALUES (?, ?, ?, ?, ?)',
            [display_name, normalizedUsername, passwordHash, allowedRole, savedPermissions.json]
        );

        await auditFromRequest(db, req, {
            action: 'user_create',
            module: 'Users',
            description: `Created user ${normalizedUsername} (${display_name}). Role: ${allowedRole}. Permissions: ${permissionListLabel(savedPermissions.list)}.`,
        });

        res.status(201).json({ message: "New user profile established securely!", id: created.insertId });
    } catch (error) {
        console.error("❌ CREATE USER ERROR:", error.message);
        res.status(500).json({ message: "Failed to build secure user account" });
    }
});

// 3. UPDATE USER ROLE & PERMISSION GATES IN REAL TIME
app.put('/api/users/:id', requireAdmin, async (req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    const { display_name, role, permissions, password, is_active: isActiveRaw } = req.body ?? {};

    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ message: 'Invalid user id' });
    }

    if (!display_name || !role) {
        return res.status(400).json({ message: 'Display name and role are required' });
    }

    const allowedRole = normalizeAllowedRole(role);
    if (!allowedRole) {
        return res.status(400).json({ message: 'Role must be Cashier or Staff.' });
    }

    try {
        const [existingRows] = await db.execute(
            `SELECT id, display_name, username, role, permissions, is_active
             FROM users WHERE id = ? LIMIT 1`,
            [userId],
        );
        if (!existingRows.length) {
            return res.status(404).json({ message: 'User not found' });
        }

        const existing = existingRows[0];
        const previousRole = existing.role;
        const previousPermissions = isAdminRole(previousRole)
            ? [...VALID_PERMISSIONS]
            : normalizePermissions(existing.permissions);
        const previousActive = existing.is_active == null ? true : Number(existing.is_active) === 1;
        const previousNormalized = normalizeAllowedRole(previousRole);

        if (!isAdminRole(previousRole)) {
            const assignError = assignableRoleError(role);
            if (assignError) {
                return res.status(400).json({ message: assignError });
            }
        }

        // Existing Admin keeps Admin forever through this API (no demote / no role swap).
        if (isAdminRole(previousRole) && allowedRole !== 'Admin') {
            return res.status(400).json({ message: 'The Admin role cannot be changed.' });
        }

        // Nobody can be promoted to Admin (exactly one Admin account).
        if (allowedRole === 'Admin' && previousNormalized !== 'Admin') {
            return res.status(400).json({
                message: 'Cannot promote a user to Admin. This system has exactly one Admin account.',
            });
        }

        if (Number(req.user?.id) === userId && allowedRole !== previousNormalized) {
            return res.status(400).json({ message: 'You cannot change your own role.' });
        }

        const demotingLastAdmin =
            isAdminRole(previousRole)
            && !isAdminRole(allowedRole)
            && (await countActiveAdmins()) <= 1;
        if (demotingLastAdmin) {
            return res.status(400).json({ message: 'Cannot demote the last administrator account.' });
        }

        let nextActive = previousActive;
        if (isActiveRaw !== undefined) {
            nextActive = !(isActiveRaw === false || isActiveRaw === 0 || isActiveRaw === '0');
            if (
                isAdminRole(previousRole)
                && previousActive
                && !nextActive
                && (await countActiveAdmins()) <= 1
            ) {
                return res.status(400).json({ message: 'Cannot disable the last administrator account.' });
            }
        }

        const savedPermissions = serializePermissionsForRole(allowedRole, permissions);
        if (!savedPermissions.ok) {
            return res.status(400).json({ message: savedPermissions.message });
        }

        const nextPassword = password != null ? String(password) : '';

        if (nextPassword) {
            const policyError = passwordPolicyError(nextPassword);
            if (policyError) {
                return res.status(400).json({ message: policyError });
            }

            const passwordHash = await hashPassword(nextPassword);
            await invalidateUserTokens(db, userId);
            await db.execute(
                `UPDATE users
                 SET display_name = ?, role = ?, permissions = ?, is_active = ?,
                     password_hash = ?, must_change_password = 0
                 WHERE id = ?`,
                [display_name, allowedRole, savedPermissions.json, nextActive ? 1 : 0, passwordHash, userId],
            );
        } else {
            await db.execute(
                `UPDATE users
                 SET display_name = ?, role = ?, permissions = ?, is_active = ?
                 WHERE id = ?`,
                [display_name, allowedRole, savedPermissions.json, nextActive ? 1 : 0, userId],
            );
        }

        const [updatedRows] = await db.execute(
            'SELECT id, display_name, username, role, permissions, must_change_password, is_active FROM users WHERE id = ? LIMIT 1',
            [userId],
        );

        const updated = updatedRows[0];
        const updatedUser = {
            id: updated.id,
            display_name: updated.display_name,
            username: updated.username,
            role: updated.role,
            permissions: isAdminRole(updated.role)
                ? [...VALID_PERMISSIONS]
                : normalizePermissions(updated.permissions),
            must_change_password: Number(updated.must_change_password) === 1,
            is_active: updated.is_active == null ? true : Number(updated.is_active) === 1,
        };

        if (normalizeAllowedRole(previousRole) !== allowedRole) {
            await auditFromRequest(db, req, {
                action: 'user_role_change',
                module: 'Users',
                description: `Changed role for ${existing.username} from ${previousRole} to ${allowedRole}.`,
            });
        }

        const prevPermKey = previousPermissions.slice().sort().join(',');
        const nextPermKey = savedPermissions.list.slice().sort().join(',');
        if (prevPermKey !== nextPermKey) {
            await auditFromRequest(db, req, {
                action: 'user_permissions_change',
                module: 'Users',
                description: `Changed permissions for ${existing.username}. Old: ${permissionListLabel(previousPermissions)}. New: ${permissionListLabel(savedPermissions.list)}.`,
            });
        }

        if (previousActive !== nextActive) {
            await auditFromRequest(db, req, {
                action: nextActive ? 'user_enabled' : 'user_disabled',
                module: 'Users',
                description: `${nextActive ? 'Enabled' : 'Disabled'} user ${existing.username}.`,
            });
        }

        if (nextPassword) {
            await auditFromRequest(db, req, {
                action: 'password_reset',
                module: 'Users',
                description: `Password reset by ${req.user?.username || 'admin'} for target ${existing.username} (id ${existing.id}).`,
            });
        }

        const response = {
            message: 'User permissions updated successfully',
            user: updatedUser,
        };

        if (nextPassword && req.user?.id === userId) {
            const issued = await signSessionToken(db, updatedUser);
            await createUserSession(db, { jti: issued.jti, userId, req });
            response.token = issued.token;
        }

        res.status(200).json(response);
    } catch (error) {
        console.error('❌ UPDATE USER ERROR:', error.message);
        res.status(500).json({ message: 'Failed to update user permissions' });
    }
});

app.post('/api/users/:id/reset-password', createPasswordResetLimiter(), requireAdmin, async (req, res) => {
    const userId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ message: 'Invalid user id' });
    }

    try {
        const [existingRows] = await db.execute(
            'SELECT id, display_name, username, role, permissions FROM users WHERE id = ? LIMIT 1',
            [userId],
        );
        if (!existingRows.length) {
            return res.status(404).json({ message: 'User not found' });
        }

        const temporaryPassword = generateTemporaryPassword();
        const passwordHash = await hashPassword(temporaryPassword);
        await invalidateUserTokens(db, userId);
        await db.execute(
            'UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?',
            [passwordHash, userId],
        );

        const account = existingRows[0];
        await auditFromRequest(db, req, {
            action: 'password_reset',
            module: 'Users',
            description: `Administrator ${req.user?.username || 'admin'} reset the password for ${account.username} (id ${account.id}). They must change it at next login.`,
        });

        const response = {
            message: 'Temporary password created. It is shown once and is not stored.',
            temporaryPassword,
            user: {
                id: account.id,
                username: account.username,
                must_change_password: true,
            },
        };

        if (req.user?.id === userId) {
            const issued = await signSessionToken(db, {
                ...account,
                permissions: isAdminRole(account.role)
                    ? [...VALID_PERMISSIONS]
                    : normalizePermissions(account.permissions),
                must_change_password: true,
            });
            await createUserSession(db, { jti: issued.jti, userId, req });
            response.token = issued.token;
            response.user = {
                id: account.id,
                display_name: account.display_name,
                username: account.username,
                role: account.role,
                permissions: isAdminRole(account.role)
                    ? [...VALID_PERMISSIONS]
                    : normalizePermissions(account.permissions),
                must_change_password: true,
            };
        }

        res.status(200).json(response);
    } catch (error) {
        console.error('❌ RESET PASSWORD ERROR:', error.message);
        res.status(500).json({ message: 'Failed to reset password' });
    }
});

app.delete('/api/users/:id', requireAdmin, async (req, res) => {
    const userId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ message: 'Invalid user id' });
    }

    if (Number(req.user?.id) === userId) {
        return res.status(400).json({ message: 'You cannot delete your own account.' });
    }

    try {
        const [existingRows] = await db.execute(
            'SELECT id, display_name, username, role FROM users WHERE id = ? LIMIT 1',
            [userId],
        );
        if (!existingRows.length) {
            return res.status(404).json({ message: 'User not found' });
        }

        const target = existingRows[0];
        if (isAdminRole(target.role) && (await countActiveAdmins()) <= 1) {
            return res.status(400).json({ message: 'Cannot delete the last administrator account.' });
        }

        try {
            await db.execute('DELETE FROM admin_notifications WHERE recipient_user_id = ?', [userId]);
        } catch (notificationError) {
            if (notificationError.code !== 'ER_NO_SUCH_TABLE') {
                throw notificationError;
            }
        }

        const [result] = await db.execute('DELETE FROM users WHERE id = ?', [userId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'User not found' });
        }

        await auditFromRequest(db, req, {
            action: 'user_delete',
            module: 'User Management',
            description: `Deleted user ${target.username} (${target.display_name})`,
        });

        res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('❌ DELETE USER ERROR:', error.message);
        res.status(500).json({
            message: 'Failed to delete user',
            errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }),
        });
    }
});

// ==========================================
// ☕ MENU MANAGEMENT API ROUTES
// ==========================================

// Held in memory only long enough to be downscaled and written as WebP by saveMenuImage.
// The browser compresses before upload, so this cap only matters for direct API calls.
const menuImageUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB limit
    // Loose pre-check only: saveMenuImage decodes the bytes, which is the real validation.
    // Windows often sends HEIC/TIFF as application/octet-stream, hence the extension test.
    fileFilter: (_req, file, cb) => {
        const mime = String(file.mimetype || '').toLowerCase();
        const looksLikeImage = mime.startsWith('image/')
            || /\.(heic|heif|avif|webp|jpe?g|jfif|png|gif|bmp|tiff?|svg|ico)$/i.test(file.originalname || '');
        if (!looksLikeImage) {
            cb(new Error('Please choose an image file'));
            return;
        }
        cb(null, true);
    },
});

function sendMenuImageError(res, error) {
    if (error.status === 400) {
        return res.status(400).json({ message: error.message });
    }
    console.error('Menu image save failed:', error);
    return res.status(500).json({ message: 'Failed to save image' });
}

// IMPORT MENU ITEM IMAGE FROM A LINK
// The server downloads and compresses the picture so the menu never depends on another
// site keeping it online, and formats browsers cannot show (TIFF...) still work.
app.post('/api/menu/import-image-url', requirePermission('menu'), async (req, res) => {
    try {
        const { buffer, fileName } = await downloadRemoteImage(req.body?.url);
        const filename = await saveMenuImage(buffer, fileName, menuUploadsDir);
        return res.status(200).json({ ok: true, imageUrl: `/api/uploads/menu/${filename}`, filename });
    } catch (error) {
        return sendMenuImageError(res, error);
    }
});

// UPLOAD MENU ITEM IMAGE FILE
app.post('/api/menu/upload-image', requirePermission('menu'), (req, res) => {
    menuImageUpload.single('image')(req, res, async (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(400).json({ message: 'Image file must be under 30 MB' });
            }
            return res.status(400).json({ message: err.message || 'Failed to upload image' });
        }
        if (!req.file) {
            return res.status(400).json({ message: 'Please select an image file to upload' });
        }
        try {
            const filename = await saveMenuImage(req.file.buffer, req.file.originalname, menuUploadsDir);
            return res.status(200).json({
                ok: true,
                imageUrl: `/api/uploads/menu/${filename}`,
                filename,
            });
        } catch (saveError) {
            return sendMenuImageError(res, saveError);
        }
    });
});

// 1. GET ALL MENU ITEMS (To display them on your frontend grid)
app.get('/api/menu', async (req, res) => {
    try {
        const [items] = await db.execute(
            `SELECT id, name, category, price, hot_price, iced_price, image_url, is_available
             FROM menu_items
             ORDER BY ${menuCategoryFieldSql()}, id`,
        );
        res.status(200).json(items.map(serializeMenuItem));
    } catch (error) {
        console.error("Error fetching menu items:", error);
        res.status(500).json({ message: "Failed to load menu items" });
    }
});

// 2. ADD A NEW MENU ITEM (When you click 'Add Item' on your management page)
app.post('/api/menu', requirePermission('menu'), async (req, res) => {
    const { name, image_url } = req.body ?? {};
    const category = normalizeMenuCategory(req.body?.category);
    const prices = normalizeMenuPrices(req.body ?? {}, category);

    if (!name || !category || prices.error) {
        return res.status(400).json({ message: prices.error || 'Please fill in all fields (Name, Category, Price)' });
    }

    const normalizedImageUrl = normalizeMenuImageUrl(image_url);

    try {
        const query =
            'INSERT INTO menu_items (name, category, price, hot_price, iced_price, image_url, is_available) VALUES (?, ?, ?, ?, ?, ?, TRUE)';
        const [result] = await db.execute(query, [
            name,
            category,
            prices.price,
            prices.hot_price,
            prices.iced_price,
            normalizedImageUrl,
        ]);

        await auditFromRequest(db, req, {
            action: 'menu_create',
            module: 'Menu Management',
            description: `Created menu item "${name}" at $${prices.price.toFixed(2)}`,
        });

        res.status(201).json({
            message: 'Item added successfully!',
            item: serializeMenuItem({
                id: result.insertId,
                name,
                category,
                price: prices.price,
                hot_price: prices.hot_price,
                iced_price: prices.iced_price,
                image_url: normalizedImageUrl,
                is_available: true,
            }),
        });
    } catch (error) {
        console.error('Error adding menu item:', error);
        res.status(500).json({ message: 'Failed to save the new item' });
    }
});

// 3. EDIT AN EXISTING MENU ITEM (Fixes your click/modify actions)
app.put('/api/menu/:id', requirePermission('menu'), async (req, res) => {
    const itemId = Number.parseInt(req.params.id, 10);
    const { name, image_url } = req.body ?? {};
    const category = normalizeMenuCategory(req.body?.category);
    const prices = normalizeMenuPrices(req.body ?? {}, category);

    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ message: 'Invalid menu item id' });
    }

    if (!name || !category || prices.error) {
        return res.status(400).json({ message: prices.error || 'Please fill in all fields to complete update' });
    }

    const normalizedImageUrl = normalizeMenuImageUrl(image_url);

    try {
        const [existingRows] = await db.execute(
            'SELECT name, price, hot_price, iced_price FROM menu_items WHERE id = ? LIMIT 1',
            [itemId],
        );
        if (!existingRows.length) {
            return res.status(404).json({ message: 'Item not found' });
        }
        const previous = existingRows[0];

        const query =
            'UPDATE menu_items SET name = ?, category = ?, price = ?, hot_price = ?, iced_price = ?, image_url = ? WHERE id = ?';
        const [result] = await db.execute(query, [
            name,
            category,
            prices.price,
            prices.hot_price,
            prices.iced_price,
            normalizedImageUrl,
            itemId,
        ]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Item not found' });
        }

        const oldPrice = Number(previous.price);
        const newPrice = Number(prices.price);
        const priceChanged = oldPrice !== newPrice
            || Number(previous.hot_price) !== Number(prices.hot_price)
            || Number(previous.iced_price) !== Number(prices.iced_price);

        await auditFromRequest(db, req, {
            action: priceChanged ? 'menu_price_update' : 'menu_update',
            module: 'Menu Management',
            description: priceChanged
                ? `Updated menu item #${itemId} "${name}". Price $${oldPrice.toFixed(2)} → $${newPrice.toFixed(2)}` +
                (Number(previous.hot_price) !== Number(prices.hot_price) || Number(previous.iced_price) !== Number(prices.iced_price)
                    ? `; hot $${Number(previous.hot_price).toFixed(2)} → $${Number(prices.hot_price).toFixed(2)}; iced $${Number(previous.iced_price).toFixed(2)} → $${Number(prices.iced_price).toFixed(2)}`
                    : '')
                : `Updated menu item #${itemId} "${name}" (price $${newPrice.toFixed(2)})`,
        });

        res.status(200).json({ message: 'Item updated successfully!' });
    } catch (error) {
        console.error('Error modifying menu item:', error);
        res.status(500).json({ message: 'Failed to update item details' });
    }
});

// 4. DELETE A MENU ITEM (When clicking the delete/trash icon on a menu card)
app.delete('/api/menu/:id', requirePermission('menu'), async (req, res) => {
    const itemId = Number.parseInt(req.params.id, 10);

    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ message: 'Invalid menu item id' });
    }

    try {
        const [result] = await db.execute('DELETE FROM menu_items WHERE id = ?', [itemId]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ message: "Item not found" });
        }

        await auditFromRequest(db, req, {
            action: 'menu_delete',
            module: 'Menu Management',
            description: `Deleted menu item #${itemId}`,
        });

        res.status(200).json({ message: "Item deleted successfully" });
    } catch (error) {
        console.error("Error deleting menu item:", error);
        res.status(500).json({ message: "Failed to delete the item" });
    }
});

// ==========================================
// 📋 ACTIVE ORDERING & POS API ROUTES
// ==========================================

// 1. GET ACTIVE (PENDING) ORDERS FOR BILL RECONCILIATION
app.get('/api/orders/active', requirePosFloorAccess, async (req, res) => {
    const targetSelect = targetIdSelectSql('o');
    try {
        const query = `
            SELECT o.id AS order_id, ${targetSelect} AS target_id, o.status,
                   COALESCE(o.bill_requested, 0) AS bill_requested,
                   oi.menu_item_id, oi.quantity, oi.price, oi.notes,
                   COALESCE(m.name, oi.item_name, 'Custom item') AS name
            FROM orders o
            JOIN order_items oi ON o.id = oi.order_id
            LEFT JOIN menu_items m ON oi.menu_item_id = m.id
            WHERE o.status = 'Pending'
        `;
        const [results] = await db.execute(query);
        res.status(200).json(results.map((row) => ({
            ...row,
            notes: row.notes || '',
            name: formatOrderLineName(row.name, row.notes),
            bill_requested: Number(row.bill_requested) ? 1 : 0,
        })));
    } catch (error) {
        if (error.message && error.message.includes('bill_requested')) {
            try {
                const fallbackQuery = `
                    SELECT o.id AS order_id, ${targetSelect} AS target_id, o.status,
                           oi.menu_item_id, oi.quantity, oi.price, oi.notes,
                           COALESCE(m.name, oi.item_name, 'Custom item') AS name
                    FROM orders o
                    JOIN order_items oi ON o.id = oi.order_id
                    LEFT JOIN menu_items m ON oi.menu_item_id = m.id
                    WHERE o.status = 'Pending'
                `;
                const [results] = await db.execute(fallbackQuery);
                res.status(200).json(results.map((row) => ({
                    ...row,
                    notes: row.notes || '',
                    name: formatOrderLineName(row.name, row.notes),
                    bill_requested: 0,
                })));
                return;
            } catch (fallbackError) {
                logOrderError('DATABASE ERROR IN /api/orders/active (fallback)', fallbackError);
            }
        } else {
            logOrderError('DATABASE ERROR IN /api/orders/active', error);
        }
        res.status(500).json({ message: 'Failed to load active orders', errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) });
    }
});

app.get('/api/orders/stock-levels', requireOrderWriteAccess, async (_req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT l.menu_item_id, i.item_name, i.stock_quantity
             FROM menu_item_stock_links l
             JOIN inventory i ON i.id = l.inventory_id
             WHERE l.variant = '' AND l.option_key = '' AND l.option_value = ''`,
        );
        res.status(200).json(rows.map((row) => ({
            menu_item_id: row.menu_item_id,
            item_name: row.item_name,
            stock_quantity: Number(row.stock_quantity),
        })));
    } catch (error) {
        logOrderError('DATABASE ERROR IN GET /api/orders/stock-levels', error);
        res.status(500).json({ message: 'Failed to load stock levels' });
    }
});

async function assertTableNotMerged(conn, target) {
    if (target.sourceType !== 'Table') return;
    let rows;
    try {
        [rows] = await conn.execute('SELECT table_name, merged_into FROM tables WHERE id = ? LIMIT 1', [target.tableId]);
    } catch {
        return;
    }
    if (rows[0]?.merged_into != null) {
        const error = new Error(`${rows[0].table_name} is merged into table #${rows[0].merged_into}. Add the order there.`);
        error.status = 409;
        throw error;
    }
}

// 2. DISPATCH/MERGE ORDER ITEMS INTO TARGET TICKETS
app.post('/api/orders', requireOrderWriteAccess, async (req, res) => {
    if (rejectIfMaintenance(res)) return;
    const { target_id, items, table_id } = req.body ?? {};

    if (!target_id || !Array.isArray(items) || !items.length) {
        return res.status(400).json({ message: 'Missing table target or checkout lines' });
    }

    const lineError = items.map((item) => validateOrderLine(item, { isAdmin: isAdminRole(req.user?.role) })).find(Boolean);
    if (lineError) {
        const status = lineError.startsWith('Only an administrator') ? 403 : 400;
        return res.status(status).json({ message: lineError });
    }

    let target;
    try {
        target = normalizeIncomingTarget(target_id);
    } catch (validationError) {
        console.error('❌ Order target validation failed:', validationError.message, { target_id });
        return res.status(400).json({ message: validationError.message });
    }

    try {
        const orderId = await withTransaction(db, async (conn) => {
            let id = await findPendingOrderId(conn, target);
            if (!id) {
                await assertTableNotMerged(conn, target);
                id = await createPendingOrder(conn, target, table_id);
            }
            for (const item of items) {
                await insertOrderItem(conn, id, item);
            }
            const [lines] = await conn.execute(
                'SELECT menu_item_id, quantity FROM order_items WHERE order_id = ?',
                [id],
            );
            await reconcileOrderStock(conn, id, lines, req.user?.id ?? null);
            return id;
        }, { locks: [pendingOrderLockName(target)] });

        res.status(201).json({
            message: "Order stored securely in database!",
            orderId,
            target_key: target.key,
            source_type: target.sourceType,
        });

        await auditFromRequest(db, req, {
            action: 'order_place',
            module: 'Order',
            description: `Placed/merged ${items.length} item(s) for ${target.key === 'takeout' ? 'Take Out' : `Table ${target.key}`}`,
        });
    } catch (error) {
        if ([400, 403, 404, 409].includes(error.status)) {
            return res.status(error.status).json({ message: error.message });
        }
        logOrderError('DATABASE ERROR IN POST /api/orders', error, {
            target_id,
            normalized_target: target.key,
            source_type: target.sourceType,
            item_count: items.length,
        });
        res.status(500).json({
            message: "Database failure mapping shopping cart values",
            errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }),
        });
    }
});

const ALLOWED_PAYMENT_METHODS = new Set(['Cash', 'Bank Scan']);

async function allocateNextInvoiceId(conn) {
    const [rows] = await conn.execute(
        `SELECT MAX(CAST(SUBSTRING(invoice_id, 5) AS UNSIGNED)) AS max_n
         FROM orders
         WHERE invoice_id REGEXP '^INV-[0-9]+$'`,
    );
    const maxN = Number(rows[0]?.max_n);
    const next = Number.isFinite(maxN) && maxN > 0 ? maxN + 1 : 1001;
    return `INV-${next}`;
}

// 3. PROCESS PAYMENT / FINAL TRANSACTION CHECKOUT
app.post('/api/orders/checkout', requirePermission('payment'), async (req, res) => {
    if (rejectIfMaintenance(res)) return;
    const {
        target_id,
        payment_method,
        table_id,
        clear_table = true,
        received_usd = null,
        received_khr = null,
        change_usd = null,
        exchange_rate = null,
    } = req.body ?? {};

    if (!target_id) {
        return res.status(400).json({ message: 'Missing target_id for checkout' });
    }

    const method = typeof payment_method === 'string' ? payment_method.trim() : '';
    if (!method) {
        return res.status(400).json({ message: 'Missing payment_method for checkout' });
    }
    if (!ALLOWED_PAYMENT_METHODS.has(method)) {
        return res.status(400).json({ message: 'Invalid payment_method. Use Cash or Bank Scan.' });
    }

    let target;
    try {
        target = normalizeIncomingTarget(target_id);
    } catch (validationError) {
        console.error('❌ Checkout target validation failed:', validationError.message, { target_id });
        return res.status(400).json({ message: validationError.message });
    }

    try {
        const { sql, params } = pendingOrderWhereClause(target);
        const outcome = await withTransaction(db, async (conn) => {
            const orderId = await findPendingOrderId(conn, target);
            const resolvedTableId =
                target.sourceType === 'Take Out' ? null : await resolveTableForeignKey(conn, table_id ?? target.tableId);

            if (!orderId) {
                const error = new Error('Checkout requires saved order lines');
                error.status = 400;
                throw error;
            }

            const [lines] = await conn.execute(
                'SELECT menu_item_id, quantity, price FROM order_items WHERE order_id = ?',
                [orderId],
            );
            if (!lines.length) {
                const error = new Error('Checkout requires saved order lines');
                error.status = 400;
                throw error;
            }

            const computed = lines.reduce(
                (sum, line) => sum + Number(line.quantity) * Number(line.price),
                0,
            );
            const finalTotal = Math.round(computed * 100) / 100;
            const stockOutcome = await reconcileOrderStock(conn, orderId, lines, req.user?.id ?? null);

            const invoiceId = await allocateNextInvoiceId(conn);

            const payment = normalizeCheckoutPayment({
                method,
                totalUsd: finalTotal,
                receivedUsd: received_usd,
                receivedKhr: received_khr,
                changeUsd: change_usd,
                exchangeRate: exchange_rate,
            });
            const recUsd = payment.received_usd;
            const recKhr = payment.received_khr;
            const chgUsd = payment.change_usd;
            const chgKhr = payment.change_khr;
            const exRate = payment.exchange_rate;

            const [result] = await conn.execute(
                `UPDATE orders
                 SET invoice_id = ?, payment_method = ?, payment_type = ?, subtotal = ?, tax = ?, total = ?,
                     total_amount = ?, table_id = ?, received_usd = ?, received_khr = ?, change_usd = ?,
                     change_khr = ?, exchange_rate = ?, status = 'Completed', updated_at = NOW()
                 WHERE id = ? AND ${sql}`,
                [
                    invoiceId,
                    method,
                    method,
                    finalTotal,
                    0,
                    finalTotal,
                    finalTotal,
                    resolvedTableId,
                    recUsd,
                    recKhr,
                    chgUsd,
                    chgKhr,
                    exRate,
                    orderId,
                    ...params,
                ],
            );

            if (result.affectedRows === 0) {
                const error = new Error('No active ticket session found for this target.');
                error.status = 404;
                throw error;
            }

            if (resolvedTableId) {
                try {
                    const nextTableStatus = clear_table === false ? 'Paid' : 'Empty';
                    await conn.execute('UPDATE tables SET status = ? WHERE id = ?', [nextTableStatus, resolvedTableId]);
                    if (nextTableStatus === 'Empty') await releaseMergedTables(conn, resolvedTableId);
                } catch (tableStatusErr) {
                    console.warn('⚠️ Could not update table status in checkout:', tableStatusErr.message);
                }
            }

            return {
                orderId,
                finalTotal,
                invoiceId,
                tableStatus: clear_table === false ? 'Paid' : 'Empty',
                lowStockItems: stockOutcome?.lowStockWarnings || [],
                received_usd: recUsd,
                received_khr: recKhr,
                change_usd: chgUsd,
                change_khr: chgKhr,
                exchange_rate: exRate,
            };
        }, { locks: [pendingOrderLockName(target)] });

        await auditFromRequest(db, req, {
            action: 'payment_process',
            module: 'Payment',
            description: `Payment received via ${method} for ${target.key === 'takeout' ? 'Take Out' : `Table ${target.key}`
                } / Invoice ${outcome.invoiceId} ($${outcome.finalTotal.toFixed(2)})`,
        });

        res.status(200).json({
            message: 'Transaction completed and locked successfully.',
            invoice_id: outcome.invoiceId,
            low_stock_items: outcome.lowStockItems || [],
            received_usd: outcome.received_usd,
            received_khr: outcome.received_khr,
            change_usd: outcome.change_usd,
            change_khr: outcome.change_khr,
            exchange_rate: outcome.exchange_rate,
        });
    } catch (error) {
        if ([400, 404, 409].includes(error.status)) {
            return res.status(error.status).json({ message: error.message });
        }
        logOrderError('DATABASE ERROR IN POST /api/orders/checkout', error, {
            target_id,
            normalized_target: target.key,
        });
        res.status(500).json({ message: 'Error committing accounting metrics', errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) });
    }
});

// 3b. SPLIT BILL CHECKOUT (Checkout selected items from an active table order)
app.post('/api/orders/split-checkout', requirePermission('payment'), async (req, res) => {
    if (rejectIfMaintenance(res)) return;
    const {
        target_id,
        items, // array of { menu_item_id, notes, qty, unitPrice }
        payment_method,
        table_id,
        clear_table = false,
        received_usd = null,
        received_khr = null,
        change_usd = null,
        change_khr = null,
        exchange_rate = null,
    } = req.body ?? {};

    if (!target_id || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: 'Missing target_id or split items' });
    }

    const method = typeof payment_method === 'string' ? payment_method.trim() : '';
    if (!method || !ALLOWED_PAYMENT_METHODS.has(method)) {
        return res.status(400).json({ message: 'Invalid payment_method. Use Cash or Bank Scan.' });
    }

    let target;
    try {
        target = normalizeIncomingTarget(target_id);
    } catch (validationError) {
        return res.status(400).json({ message: validationError.message });
    }

    try {
        const { sql, params } = pendingOrderWhereClause(target);
        const outcome = await withTransaction(db, async (conn) => {
            const originalOrderId = await findPendingOrderId(conn, target);
            if (!originalOrderId) {
                const err = new Error('No pending order found to split');
                err.status = 404;
                throw err;
            }

            const resolvedTableId =
                target.sourceType === 'Take Out' ? null : await resolveTableForeignKey(conn, table_id ?? target.tableId);

            const [originalLines] = await conn.execute(
                `SELECT id, menu_item_id, item_name, quantity, price, notes
                 FROM order_items WHERE order_id = ? ORDER BY id ASC FOR UPDATE`,
                [originalOrderId],
            );
            const plan = planSplitCheckout(originalLines, items);
            const splitTotal = plan.splitTotal;

            const invoiceId = await allocateNextInvoiceId(conn);

            const payment = normalizeCheckoutPayment({
                method,
                totalUsd: splitTotal,
                receivedUsd: received_usd,
                receivedKhr: received_khr,
                changeUsd: change_usd,
                exchangeRate: exchange_rate,
            });
            const recUsd = payment.received_usd;
            const recKhr = payment.received_khr;
            const chgUsd = payment.change_usd;
            const chgKhr = payment.change_khr;
            const exRate = payment.exchange_rate;

            // 1. Create a new completed order for the split items
            const [insertOrder] = await conn.execute(
                `INSERT INTO orders
                  (invoice_id, source_type, target_id, table_id, payment_method, payment_type, subtotal, tax,
                   total, total_amount, received_usd, received_khr, change_usd, change_khr, exchange_rate, status, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, 'Completed', NOW())`,
                [
                    invoiceId,
                    target.sourceType,
                    target.tableId,
                    resolvedTableId,
                    method,
                    method,
                    splitTotal,
                    splitTotal,
                    splitTotal,
                    recUsd,
                    recKhr,
                    chgUsd,
                    chgKhr,
                    exRate,
                ],
            );
            const splitOrderId = insertOrder.insertId;

            for (const line of plan.splitLines) {
                await conn.execute(
                    `INSERT INTO order_items (order_id, menu_item_id, item_name, quantity, price, subtotal, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [splitOrderId, line.menu_item_id, line.item_name, line.quantity, line.price, line.quantity * line.price, line.notes],
                );
            }
            for (const update of plan.lineUpdates) {
                if (update.quantity === 0) {
                    await conn.execute('DELETE FROM order_items WHERE id = ?', [update.id]);
                } else {
                    await conn.execute(
                        'UPDATE order_items SET quantity = ?, subtotal = ? * price WHERE id = ?',
                        [update.quantity, update.quantity, update.id],
                    );
                }
            }

            await reconcileOrderStock(conn, originalOrderId, plan.remainingLines, req.user?.id ?? null);
            const stockOutcome = await reconcileOrderStock(conn, splitOrderId, plan.splitLines, req.user?.id ?? null);

            // 3. Check remaining items in original pending order
            const remainingLines = plan.remainingLines;

            let tableStatus = 'Occupied';
            if (remainingLines.length === 0) {
                await conn.execute(
                    "UPDATE orders SET status = 'Split', subtotal = 0, total = 0, total_amount = 0, updated_at = NOW() WHERE id = ?",
                    [originalOrderId],
                );
                tableStatus = clear_table === false ? 'Paid' : 'Empty';
                if (resolvedTableId) {
                    await conn.execute('UPDATE tables SET status = ? WHERE id = ?', [tableStatus, resolvedTableId]);
                    if (tableStatus === 'Empty') await releaseMergedTables(conn, resolvedTableId);
                }
            } else {
                // Table still has remaining items
                const newPendingTotal = Math.round(
                    remainingLines.reduce((sum, l) => sum + Number(l.quantity) * Number(l.price), 0) * 100
                ) / 100;
                await conn.execute(
                    'UPDATE orders SET subtotal = ?, total = ?, total_amount = ?, updated_at = NOW() WHERE id = ?',
                    [newPendingTotal, newPendingTotal, newPendingTotal, originalOrderId],
                );
            }

            return {
                splitOrderId,
                invoiceId,
                splitTotal,
                remainingCount: remainingLines.length,
                tableStatus,
                lowStockItems: stockOutcome?.lowStockWarnings || [],
            };
        }, { locks: [pendingOrderLockName(target)] });

        await auditFromRequest(db, req, {
            action: 'split_payment_process',
            module: 'Payment',
            description: `Split payment received via ${method} for ${target.key === 'takeout' ? 'Take Out' : `Table ${target.key}`} / Invoice ${outcome.invoiceId} ($${outcome.splitTotal.toFixed(2)})`,
        });

        res.status(200).json({
            message: 'Split payment completed successfully.',
            invoice_id: outcome.invoiceId,
            split_total: outcome.splitTotal,
            remaining_count: outcome.remainingCount,
            table_status: outcome.tableStatus,
            low_stock_items: outcome.lowStockItems,
        });
    } catch (error) {
        if ([400, 404, 409].includes(error.status)) {
            return res.status(error.status).json({ message: error.message });
        }
        res.status(500).json({ message: 'Error processing split payment', errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) });
    }
});

// 3c. VOID / REFUND COMPLETED ORDER WITH MANAGER APPROVAL & STOCK RESTORATION
const refundApprovalLimiter = createApprovalLimiter();
app.post('/api/orders/:id/refund', requirePermission('payment'), async (req, res) => {
    if (rejectIfMaintenance(res)) return;
    const orderId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: 'Invalid order ID' });
    }

    const { reason, manager_username, manager_password } = req.body ?? {};
    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
        return res.status(400).json({ message: 'A reason for refunding / voiding the order is required.' });
    }
    if (trimmedReason.length > 255) {
        return res.status(400).json({ message: 'Reason must be 255 characters or less.' });
    }

    try {
        const authorizedManagerId = await resolveRefundApprover(
            db,
            req.user,
            { username: manager_username, password: manager_password },
            refundApprovalLimiter,
        );

        const outcome = await withTransaction(db, async (conn) => {
            const [orderRows] = await conn.execute(
                'SELECT id, invoice_id, total, status FROM orders WHERE id = ? FOR UPDATE',
                [orderId],
            );
            if (!orderRows.length) {
                const err = new Error('Order not found');
                err.status = 404;
                throw err;
            }

            const order = orderRows[0];
            assertRefundable(order);

            // Restore all deducted stock for this order
            await reconcileOrderStock(conn, orderId, [], authorizedManagerId);

            // Update status to Refunded
            await conn.execute(
                `UPDATE orders
                 SET status = 'Refunded',
                     void_reason = ?,
                     voided_by = ?,
                     voided_at = NOW()
                 WHERE id = ?`,
                [trimmedReason, authorizedManagerId, orderId],
            );

            return order;
        });

        await auditFromRequest(db, req, {
            action: 'order_refund',
            module: 'Payment',
            description: `Refunded / voided order #${orderId} (${outcome.invoice_id || 'no invoice'}) total $${Number(outcome.total).toFixed(2)}. Reason: ${trimmedReason}`,
        });

        res.status(200).json({
            message: 'Order refunded successfully and stock has been restored.',
            order_id: orderId,
            invoice_id: outcome.invoice_id,
            status: 'Refunded',
        });
    } catch (error) {
        if ([400, 403, 404, 429].includes(error.status)) {
            return res.status(error.status).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to refund order', errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) });
    }
});

// 4. MARK TABLE AS BILL REQUESTED (PENDING BILL STATUS)
app.post('/api/orders/bill-requested', requirePosFloorAccess, async (req, res) => {
    const { target_id } = req.body ?? {};
    if (!target_id) {
        return res.status(400).json({ message: 'Missing target_id' });
    }

    let target;
    try {
        target = normalizeIncomingTarget(target_id);
    } catch (validationError) {
        return res.status(400).json({ message: validationError.message });
    }

    try {
        const { sql, params } = pendingOrderWhereClause(target);
        await db.execute(`UPDATE orders SET bill_requested = 1 WHERE ${sql}`, params);
        res.status(200).json({ message: "Bill requested flag set." });
    } catch (error) {
        if (error.message && error.message.includes('bill_requested')) {
            try {
                await db.execute(
                    'ALTER TABLE orders ADD COLUMN bill_requested TINYINT(1) NOT NULL DEFAULT 0'
                );
                const { sql, params } = pendingOrderWhereClause(target);
                await db.execute(`UPDATE orders SET bill_requested = 1 WHERE ${sql}`, params);
                res.status(200).json({ message: "Bill requested flag set." });
                return;
            } catch (alterError) {
                logOrderError('Error setting bill_requested (alter)', alterError, { target_id });
            }
        } else {
            logOrderError('Error setting bill_requested', error, { target_id });
        }
        res.status(200).json({ message: "Bill request noted (local state only)." });
    }
});

// 5. SYNC UPDATED BILL LINE ITEMS BEFORE CHECKOUT
app.put('/api/orders/items', requireOrderWriteAccess, async (req, res) => {
    if (rejectIfMaintenance(res)) return;
    const { target_id, items, table_id } = req.body ?? {};

    if (!target_id || !Array.isArray(items)) {
        return res.status(400).json({ message: 'Missing target_id or items array' });
    }

    if (items.length > 0) {
        const lineError = items
            .map((item) => validateOrderLine(item, { isAdmin: isAdminRole(req.user?.role) }))
            .find(Boolean);
        if (lineError) {
            const status = lineError.startsWith('Only an administrator') ? 403 : 400;
            return res.status(status).json({ message: lineError });
        }
    }

    let target;
    try {
        target = normalizeIncomingTarget(target_id);
    } catch (validationError) {
        return res.status(400).json({ message: validationError.message });
    }

    const baseItems = Array.isArray(req.body?.base_items) ? req.body.base_items : null;

    try {
        const orderId = await withTransaction(db, async (conn) => {
            let id = await findPendingOrderId(conn, target);

            if (baseItems) {
                const [savedLines] = id
                    ? await conn.execute(
                        'SELECT menu_item_id, item_name, notes, quantity FROM order_items WHERE order_id = ?',
                        [id],
                    )
                    : [[]];
                if (!billMatchesBase(savedLines, baseItems)) {
                    const error = new Error(id
                        ? 'This bill was changed on another device. Review the updated bill and try again.'
                        : 'This bill was already paid or cleared on another device.');
                    error.status = 409;
                    error.code = 'BILL_CHANGED';
                    throw error;
                }
            }

            if (!id) {
                if (items.length === 0) return null;
                await assertTableNotMerged(conn, target);
                id = await createPendingOrder(conn, target, table_id);
            }
            const prices = await pickLinePrices(conn, id, items, { isAdmin: isAdminRole(req.user?.role) });
            await reconcileOrderStock(conn, id, items, req.user?.id ?? null);
            await conn.execute('DELETE FROM order_items WHERE order_id = ?', [id]);
            for (const [index, item] of items.entries()) {
                await insertOrderItem(conn, id, item, { price: prices[index] });
            }

            if (items.length === 0) {
                await conn.execute(
                    "UPDATE orders SET status = 'Canceled', updated_at = NOW() WHERE id = ?",
                    [id],
                );
                if (target.sourceType === 'Table') {
                    await conn.execute('UPDATE tables SET status = "Empty" WHERE id = ?', [target.tableId]);
                    await releaseMergedTables(conn, target.tableId);
                }
                return null;
            }
            return id;
        }, { locks: [pendingOrderLockName(target)] });

        res.status(200).json({ message: "Bill items updated.", orderId });
    } catch (error) {
        if ([400, 403, 404, 409].includes(error.status)) {
            return res.status(error.status).json({ message: error.message, code: error.code });
        }
        logOrderError('DATABASE ERROR IN PUT /api/orders/items', error, {
            target_id,
            normalized_target: target.key,
            item_count: items.length,
        });
        res.status(500).json({ message: "Failed to update bill items", errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) });
    }
});

// 6. FETCH COMPLETED SALES HISTORY LOGS
const SALE_STATUS_SQL = saleStatusSql();
const REFUNDED_STATUS_SQL = refundedStatusSql();
const REFUND_DATE_SQL = refundDateSql();
app.get('/api/orders/history', requireSalesHistoryAccess, async (req, res) => {
    const monthParam = typeof req.query.month === 'string' ? req.query.month.trim() : '';
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(monthParam);
    let rangeSql = (column) => `${column} >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`;
    let dateFilterParams = [730];

    if (monthMatch) {
        const year = Number.parseInt(monthMatch[1], 10);
        const month = Number.parseInt(monthMatch[2], 10);
        if (Number.isInteger(year) && Number.isInteger(month) && month >= 1 && month <= 12) {
            const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
            const nextMonth = month === 12 ? 1 : month + 1;
            const nextYear = month === 12 ? year + 1 : year;
            const endDate = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
            rangeSql = (column) => `${column} >= ? AND ${column} < ?`;
            dateFilterParams = [startDate, endDate];
        }
    } else {
        const parsedDays = Number.parseInt(req.query.days, 10);
        const allowedDayRanges = [30, 31, 60, 90, 120, 180, 365, 730];
        const days = allowedDayRanges.includes(parsedDays) ? parsedDays : 730;
        dateFilterParams = [days];
    }

    try {
        const query = `
            SELECT 
                id AS order_id,
                invoice_id,
                target_id,
                source_type,
                payment_method,
                payment_type,
                subtotal,
                tax,
                total,
                status,
                received_usd,
                received_khr,
                change_usd,
                change_khr,
                exchange_rate,
                void_reason,
                DATE_FORMAT(voided_at, '%Y-%m-%d %h:%i %p') AS voided_at,
                CASE
                    WHEN ${REFUNDED_STATUS_SQL} THEN DATE_FORMAT(${REFUND_DATE_SQL}, '%Y-%m-%d')
                    ELSE NULL
                END AS refund_date,
                DATE_FORMAT(updated_at, '%Y-%m-%d') AS date,
                DATE_FORMAT(updated_at, '%h:%i %p') AS time,
                DATE_FORMAT(updated_at, '%Y-%m') AS month_key
            FROM orders
            WHERE (${SALE_STATUS_SQL} AND ${rangeSql('updated_at')})
               OR (${REFUNDED_STATUS_SQL} AND ${rangeSql(REFUND_DATE_SQL)})
            ORDER BY updated_at DESC
        `;
        const [historyRows] = await db.execute(query, [...dateFilterParams, ...dateFilterParams]);

        if (historyRows.length === 0) {
            return res.status(200).json([]);
        }

        const orderIds = historyRows.map((row) => row.order_id);
        const placeholders = orderIds.map(() => '?').join(', ');
        const [itemRows] = await db.execute(
            `
            SELECT
                oi.order_id,
                oi.menu_item_id,
                COALESCE(m.name, oi.item_name, 'Custom item') AS name,
                m.image_url,
                oi.notes,
                oi.quantity AS qty,
                oi.price AS unitPrice,
                (oi.quantity * oi.price) AS lineTotal
            FROM order_items oi
            LEFT JOIN menu_items m ON oi.menu_item_id = m.id
            WHERE oi.order_id IN (${placeholders})
            `,
            orderIds,
        );

        const itemsByOrder = itemRows.reduce((acc, row) => {
            if (!acc[row.order_id]) acc[row.order_id] = [];
            acc[row.order_id].push({
                menu_item_id: row.menu_item_id,
                image_url: row.image_url,
                name: formatOrderLineName(row.name, row.notes),
                notes: row.notes || '',
                qty: row.qty,
                unitPrice: parseFloat(row.unitPrice),
                lineTotal: parseFloat(row.lineTotal),
            });
            return acc;
        }, {});

        const enrichedHistory = historyRows.map((row) => {
            const items = itemsByOrder[row.order_id] || [];
            const targetKey = row.target_id != null ? String(row.target_id) : 'takeout';
            return {
                ...row,
                target_id: targetKey,
                payment_method: row.payment_method || row.payment_type || 'Cash',
                received_usd: row.received_usd != null ? parseFloat(row.received_usd) : null,
                received_khr: row.received_khr != null ? parseFloat(row.received_khr) : null,
                change_usd: row.change_usd != null ? parseFloat(row.change_usd) : null,
                change_khr: row.change_khr != null ? parseFloat(row.change_khr) : null,
                exchange_rate: row.exchange_rate != null ? parseFloat(row.exchange_rate) : null,
                void_reason: row.void_reason || null,
                voided_at: row.voided_at || null,
                refund_date: row.refund_date || null,
                summary: items.length
                    ? items.map((item) => `${item.qty}× ${item.name}`).join(', ')
                    : 'Items logged',
                items,
            };
        });

        res.status(200).json(enrichedHistory);
    } catch (error) {
        console.error('❌ CRITICAL DATABASE ERROR IN /api/orders/history:', error.message);
        res.status(500).json({ message: 'Failed to load sales history', errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) });
    }
});

// ==========================================
// 🔔 REAL-TIME ALERTS
// ==========================================

function summarizeAlertCounts(alerts) {
    return {
        total: alerts.length,
        critical: alerts.filter((alert) => alert.severity === 'critical').length,
        warning: alerts.filter((alert) => alert.severity === 'warning').length,
        info: alerts.filter((alert) => alert.severity === 'info').length,
        reservation: alerts.filter((alert) => alert.category === 'reservation').length,
    };
}

// Authenticated users get a permission-filtered feed (stock / expenses / reservations / security).
// Do not gate the whole route on inventory_stock — admins and floor staff still need notices online.
app.get('/api/alerts', async (req, res) => {
    try {
        await processReservationReminders(db).catch(() => null);
        const bypassCache = req.query.refresh === '1';
        const canSeeStock = userHasPermission(req.user, 'inventory_stock');
        const payload = canSeeStock
            ? await buildActiveAlerts(db, { bypassCache })
            : { generatedAt: new Date().toISOString(), alerts: [], counts: summarizeAlertCounts([]) };

        const storedAlertsRaw = req.user?.id ? await listUnreadUserAlerts(db, req.user.id) : [];
        // Expense till notices are admin-only even if a row were mis-addressed.
        const storedAlerts = isAdminRole(req.user?.role)
            ? storedAlertsRaw
            : storedAlertsRaw.filter((alert) => alert.category !== 'expense');
        const securityAlerts = isAdminRole(req.user?.role)
            ? await listNewSecurityAlertFeed(db)
            : [];
        const stockAlerts = canSeeStock ? (payload.alerts || []) : [];
        const alerts = [...securityAlerts, ...storedAlerts, ...stockAlerts].sort((a, b) => {
            const timeA = new Date(a.timestamp || a.created_at || 0).getTime();
            const timeB = new Date(b.timestamp || b.created_at || 0).getTime();
            if (timeB !== timeA) return timeB - timeA;
            const rank = (s) => (s === 'critical' ? 0 : s === 'warning' ? 1 : 2);
            return rank(a.severity) - rank(b.severity);
        });
        const counts = summarizeAlertCounts(alerts);
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
        return res.status(200).json({ ...payload, alerts, counts });
    } catch (error) {
        console.error('❌ ALERTS ENGINE ERROR:', error.message);
        res.status(500).json({ message: 'Failed to scan active alerts', errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) });
    }
});

app.patch('/api/notifications/:id/read', async (req, res) => {
    const notificationId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(notificationId) || notificationId <= 0) {
        return res.status(400).json({ message: 'Invalid notification id' });
    }

    try {
        const updated = await markNotificationRead(db, {
            notificationId,
            recipientUserId: req.user.id,
        });
        if (!updated) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        res.status(200).json({ message: 'Notification marked as read' });
    } catch (error) {
        console.error('❌ MARK NOTIFICATION READ ERROR:', error.message);
        res.status(500).json({ message: 'Failed to update notification' });
    }
});

// ==========================================
// 📦 INVENTORY & STOCK MANAGEMENT API ROUTES
// ==========================================

app.get('/api/inventory', requirePermission('inventory_stock'), async (req, res) => {
    try {
        const [items] = await db.execute('SELECT * FROM inventory ORDER BY section, category, item_name');
        const [links] = await db.execute(
            `SELECT l.id, l.inventory_id, l.menu_item_id, l.quantity_per_unit, m.name AS menu_name
             FROM menu_item_stock_links l
             JOIN menu_items m ON m.id = l.menu_item_id
             WHERE l.variant = '' AND l.option_key = '' AND l.option_value = ''
             ORDER BY m.name`,
        );
        const linksByItem = new Map();
        for (const link of links) {
            const list = linksByItem.get(link.inventory_id) || [];
            list.push({
                id: link.id,
                menu_item_id: link.menu_item_id,
                menu_name: link.menu_name,
                quantity_per_unit: Number(link.quantity_per_unit),
            });
            linksByItem.set(link.inventory_id, list);
        }
        res.status(200).json(items.map((item) => ({
            ...item,
            menu_links: linksByItem.get(item.id) || [],
        })));
    } catch (error) {
        console.error('❌ INVENTORY FETCH ERROR:', error.message);
        res.status(500).json({ message: 'Failed to load inventory logs' });
    }
});

app.put('/api/inventory/:id/stock', requirePermission('inventory_stock'), async (req, res) => {
    const itemId = Number.parseInt(req.params.id, 10);
    const quantity = Number(req.body?.quantity_received);

    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ message: 'Invalid inventory item id' });
    }

    try {
        const result = await withTransaction(db, (conn) => addReceivedStock(conn, {
            inventoryId: itemId,
            quantity,
            userId: req.user?.id ?? null,
        }));
        await auditFromRequest(db, req, {
            action: 'stock_add',
            module: 'Inventory',
            description: `Added ${quantity} to inventory #${itemId}. Quantity ${Number(result.quantity) - Number(result.change)} → ${result.quantity}.`,
        });
        res.status(200).json({ message: 'Stock added.', ...result });
    } catch (error) {
        if (error.status === 400 || error.status === 404) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('❌ INVENTORY UPDATE ERROR:', error.message);
        res.status(500).json({ message: 'Failed to alter stock quantities' });
    }
});

app.post('/api/inventory/stocktake', requireStockAccess, async (req, res) => {
    const note = stocktakeNote();
    try {
        const result = await withTransaction(db, (conn) => applyStocktake(conn, {
            rows: Array.isArray(req.body?.rows) ? req.body.rows : [],
            userId: req.user?.id ?? null,
            confirmLarge: req.body?.confirmLarge === true,
            note,
        }));
        await auditFromRequest(db, req, {
            action: 'stocktake',
            module: 'Inventory',
            description: `${note}: ${result.changed.length} rows changed, ${result.blank} left blank`,
        });
        res.status(200).json(result);
    } catch (error) {
        if (error.status === 400 || error.status === 409) {
            return res.status(error.status).json({
                message: error.message,
                code: error.code || null,
                rows: error.rows || null,
            });
        }
        console.error('❌ STOCKTAKE ERROR:', error.message);
        res.status(500).json({ message: 'Failed to apply the stocktake' });
    }
});

app.post('/api/inventory/stocktake/excel', requireStockAccess, async (req, res) => {
    const note = String(req.body?.note || '');
    const changed = Array.isArray(req.body?.changed) ? req.body.changed : [];
    if (!/^Opening stocktake \d{4}-\d{2}-\d{2}$/.test(note)) {
        return res.status(400).json({ message: 'This stocktake export is not from an applied count' });
    }
    try {
        for (const row of changed) {
            if (Number(row.difference) === 0) continue;
            const [found] = await db.execute(
                `SELECT id FROM stock_movements
                 WHERE inventory_id = ? AND note = ? AND reason = 'adjustment' AND quantity_after = ?
                 ORDER BY id DESC LIMIT 1`,
                [row.id, note, row.after],
            );
            if (!found.length) {
                return res.status(400).json({ message: 'This stocktake export does not match the saved counts' });
            }
        }
        const { buffer, filename } = await buildStocktakeWorkbook(changed, note);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        console.error('❌ STOCKTAKE EXPORT ERROR:', error.message);
        res.status(500).json({ message: 'Failed to download the stocktake' });
    }
});

app.post('/api/inventory/:id/adjust', requirePermission('inventory_stock'), async (req, res) => {
    const itemId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ message: 'Invalid inventory item id' });
    }

    try {
        const result = await withTransaction(db, (conn) => adjustStockToCount(conn, {
            inventoryId: itemId,
            quantity: req.body?.stock_quantity,
            reason: req.body?.reason,
            note: req.body?.note,
            userId: req.user?.id ?? null,
        }));
        await auditFromRequest(db, req, {
            action: 'stock_adjust',
            module: 'Inventory',
            description: `Adjusted inventory #${itemId}: ${Number(result.quantity) - Number(result.change)} → ${result.quantity} (change ${result.change}; reason: ${String(req.body?.reason || '').trim() || 'n/a'}; note: ${String(req.body?.note || '').trim() || 'n/a'})`,
        });
        res.status(200).json({ message: 'Stock adjusted.', ...result });
    } catch (error) {
        if (error.status === 400 || error.status === 404) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('❌ INVENTORY ADJUST ERROR:', error.message);
        res.status(500).json({ message: 'Failed to adjust stock' });
    }
});

app.get('/api/inventory/:id/movements', requirePermission('inventory_stock'), async (req, res) => {
    const itemId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ message: 'Invalid inventory item id' });
    }

    try {
        const [rows] = await db.execute(
            `SELECT m.id, m.created_at, m.change_amount, m.quantity_after, m.reason, m.note,
                    o.invoice_id, u.display_name
             FROM stock_movements m
             LEFT JOIN orders o ON o.id = m.order_id
             LEFT JOIN users u ON u.id = m.user_id
             WHERE m.inventory_id = ?
             ORDER BY m.id DESC
             LIMIT 30`,
            [itemId],
        );
        res.status(200).json(rows);
    } catch (error) {
        console.error('❌ INVENTORY HISTORY ERROR:', error.message);
        res.status(500).json({ message: 'Failed to load stock history' });
    }
});

app.post('/api/inventory/:id/links', requireStockAccess, async (req, res) => {
    const itemId = Number.parseInt(req.params.id, 10);
    const menuItemId = Number.parseInt(req.body?.menu_item_id, 10);
    const perUnit = Number(req.body?.quantity_per_unit ?? 1);

    if (!Number.isInteger(itemId) || itemId <= 0 || !Number.isInteger(menuItemId) || menuItemId <= 0) {
        return res.status(400).json({ message: 'Choose a stock item and a menu item' });
    }
    if (!Number.isFinite(perUnit) || perUnit <= 0) {
        return res.status(400).json({ message: 'Quantity per sale must be greater than zero' });
    }

    try {
        const [stock] = await db.execute('SELECT id FROM inventory WHERE id = ? LIMIT 1', [itemId]);
        const [menu] = await db.execute('SELECT id FROM menu_items WHERE id = ? LIMIT 1', [menuItemId]);
        if (!stock.length || !menu.length) {
            return res.status(404).json({ message: 'Stock item or menu item was not found' });
        }
        const [result] = await db.execute(
            `INSERT INTO menu_item_stock_links
              (menu_item_id, variant, option_key, option_value, inventory_id, quantity_per_unit)
             VALUES (?, '', '', '', ?, ?)`,
            [menuItemId, itemId, perUnit],
        );
        await auditFromRequest(db, req, {
            action: 'stock_link_create',
            module: 'Inventory',
            description: `Linked menu item #${menuItemId} to inventory #${itemId} at ${perUnit} per sale (link #${result.insertId}).`,
        });
        res.status(201).json({ id: result.insertId });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ message: 'That menu item is already linked' });
        }
        console.error('❌ INVENTORY LINK ERROR:', error.message);
        res.status(500).json({ message: 'Failed to save the menu link' });
    }
});

app.delete('/api/inventory/links/:linkId', requireStockAccess, async (req, res) => {
    const linkId = Number.parseInt(req.params.linkId, 10);
    if (!Number.isInteger(linkId) || linkId <= 0) {
        return res.status(400).json({ message: 'Invalid link id' });
    }

    try {
        const [existing] = await db.execute(
            `SELECT id, menu_item_id, inventory_id, quantity_per_unit
             FROM menu_item_stock_links WHERE id = ? LIMIT 1`,
            [linkId],
        );
        const [result] = await db.execute('DELETE FROM menu_item_stock_links WHERE id = ?', [linkId]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ message: 'Link not found' });
        }
        const link = existing[0];
        await auditFromRequest(db, req, {
            action: 'stock_link_delete',
            module: 'Inventory',
            description: link
                ? `Removed link #${linkId} (menu #${link.menu_item_id} → inventory #${link.inventory_id}, qty ${link.quantity_per_unit}).`
                : `Removed link #${linkId}.`,
        });
        res.status(200).json({ message: 'Link removed' });
    } catch (error) {
        console.error('❌ INVENTORY UNLINK ERROR:', error.message);
        res.status(500).json({ message: 'Failed to remove the menu link' });
    }
});

function sendInventoryError(res, error, fallback) {
    if (error.status) {
        return res.status(error.status).json({
            message: error.message,
            code: error.code || null,
            item: error.item || null,
            suggestions: error.suggestions || null,
        });
    }
    console.error(`❌ ${fallback}:`, error.message);
    return res.status(500).json({ message: fallback });
}

app.post('/api/inventory', requireStockAccess, async (req, res) => {
    try {
        const item = await createInventoryItem(db, req.body ?? {}, req.user?.id ?? null);
        await auditFromRequest(db, req, {
            action: 'inventory_item_created',
            module: 'Inventory',
            description: `Added stock item "${item.item_name}" (#${item.id}) with quantity ${item.stock_quantity ?? 0}, max ${item.max_stock ?? 'n/a'}.`,
        });
        res.status(201).json({ item });
    } catch (error) {
        sendInventoryError(res, error, 'Failed to add the stock item');
    }
});

app.put('/api/inventory/:id', requireStockAccess, async (req, res) => {
    const itemId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ message: 'Invalid inventory item id' });
    }

    try {
        const [beforeRows] = await db.execute(
            'SELECT item_name, max_stock, low_threshold, critical_threshold, stock_quantity FROM inventory WHERE id = ? LIMIT 1',
            [itemId],
        );
        const before = beforeRows[0] || null;
        const item = await editInventoryItem(db, itemId, req.body ?? {}, {
            confirmUnitChange: req.body?.confirm_unit_change === true,
        });
        const oldMax = before ? Number(before.max_stock) : null;
        const newMax = Number(item.max_stock);
        const maxChanged = before && oldMax !== newMax;
        const renamed = before && String(before.item_name) !== String(item.item_name);
        const thresholdChanged = before && (
            Number(before.low_threshold) !== Number(item.low_threshold)
            || Number(before.critical_threshold) !== Number(item.critical_threshold)
        );
        let description = `Updated stock item ${item.item_name}`;
        if (renamed) {
            description = `Renamed stock item "${before.item_name}" → "${item.item_name}"`;
        }
        if (maxChanged) {
            description += `${renamed ? ';' : ':'} max ${oldMax} → ${newMax}`;
        }
        if (thresholdChanged) {
            description += `; low ${before.low_threshold} → ${item.low_threshold}; very-low ${before.critical_threshold ?? 'none'} → ${item.critical_threshold ?? 'none'}`;
        }
        await auditFromRequest(db, req, {
            action: 'inventory_item_updated',
            module: 'Inventory',
            description,
        });
        res.status(200).json({ item });
    } catch (error) {
        sendInventoryError(res, error, 'Failed to update the stock item');
    }
});

// ==========================================
// 💾 BACKUP & RECOVERY API ROUTES
// ==========================================

const sqlUpload = multer({
    storage: multer.diskStorage({
        destination: os.tmpdir(),
        filename: (_req, _file, cb) => cb(null, `mlu-restore-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.sql`),
    }),
    limits: { fileSize: 100 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (!file.originalname.toLowerCase().endsWith('.sql')) {
            cb(new Error('Only .sql backup files are allowed'));
            return;
        }
        cb(null, true);
    },
});

function handleBackupError(res, error, fallbackMessage) {
    logError(error, { route: 'system/backup' });
    const status = error.status || 500;
    res.status(status).json({
        message: error.publicMessage || fallbackMessage,
    });
}

function rejectIfMaintenance(res) {
    if (!isUnderMaintenance()) return false;
    res.status(503).json({ message: maintenanceMessage() });
    return true;
}

app.get('/api/system/backup/excel', sensitiveOperationLimiter, requireBackupDownloadAccess, async (req, res) => {
    const filePath = path.join(os.tmpdir(), `mlu-excel-${Date.now()}.xlsx`);
    let periodLabel = 'All Time';
    try {
        const period = parseBackupPeriod(req.query);
        periodLabel = period.label;
        const filename = buildBackupFilename('mlu-kitchen-cafe-business-data', 'xlsx', period);
        await exportBusinessDataFile(db, period, filePath);
        await auditFromRequest(db, req, {
            action: 'export_business_excel',
            module: 'Backup',
            description: `Excel export period=${periodLabel} result=ok`,
        });
        pipeDownload(
            res,
            filePath,
            filename,
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
    } catch (error) {
        fs.promises.unlink(filePath).catch(() => { });
        await auditFromRequest(db, req, {
            action: 'export_business_excel',
            module: 'Backup',
            description: `Excel export period=${periodLabel} result=failed`,
        });
        if (error?.message?.includes('Invalid month or year')) {
            return res.status(400).json({ message: error.message });
        }
        handleBackupError(res, error, 'Failed to export business data to Excel');
    }
});

app.get('/api/system/backup/sales-pdf', sensitiveOperationLimiter, requireBackupDownloadAccess, async (req, res) => {
    let periodLabel = 'All Time';
    try {
        const { buffer, filename, periodLabel: label } = await createSalesPdf(db, req.query, req.user);
        periodLabel = label;
        await auditFromRequest(db, req, {
            action: 'export_sales_pdf',
            module: 'Backup',
            description: `Sales PDF period=${periodLabel} result=ok`,
        });
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(buffer);
    } catch (error) {
        await auditFromRequest(db, req, {
            action: 'export_sales_pdf',
            module: 'Backup',
            description: `Sales PDF period=${periodLabel} result=failed`,
        });
        if (error?.status === 400 || error?.message?.includes('Invalid month or year')) {
            return res.status(400).json({ message: error.message });
        }
        handleBackupError(res, error, 'Failed to export sales PDF');
    }
});

app.get('/api/system/backup/sql', sensitiveOperationLimiter, requireBackupDownloadAccess, async (req, res) => {
    try {
        const { filePath, filename } = await createDownloadDump(db);
        await auditFromRequest(db, req, {
            action: 'export_sql_backup',
            module: 'Backup',
            description: `SQL backup period=All Time result=ok file=${filename}`,
        });
        pipeDownload(res, filePath, filename, 'application/sql; charset=utf-8');
    } catch (error) {
        await auditFromRequest(db, req, {
            action: 'export_sql_backup',
            module: 'Backup',
            description: 'SQL backup period=All Time result=failed',
        });
        handleBackupError(res, error, 'Failed to create SQL database backup');
    }
});

app.post('/api/system/backup/restore', sensitiveOperationLimiter, requireAdmin, (req, res) => {
    sqlUpload.single('sqlFile')(req, res, async (uploadError) => {
        if (uploadError) {
            const tooLarge = uploadError.code === 'LIMIT_FILE_SIZE';
            return res.status(400).json({
                message: tooLarge
                    ? 'The uploaded SQL file exceeds the 100 MB limit'
                    : 'Only a .sql backup from this system can be restored',
            });
        }

        if (!req.file) {
            return res.status(400).json({ message: 'Please upload a .sql backup file' });
        }

        const uploadedPath = req.file.path;
        try {
            if (!String(req.file.originalname || '').toLowerCase().endsWith('.sql')) {
                return res.status(400).json({ message: 'Only a .sql backup from this system can be restored' });
            }
            const result = await restoreDatabaseFromFile(db, uploadedPath, {
                afterRestore: () => ensureApplicationSchema(db),
            });
            await auditFromRequest(db, req, {
                action: 'restore_sql_backup',
                module: 'Backup',
                description: `SQL restore result=ok tables=${result.tables} safety=${result.safetyBackup || 'none'}`,
            });
            res.status(200).json(result);
        } catch (error) {
            await auditFromRequest(db, req, {
                action: 'restore_sql_backup',
                module: 'Backup',
                description: 'SQL restore result=failed',
            });
            handleBackupError(res, error, 'Failed to restore database from SQL backup');
        } finally {
            fs.promises.unlink(uploadedPath).catch(() => { });
        }
    });
});

// ==========================================
// 💰 EXPENSE / SPENDING TRACKING
// ==========================================
app.get('/api/expenses', requireExpenseAccess, async (req, res) => {
    try {
        const expenses = await listExpenses(db, { days: req.query.days });
        res.status(200).json(expenses);
    } catch (error) {
        console.error('❌ EXPENSES FETCH ERROR:', error.message);
        res.status(500).json({ message: 'Failed to load expenses' });
    }
});

app.get('/api/expenses/summary', requireExpenseSummaryAccess, async (req, res) => {
    try {
        const todaySpending = await summarizeExpensesToday(db);
        res.status(200).json({ todaySpending });
    } catch (error) {
        console.error('❌ EXPENSE SUMMARY ERROR:', error.message);
        res.status(500).json({ message: 'Failed to load expense summary' });
    }
});

app.get('/api/dashboard/live', requireDashboardAccess, async (req, res) => {
    try {
        const conditions = await getLiveConditions();
        res.status(200).json(conditions);
    } catch (error) {
        console.error('❌ DASHBOARD LIVE CONDITIONS ERROR:', error.message);
        res.status(200).json({
            weather: { ok: false, reason: 'weather_unreachable' },
            exchange: { ok: false, reason: 'exchange_unreachable' },
            fetchedAt: new Date().toISOString(),
        });
    }
});

// ==========================================
// 🕒 CASH DRAWER & SHIFT MANAGEMENT (Z-REPORT)
// ==========================================
app.get('/api/shifts/current', requirePosFloorAccess, async (req, res) => {
    try {
        const shift = await getCurrentShift(db, req.user?.id);
        res.status(200).json({ shift });
    } catch (error) {
        console.error('❌ CURRENT SHIFT FETCH ERROR:', error.message);
        res.status(500).json({ message: 'Failed to load current shift' });
    }
});

app.post('/api/shifts/start', requirePermission('payment'), async (req, res) => {
    try {
        const { opening_float_usd, opening_float_khr } = req.body ?? {};
        const shift = await startShift(db, {
            userId: req.user?.id || 1,
            cashierName: req.user?.name || req.user?.username || 'Cashier',
            openingFloatUsd: opening_float_usd,
            openingFloatKhr: opening_float_khr,
        });

        await auditFromRequest(db, req, {
            action: 'shift_start',
            module: 'Payment',
            description: `Started shift #${shift.id} with float $${Number(shift.opening_float_usd).toFixed(2)} / ${Number(shift.opening_float_khr).toLocaleString()} ៛`,
        });

        res.status(201).json({ message: 'Shift started successfully', shift });
    } catch (error) {
        if (error.status === 400 || error.status === 409) {
            return res.status(error.status).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to start shift', errorId: logError(error, { route: 'POST /api/shifts/start' }) });
    }
});

app.post('/api/shifts/end', requirePermission('payment'), async (req, res) => {
    try {
        const { shift_id, closing_cash_usd, closing_cash_khr, notes } = req.body ?? {};
        if (!shift_id) {
            return res.status(400).json({ message: 'Missing shift_id' });
        }

        const shift = await endShift(db, {
            shiftId: shift_id,
            closingCashUsd: closing_cash_usd,
            closingCashKhr: closing_cash_khr,
            notes,
        });

        await auditFromRequest(db, req, {
            action: 'shift_end',
            module: 'Payment',
            description: `Closed shift #${shift.id} (Z-Report): Counted $${Number(shift.closing_cash_usd).toFixed(2)} + ${Number(shift.closing_cash_khr).toLocaleString()} ៛ (Diff: $${Number(shift.difference_usd).toFixed(2)} / ${Number(shift.difference_khr).toLocaleString()} ៛, total $${Number(shift.difference_total_usd).toFixed(2)})`,
        });

        res.status(200).json({ message: 'Shift closed successfully (Z-Report generated)', shift });
    } catch (error) {
        if (error.status === 400 || error.status === 404 || error.status === 409) {
            return res.status(error.status).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to close shift', errorId: logError(error, { route: 'POST /api/shifts/end' }) });
    }
});

app.get('/api/shifts/history', requirePosFloorAccess, async (req, res) => {
    try {
        const shifts = await listShiftHistory(db, req.query.limit);
        res.status(200).json({ shifts });
    } catch (error) {
        console.error('❌ SHIFTS HISTORY FETCH ERROR:', error.message);
        res.status(500).json({ message: 'Failed to load shift history' });
    }
});

app.post('/api/expenses', requireExpenseWriteAccess, async (req, res) => {
    try {
        const expense = await createExpense(db, req.body ?? {}, req.user);
        await auditFromRequest(db, req, {
            action: 'expense_create',
            module: 'Expenses',
            description: `Logged $${Number(expense.amount).toFixed(2)} (${expense.category}, paid from ${expense.paid_from})`,
        });
        // Staff/cashier till withdrawals notify admins only (not when admin logs it themselves).
        if (!isAdminRole(req.user?.role)) {
            await notifyAdminsOfExpense(db, { expense, actor: req.user }).catch((notifyError) => {
                logError(notifyError, { route: 'expense-admin-notify' });
            });
        }
        res.status(201).json(expense);
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) {
            const errorId = logError(error, { route: `${req.method} ${req.originalUrl}` });
            return res.status(500).json({ message: 'Failed to create expense', errorId });
        }
        res.status(status).json({ message: error.message || 'Failed to create expense' });
    }
});

app.delete('/api/expenses/:id', requireExpenseAccess, async (req, res) => {
    try {
        const expenseId = Number.parseInt(req.params.id, 10);
        const [rows] = await db.execute(
            'SELECT id, category, description, amount, expense_date FROM expenses WHERE id = ? LIMIT 1',
            [expenseId],
        );
        const previous = rows[0] || null;
        await deleteExpense(db, req.params.id);
        await auditFromRequest(db, req, {
            action: 'expense_delete',
            module: 'Expenses',
            description: previous
                ? `Deleted expense #${previous.id}: $${Number(previous.amount).toFixed(2)} (${previous.category}${previous.description ? `; ${previous.description}` : ''}) dated ${previous.expense_date}.`
                : `Deleted expense #${req.params.id}`,
        });
        res.status(200).json({ message: 'Expense deleted' });
    } catch (error) {
        const status = error.status || 500;
        if (status >= 500) {
            const errorId = logError(error, { route: `${req.method} ${req.originalUrl}` });
            return res.status(500).json({ message: 'Failed to delete expense', errorId });
        }
        res.status(status).json({ message: error.message || 'Failed to delete expense' });
    }
});

// ==========================================
// 📅 TABLE RESERVATIONS
// ==========================================

const requireReservationsAccess = requireAnyPermission('reservations', 'table')
const requireReportsAccess = requirePermission('reports')

app.get('/api/tables', requireReservationsAccess, async (_req, res) => {
    try {
        const tables = await listFloorTables(db)
        const floor = await getLiveFloorReservations(db)
        const standard = tables.filter((table) => table.section !== 'vip')
        const vip = tables.filter((table) => table.section === 'vip')
        const reservations = floor.tables || {}

        res.status(200).json({
            date: floor.date,
            counts: {
                standard: standard.length,
                vip: vip.length,
                takeout: 1,
            },
            standard,
            vip,
            takeout: {
                id: 'takeout',
                name: 'Take Out',
                section: 'takeout',
                capacity: null,
                status: 'Empty',
            },
            tables,
            reservations,
        })
    } catch (error) {
        console.error('❌ TABLES FLOOR ERROR:', error.message)
        res.status(500).json({ message: 'Failed to load floor tables' })
    }
})

app.post('/api/tables', requireReservationsAccess, async (req, res) => {
    try {
        const rawName = String(req.body?.name || '').trim();
        const section = String(req.body?.section || 'standard').trim().toLowerCase() === 'vip' ? 'vip' : 'standard';
        const parsedCapacity = Number.parseInt(req.body?.capacity, 10);
        const capacity = Number.isInteger(parsedCapacity) && parsedCapacity > 0 ? parsedCapacity : (section === 'vip' ? 12 : 4);

        if (!rawName) {
            return res.status(400).json({ message: 'Table name is required' });
        }
        if (rawName.length > 60) {
            return res.status(400).json({ message: 'Table name cannot exceed 60 characters' });
        }

        const [existing] = await db.execute(
            'SELECT id FROM tables WHERE LOWER(table_name) = LOWER(?) LIMIT 1',
            [rawName],
        );
        if (existing.length > 0) {
            return res.status(409).json({ message: 'A table with this name already exists' });
        }

        const [result] = await db.execute(
            'INSERT INTO tables (table_name, section, capacity, status) VALUES (?, ?, ?, "Empty")',
            [rawName, section, capacity],
        );

        const newTable = {
            id: result.insertId,
            name: rawName,
            section,
            capacity,
            status: 'Empty',
        };

        await auditFromRequest(db, req, {
            action: 'create_table',
            module: 'Tables',
            description: `Created new table "${rawName}" (Section: ${section}, Capacity: ${capacity})`,
        });

        res.status(201).json({ message: 'Table created successfully', table: newTable });
    } catch (error) {
        console.error('❌ CREATE TABLE ERROR:', error.message);
        res.status(500).json({ message: 'Failed to create table', errorId: logError(error, { route: 'POST /api/tables' }) });
    }
});

app.post('/api/tables/transfer', requirePosFloorAccess, async (req, res) => {
    const fromId = Number.parseInt(req.body?.from_table_id, 10);
    const toId = Number.parseInt(req.body?.to_table_id, 10);

    if (!Number.isInteger(fromId) || fromId <= 0 || !Number.isInteger(toId) || toId <= 0) {
        return res.status(400).json({ message: 'Valid source and destination table IDs are required' });
    }
    if (fromId === toId) {
        return res.status(400).json({ message: 'Source and destination tables must be different' });
    }

    try {
        await ensureReservationsSchema(db);
        await withTransaction(db, async (conn) => {
            const [tables] = await conn.execute(
                'SELECT id, table_name, status, merged_into FROM tables WHERE id IN (?, ?)',
                [fromId, toId],
            );
            const sourceTable = tables.find((t) => t.id === fromId);
            const destTable = tables.find((t) => t.id === toId);

            if (!sourceTable) {
                const err = new Error('Source table does not exist');
                err.status = 404;
                throw err;
            }
            if (!destTable) {
                const err = new Error('Destination table does not exist');
                err.status = 404;
                throw err;
            }
            if (destTable.merged_into != null) {
                const err = new Error(`${destTable.table_name} is merged into another table`);
                err.status = 400;
                throw err;
            }

            const [destOrders] = await conn.execute(
                `SELECT id FROM orders
                 WHERE (target_id = ? OR table_id = ?) AND source_type = 'Table' AND status = 'Pending'
                 LIMIT 1`,
                [toId, toId],
            );
            if (destOrders.length > 0) {
                const err = new Error(`${destTable.table_name} is already occupied with an active order`);
                err.status = 400;
                throw err;
            }

            const [sourceOrders] = await conn.execute(
                `SELECT id FROM orders
                 WHERE (target_id = ? OR table_id = ?) AND source_type = 'Table' AND status = 'Pending'
                 LIMIT 1`,
                [fromId, fromId],
            );

            if (sourceOrders.length > 0) {
                const orderId = sourceOrders[0].id;
                await conn.execute(
                    'UPDATE orders SET target_id = ?, table_id = ?, updated_at = NOW() WHERE id = ?',
                    [toId, toId, orderId],
                );
            }

            await conn.execute(
                `UPDATE reservations
                 SET table_id = ?
                 WHERE table_id = ? AND reservation_date = CURDATE() AND status = 'Seated'`,
                [toId, fromId],
            );

            await conn.execute('UPDATE tables SET status = "Empty" WHERE id = ?', [fromId]);
            await conn.execute('UPDATE tables SET status = "Occupied" WHERE id = ?', [toId]);
            // Tables merged onto the moved table follow it to the new one.
            await conn.execute('UPDATE tables SET merged_into = ? WHERE merged_into = ?', [toId, fromId])
                .catch((err) => console.warn('⚠️ Could not move merged tables:', err.message));
        }, { locks: [tableLockName(fromId), tableLockName(toId)] });

        await auditFromRequest(db, req, {
            action: 'transfer_table',
            module: 'Tables',
            description: `Transferred table order from table #${fromId} to table #${toId}`,
        });

        res.status(200).json({
            message: 'Table transferred successfully',
            from_table_id: fromId,
            to_table_id: toId,
        });
    } catch (error) {
        if ([400, 404, 409].includes(error.status)) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('❌ TRANSFER TABLE ERROR:', error.message);
        res.status(500).json({ message: 'Failed to transfer table', errorId: logError(error, { route: 'POST /api/tables/transfer' }) });
    }
});

// Tables merged onto `hostId` come back to the floor once the host table is freed.
async function releaseMergedTables(conn, hostId) {
    if (!hostId) return;
    try {
        await conn.execute('UPDATE tables SET merged_into = NULL, status = "Empty" WHERE merged_into = ?', [hostId]);
    } catch (err) {
        console.warn('⚠️ Could not release merged tables:', err.message);
    }
}

app.post('/api/tables/merge', requirePosFloorAccess, async (req, res) => {
    const fromId = Number.parseInt(req.body?.from_table_id, 10);
    const toId = Number.parseInt(req.body?.to_table_id, 10);

    if (!Number.isInteger(fromId) || fromId <= 0 || !Number.isInteger(toId) || toId <= 0) {
        return res.status(400).json({ message: 'Valid source and destination table IDs are required' });
    }
    if (fromId === toId) {
        return res.status(400).json({ message: 'Source and destination tables must be different' });
    }

    try {
        await ensureReservationsSchema(db);
        await withTransaction(db, async (conn) => {
            const [tables] = await conn.execute(
                'SELECT id, table_name, status, merged_into FROM tables WHERE id IN (?, ?)',
                [fromId, toId],
            );
            const sourceTable = tables.find((t) => t.id === fromId);
            const destTable = tables.find((t) => t.id === toId);

            if (!sourceTable) {
                const err = new Error('Source table does not exist');
                err.status = 404;
                throw err;
            }
            if (!destTable) {
                const err = new Error('Destination table does not exist');
                err.status = 404;
                throw err;
            }
            if (sourceTable.merged_into != null || destTable.merged_into != null) {
                const err = new Error('That table is already merged into another table');
                err.status = 400;
                throw err;
            }

            const [sourceOrders] = await conn.execute(
                `SELECT id FROM orders
                 WHERE (target_id = ? OR table_id = ?) AND source_type = 'Table' AND status = 'Pending'
                 LIMIT 1`,
                [fromId, fromId],
            );
            if (!sourceOrders.length) {
                const err = new Error(`Source table ${sourceTable.table_name} has no active order to merge`);
                err.status = 400;
                throw err;
            }
            const sourceOrderId = sourceOrders[0].id;

            const [destOrders] = await conn.execute(
                `SELECT id FROM orders
                 WHERE (target_id = ? OR table_id = ?) AND source_type = 'Table' AND status = 'Pending'
                 LIMIT 1`,
                [toId, toId],
            );

            if (destOrders.length > 0) {
                const destOrderId = destOrders[0].id;
                await reconcileOrderStock(conn, sourceOrderId, [], req.user?.id ?? null);
                await conn.execute(
                    'UPDATE order_items SET order_id = ? WHERE order_id = ?',
                    [destOrderId, sourceOrderId],
                );
                const [mergedLines] = await conn.execute(
                    'SELECT menu_item_id, quantity FROM order_items WHERE order_id = ?',
                    [destOrderId],
                );
                await reconcileOrderStock(conn, destOrderId, mergedLines, req.user?.id ?? null);
                await conn.execute(
                    "UPDATE orders SET status = 'Canceled', updated_at = NOW() WHERE id = ?",
                    [sourceOrderId],
                );
                const [itemSumRows] = await conn.execute(
                    'SELECT COALESCE(SUM(quantity * price), 0) AS total FROM order_items WHERE order_id = ?',
                    [destOrderId],
                );
                const newTotal = Math.round(Number(itemSumRows[0]?.total || 0) * 100) / 100;
                await conn.execute(
                    'UPDATE orders SET subtotal = ?, total = ?, total_amount = ?, updated_at = NOW() WHERE id = ?',
                    [newTotal, newTotal, newTotal, destOrderId],
                );
            } else {
                await conn.execute(
                    'UPDATE orders SET target_id = ?, table_id = ?, updated_at = NOW() WHERE id = ?',
                    [toId, toId, sourceOrderId],
                );
            }

            await conn.execute(
                `UPDATE reservations
                 SET table_id = ?
                 WHERE table_id = ? AND reservation_date = CURDATE() AND status = 'Seated'`,
                [toId, fromId],
            );

            // The source table leaves the floor until the merged bill is cleared.
            await conn.execute('UPDATE tables SET status = "Empty", merged_into = ? WHERE id = ?', [toId, fromId]);
            await conn.execute('UPDATE tables SET merged_into = ? WHERE merged_into = ?', [toId, fromId]);
            await conn.execute('UPDATE tables SET status = "Occupied" WHERE id = ?', [toId]);
        }, { locks: [tableLockName(fromId), tableLockName(toId)] });

        await auditFromRequest(db, req, {
            action: 'merge_table',
            module: 'Tables',
            description: `Merged table #${fromId} into table #${toId}`,
        });

        res.status(200).json({
            message: 'Tables merged successfully',
            from_table_id: fromId,
            to_table_id: toId,
        });
    } catch (error) {
        if ([400, 404, 409].includes(error.status)) {
            return res.status(error.status).json({ message: error.message });
        }
        res.status(500).json({ message: 'Failed to merge tables', errorId: logError(error, { route: 'POST /api/tables/merge' }) });
    }
});

app.post('/api/tables/:id/clear', requirePosFloorAccess, async (req, res) => {
    const rawId = req.params.id;
    let target;
    try {
        target = normalizeIncomingTarget(rawId);
    } catch (err) {
        return res.status(400).json({ message: err.message });
    }

    try {
        const { sql, params } = pendingOrderWhereClause(target);

        await withTransaction(db, async (conn) => {
            const [pendingOrders] = await conn.execute(
                `SELECT id FROM orders WHERE ${sql} LIMIT 1`,
                params,
            );

            if (!isAdminRole(req.user?.role) && pendingOrders.length > 0) {
                const [unpaidItems] = await conn.execute(
                    'SELECT id FROM order_items WHERE order_id = ? LIMIT 1',
                    [pendingOrders[0].id],
                );
                if (unpaidItems.length > 0) {
                    const error = new Error('This table has not been paid yet. Only an administrator can cancel an unpaid order.');
                    error.status = 403;
                    throw error;
                }
            }

            if (pendingOrders.length > 0) {
                const orderId = pendingOrders[0].id;
                await reconcileOrderStock(conn, orderId, [], req.user?.id ?? null);
                await conn.execute(
                    "UPDATE orders SET status = 'Canceled', updated_at = NOW() WHERE id = ?",
                    [orderId],
                );
            }

            if (target.sourceType === 'Table' && target.tableId) {
                await conn.execute('UPDATE tables SET status = "Empty" WHERE id = ?', [target.tableId]);
                await releaseMergedTables(conn, target.tableId);
            }
        }, { locks: [pendingOrderLockName(target)] });

        await auditFromRequest(db, req, {
            action: 'clear_table',
            module: 'Tables',
            description: `Cleared table/ticket "${target.key}"`,
        });

        res.status(200).json({ message: 'Table cleared successfully', target_id: target.key });
    } catch (error) {
        if (error.status === 403 || error.status === 409) {
            return res.status(error.status).json({ message: error.message });
        }
        console.error('❌ CLEAR TABLE ERROR:', error.message);
        res.status(500).json({ message: 'Failed to clear table', errorId: logError(error, { route: `POST /api/tables/${rawId}/clear` }) });
    }
});

app.delete('/api/tables/:id', requireReservationsAccess, async (req, res) => {
    const tableId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(tableId) || tableId <= 0) {
        return res.status(400).json({ message: 'Invalid table ID' });
    }

    try {
        const [existing] = await db.execute('SELECT id, table_name FROM tables WHERE id = ? LIMIT 1', [tableId]);
        if (!existing.length) {
            return res.status(404).json({ message: 'Table not found' });
        }

        const [orders] = await db.execute(
            "SELECT id FROM orders WHERE (target_id = ? OR table_id = ?) AND status = 'Pending' LIMIT 1",
            [tableId, tableId],
        );
        if (orders.length > 0) {
            return res.status(400).json({ message: 'Cannot delete table with active pending orders. Clear the table first.' });
        }

        const [reservations] = await db.execute(
            `SELECT id FROM reservations
             WHERE table_id = ? AND reservation_date >= CURDATE()
               AND status IN ('Pending', 'Confirmed', 'Paid', 'Reserved', 'Seated')
             LIMIT 1`,
            [tableId],
        );
        if (reservations.length > 0) {
            return res.status(400).json({ message: 'Cannot delete table with active or upcoming reservations.' });
        }

        await db.execute('DELETE FROM tables WHERE id = ?', [tableId]);

        await auditFromRequest(db, req, {
            action: 'delete_table',
            module: 'Tables',
            description: `Deleted table #${tableId} (${existing[0].table_name})`,
        });

        res.status(200).json({ message: 'Table deleted successfully', id: tableId });
    } catch (error) {
        console.error('❌ DELETE TABLE ERROR:', error.message);
        res.status(500).json({ message: 'Failed to delete table', errorId: logError(error, { route: `DELETE /api/tables/${tableId}` }) });
    }
});

app.get('/api/reports', requireReportsAccess, async (req, res) => {
    try {
        const report = await buildSalesReport(db, { days: req.query.days })
        res.status(200).json(report)
    } catch (error) {
        console.error('❌ REPORTS ERROR:', error.message)
        res.status(500).json({ message: 'Failed to load sales report', errorId: logError(error, { route: `${req.method} ${req.originalUrl}` }) })
    }
})

app.get('/api/reports/export/:kind', sensitiveOperationLimiter, requireReportsAccess, async (req, res) => {
    const kind = req.params.kind === 'excel' ? 'xlsx' : req.params.kind
    if (kind !== 'pdf' && kind !== 'xlsx') {
        return res.status(400).json({ message: 'Invalid export type.' })
    }
    try {
        const exported = await createReportExport(db, req.query, req.user, kind)
        await auditFromRequest(db, req, {
            action: kind === 'pdf' ? 'export_report_pdf' : 'export_report_excel',
            module: 'Reports',
            description: `Report ${exported.periodLabel}; sections: ${exported.sections.join(', ')}`,
        })
        res.setHeader('Content-Type', exported.contentType)
        res.setHeader('Content-Disposition', `attachment; filename="${exported.filename}"`)
        res.send(exported.buffer)
    } catch (error) {
        if (error?.status === 400) {
            return res.status(400).json({ message: error.message })
        }
        const errorId = logError(error, { route: `${req.method} ${req.originalUrl}` })
        res.status(500).json({ message: 'Failed to export the report', errorId })
    }
})

function sendReservationFailure(res, error, route) {
    const errorId = logError(error, { route });
    const status = Number(error?.status) || 500;
    if (status >= 500) {
        return res.status(500).json({ message: 'Something went wrong', errorId });
    }
    return res.status(status).json({ message: 'Invalid request', errorId });
}

app.get('/api/reservations/meta', requireReservationsAccess, async (_req, res) => {
    try {
        const tables = await listFloorTables(db)
        res.status(200).json({ tables, timeSlots: TIME_SLOTS, statuses: ALL_STATUSES })
    } catch (error) {
        return sendReservationFailure(res, error, 'GET /api/reservations/meta');
    }
})

app.get('/api/reservations/availability', requireReservationsAccess, async (req, res) => {
    try {
        const payload = await getAvailableTables(db, {
            date: req.query.date,
            timeSlot: req.query.time_slot,
            excludeId: req.query.exclude_id,
        })
        res.status(200).json(payload)
    } catch (error) {
        return sendReservationFailure(res, error, 'GET /api/reservations/availability');
    }
})

app.get('/api/reservations/floor', requireAnyPermission('reservations', 'table'), async (_req, res) => {
    try {
        const payload = await getLiveFloorReservations(db)
        res.status(200).json(payload)
    } catch (error) {
        return sendReservationFailure(res, error, 'GET /api/reservations/floor');
    }
})

app.get('/api/reservations', requireReservationsAccess, async (req, res) => {
    try {
        const reservations = await listReservations(db, req.query)
        res.status(200).json(reservations)
    } catch (error) {
        return sendReservationFailure(res, error, 'GET /api/reservations');
    }
})

app.get('/api/reservations/:id', requireReservationsAccess, async (req, res) => {
    try {
        const reservation = await getReservation(db, req.params.id)
        res.status(200).json(reservation)
    } catch (error) {
        return sendReservationFailure(res, error, 'GET /api/reservations/:id');
    }
})

app.post('/api/reservations', requireReservationsAccess, async (req, res) => {
    try {
        const reservation = await createReservation(db, req.body, req.user)
        notifyReservationCreated(db, reservation).catch(() => null)
        res.status(201).json(reservation)
    } catch (error) {
        return sendReservationFailure(res, error, 'POST /api/reservations');
    }
})

app.put('/api/reservations/:id', requireReservationsAccess, async (req, res) => {
    try {
        const reservation = await updateReservation(db, req.params.id, req.body)
        if (req.body?.status === 'Pending') {
            notifyReservationCreated(db, reservation).catch(() => null)
        }
        res.status(200).json(reservation)
    } catch (error) {
        return sendReservationFailure(res, error, 'PUT /api/reservations/:id');
    }
})

app.post('/api/reservations/:id/check-in', requireReservationsAccess, async (req, res) => {
    try {
        const reservation = await checkInReservation(db, req.params.id)
        res.status(200).json(reservation)
    } catch (error) {
        return sendReservationFailure(res, error, 'POST /api/reservations/:id/check-in');
    }
})

app.post('/api/reservations/:id/confirmation-letter', requireReservationsAccess, async (req, res) => {
    try {
        const reservation = await getReservation(db, req.params.id)
        const result = await sendReservationConfirmationLetter({
            reservation,
            to: req.body?.email,
        })
        await auditFromRequest(db, req, {
            action: 'reservation_letter_send',
            module: 'Reservations',
            description: `Sent confirmation letter for booking #${reservation.id} (${reservation.customer_name}) to ${String(req.body?.email || '').trim()}`,
        })
        res.status(200).json({
            message: result.delivered
                ? 'Confirmation letter sent'
                : 'Confirmation letter saved to the mail log (SMTP is not configured)',
            delivered: result.delivered,
            method: result.method,
        })
    } catch (error) {
        return sendReservationFailure(res, error, 'POST /api/reservations/:id/confirmation-letter');
    }
})

app.delete('/api/reservations/:id', requireReservationsAccess, async (req, res) => {
    try {
        const reservation = await deleteReservation(db, req.params.id)
        res.status(200).json({ message: 'Reservation deleted', reservation })
    } catch (error) {
        return sendReservationFailure(res, error, 'DELETE /api/reservations/:id');
    }
})

// ==========================================
// 🔐 AUDIT LOGS (ADMIN)
// ==========================================
app.get('/api/audit-logs', requireAdmin, async (req, res) => {
    try {
        const payload = await listAuditLogs(db, req.query);
        res.status(200).json(payload);
    } catch (error) {
        console.error('❌ AUDIT LOGS FETCH ERROR:', error.message);
        res.status(500).json({ message: 'Failed to load audit logs' });
    }
});

// ==========================================
// 🛟 GLOBAL ERROR + 404 HANDLERS
// ==========================================
app.use(notFoundHandler);
app.use(errorHandler);

// ==========================================
// 🚀 START SERVER
// ==========================================
const PORT = env.port;

// A rejected promise or throw outside Express must not disappear silently, and must not
// leave the process running in an unknown state. Log it, then exit so the supervisor
// (pm2/systemd/nodemon) restarts on clean footing.
process.on('unhandledRejection', (reason) => {
    logError(reason instanceof Error ? reason : new Error(String(reason)), {
        route: 'process:unhandledRejection',
    });
});

process.on('uncaughtException', (error) => {
    logError(error, { route: 'process:uncaughtException' });
    console.error('❌ Uncaught exception - shutting down for a clean restart.');
    process.exit(1);
});

app.listen(PORT, async () => {
    console.log(`🚀 ${STORE.officialName} Backend running smoothly on port ${PORT}`);
    console.log(`   CORS allowed origins: ${env.security.allowedOrigins.join(', ')}`);
    console.log('   Security: helmet on, rate limiting on, sliding JWT sessions');

    try {
        await db.execute('SELECT 1');
        console.log(`   Database connection: OK (${resolveDbHost(env.db.host)}:${env.db.database})`);
        const restoredSaleDates = await ensureApplicationSchema(db);
        startReservationReminderJob(db);
        startLoginSecurityCleanup(db);
        startRevokedTokenCleanup(db);
        console.log('   Login security schema: OK');
        console.log(`   Session lifetime: ${SESSION_DAYS} days (sliding renewal after 24h of token age)`);
        console.log('   Inventory schema: OK');
        if (restoredSaleDates > 0) {
            console.log(`   Orders sale dates restored: ${restoredSaleDates} (updated_at <- created_at)`);
        }
        console.log('   Order timestamps: OK (no ON UPDATE stamp)');
        console.log('   Order items schema: OK');
        console.log('   Menu items schema: OK');
        console.log('   Expenses / audit schema: OK');
        console.log('   Floor tables / reservations schema: OK');
        console.log(`   Admin recovery email: ${env.adminEmail}`);
    } catch (error) {
        console.error('❌ Database connection failed:', error.code || error.message);
        console.error('   Start MySQL in Laragon, then restart this server.');
    }
});