const TelegramBot = require("node-telegram-bot-api");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const fs = require("fs");

// ============================================================
// J.A.R.B.I.S — TELEGRAM SUBSCRIPTION BOT
// ============================================================

// ============================================================
// НАСТРОЙКИ
// ============================================================

const BOT_TOKEN = process.env.TELEGRAM_TOKEN;

const ADMIN_IDS = [
    8723208814,
    8882462981
];

const SUPPORT_APP = "@JARBIS_help";
const SUPPORT_BOT = "@sakuraYTST";

// --- ИИ для админов (ключ хранится в Railway -> Variables) ---
const AI_API_KEY = process.env.AI_API_KEY;
const AI_MODEL = process.env.AI_MODEL || "gemini-3.8-flash";

const CARD_NUMBER =
    process.env.CARD_NUMBER || "2200 1536 2364 5513";

const CARD_HOLDER =
    process.env.CARD_HOLDER || "Получатель: Алексей М.";

// ============================================================
// ПРОВЕРКА TOKEN
// ============================================================

if (!BOT_TOKEN) {
    console.error("❌ TELEGRAM_TOKEN не установлен!");
    process.exit(1);
}

// ============================================================
// TELEGRAM BOT
// ============================================================

const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

// ============================================================
// КНОПКА ИИ В ГЛАВНОМ МЕНЮ (только для админов)
// ============================================================

const AI_BUTTON = "🤖 ИИ";

const _sendMessage = bot.sendMessage.bind(bot);

bot.sendMessage = (chatId, text, options = {}) => {

    const kb =
        options &&
        options.reply_markup &&
        options.reply_markup.keyboard;

    if (
        kb &&
        isAdmin(chatId) &&
        !JSON.stringify(kb).includes(AI_BUTTON)
    ) {

        options = {
            ...options,
            reply_markup: {
                ...options.reply_markup,
                keyboard: [
                    ...kb,
                    [
                        {
                            text: AI_BUTTON
                        }
                    ]
                ]
            }
        };
    }

    return _sendMessage(
        chatId,
        text,
        options
    );
};

// ============================================================
// DATABASE
// ============================================================

const DB_FILE = fs.existsSync("/data")
    ? "/data/subscriptions.db"
    : "./subscriptions.db";

const db = new Database(DB_FILE);

db.pragma("journal_mode = WAL");

// ============================================================
// DATABASE FUNCTIONS
// ============================================================

function columnExists(table, column) {

    const columns = db
        .prepare(PRAGMA table_info(${table}))
        .all();

    return columns.some(
        item => item.name === column
    );
}

function addColumn(table, column, definition) {

    if (!columnExists(table, column)) {

        db.exec(
            ALTER TABLE ${table}
            ADD COLUMN ${column} ${definition}
        );
    }
}

function initDb() {

    db.exec(
        CREATE TABLE IF NOT EXISTS users (
            user_id INTEGER PRIMARY KEY,
            username TEXT,
            name TEXT,
            email TEXT,
            sub_until TEXT,
            total_paid INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS payments (
            order_id TEXT PRIMARY KEY,
            user_id INTEGER NOT NULL,
            tariff TEXT NOT NULL,
            amount INTEGER NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            paid_at TEXT,
            name TEXT,
            email TEXT
        );

        CREATE TABLE IF NOT EXISTS admins (
            user_id INTEGER PRIMARY KEY,
            online INTEGER DEFAULT 1,
            offline_until TEXT
        );
    );

addColumn(
        "users",
        "username",
        "TEXT"
    );

    addColumn(
        "users",
        "name",
        "TEXT"
    );

    addColumn(
        "users",
        "email",
        "TEXT"
    );

    addColumn(
        "users",
        "sub_until",
        "TEXT"
    );

    addColumn(
        "users",
        "total_paid",
        "INTEGER DEFAULT 0"
    );

    addColumn(
        "payments",
        "name",
        "TEXT"
    );

    addColumn(
        "payments",
        "email",
        "TEXT"
    );

    for (const adminId of ADMIN_IDS) {

        db.prepare(
            INSERT OR IGNORE INTO admins
            (
                user_id,
                online,
                offline_until
            )
            VALUES (?, 1, NULL)
        ).run(adminId);
    }
}

initDb();

// ============================================================
// USERS
// ============================================================

function upsertUser(userId, username = null) {

    db.prepare(
        INSERT OR IGNORE INTO users
        (
            user_id,
            username
        )
        VALUES (?, ?)
    ).run(
        userId,
        username
    );

    if (username) {

        db.prepare(
            UPDATE users
            SET username = ?
            WHERE user_id = ?
        ).run(
            username,
            userId
        );
    }
}

function getUser(userId) {

    return db.prepare(
        SELECT *
        FROM users
        WHERE user_id = ?
    ).get(userId);
}

// ============================================================
// TARIFFS
// ============================================================

const TARIFFS = {

    "80": {
        name: "3 дня",
        days: 3,
        price: 80
    },

    "350": {
        name: "1 месяц",
        days: 30,
        price: 350
    },

    "700": {
        name: "3 месяца",
        days: 90,
        price: 700
    },

    "1400": {
        name: "6 месяцев",
        days: 180,
        price: 1400
    },

    "2800": {
        name: "1 год",
        days: 365,
        price: 2800
    },

    "5000": {
        name: "Навсегда",
        days: 36500,
        price: 5000
    }

};

// ============================================================
// ADMIN
// ============================================================

function isAdmin(userId) {

    return ADMIN_IDS.includes(
        Number(userId)
    );
}

function getAdminStatus(userId) {

    const row =
        db.prepare(
            SELECT *
            FROM admins
            WHERE user_id = ?
        ).get(userId);

    if (!row) {

        return {
            online: false
        };
    }

    if (
        row.online === 0 &&
        row.offline_until
    ) {

        const until =
            new Date(
                row.offline_until
            );

        if (until <= new Date()) {

            db.prepare(
                UPDATE admins
                SET
                    online = 1,
                    offline_until = NULL
                WHERE user_id = ?
            ).run(userId);

            return {
                online: true
            };
        }
    }

    return {

        online:
            row.online === 1,

        offlineUntil:
            row.offline_until
    };
}

function setAdminOnline(userId) {

    db.prepare(
        UPDATE admins
        SET
            online = 1,
            offline_until = NULL
        WHERE user_id = ?
    ).run(userId);
}

function setAdminOffline(userId, until) {

    db.prepare(
        UPDATE admins
        SET
            online = 0,
            offline_until = ?
        WHERE user_id = ?
    ).run(
        until.toISOString(),
        userId
    );
}

function getOnlineAdminsCount() {

    return ADMIN_IDS.filter(
        id =>
            getAdminStatus(id).online
    ).length;
}

function getStatusText() {

    if (
        getOnlineAdminsCount() > 0
    ) {

        return "🟢 Администратор в онлайне";
    }

return (
        "🔴 Администратор сейчас " +
        "не может одобрить заявку.\n" +
        "Пожалуйста, подождите."
    );
}

// ============================================================
// OFFLINE TIME
// ============================================================

function parseOfflineTime(text) {

    const value =
        text.toLowerCase().trim();

    const regex =
        /(\d+)\s*(d|h|m|s)/g;

    let match;

    let totalSeconds = 0;

    let found = false;

    while (
        (match = regex.exec(value))
    ) {

        found = true;

        const number =
            Number(match[1]);

        const unit =
            match[2];

        if (unit === "d") {
            totalSeconds +=
                number * 86400;
        }

        if (unit === "h") {
            totalSeconds +=
                number * 3600;
        }

        if (unit === "m") {
            totalSeconds +=
                number * 60;
        }

        if (unit === "s") {
            totalSeconds +=
                number;
        }
    }

    const cleaned =
        value
            .replace(
                /(\d+)\s*(d|h|m|s)/g,
                ""
            )
            .trim();

    if (
        !found ||
        cleaned !== "" ||
        totalSeconds < 1
    ) {

        return null;
    }

    if (
        totalSeconds >
        15 * 86400
    ) {

        return "MAX";
    }

    return totalSeconds;
}

function formatDuration(seconds) {

    const result = [];

    const days =
        Math.floor(
            seconds / 86400
        );

    seconds %= 86400;

    const hours =
        Math.floor(
            seconds / 3600
        );

    seconds %= 3600;

    const minutes =
        Math.floor(
            seconds / 60
        );

    seconds %= 60;

    if (days) {
        result.push(${days}д);
    }

    if (hours) {
        result.push(${hours}ч);
    }

    if (minutes) {
        result.push(${minutes}мин);
    }

    if (seconds) {
        result.push(${seconds}сек);
    }

    return result.join(" ");
}

// ============================================================
// SUBSCRIPTION
// ============================================================

function isSubActive(userId) {

    const user =
        getUser(userId);

    if (
        !user ||
        !user.sub_until
    ) {

        return false;
    }

    return (
        new Date(
            user.sub_until
        ) > new Date()
    );
}

function setSubscription(userId, days) {

    const user =
        getUser(userId);

    const now =
        new Date();

    let start =
        now;

    if (
        user &&
        user.sub_until
    ) {

        const current =
            new Date(
                user.sub_until
            );

        if (current > now) {
            start = current;
        }
    }

    const newUntil =
        new Date(
            start.getTime() +
            days * 86400000
        );

    db.prepare(
        UPDATE users
        SET sub_until = ?
        WHERE user_id = ?
    ).run(
        newUntil.toISOString(),
        userId
    );

    return newUntil;
}

// ============================================================
// ORDERS
// ============================================================

function createOrder(
    userId,
    tariffKey,
    name,
    email
) {

    const tariff =
        TARIFFS[tariffKey];

    if (!tariff) {

        throw new Error(
            "Тариф не найден"
        );
    }

    const orderId =
        crypto
            .randomBytes(5)
            .toString("hex")
            .toUpperCase();

    db.prepare(
        INSERT INTO payments
        (
            order_id,
            user_id,
            tariff,
            amount,
            status,
            created_at,
            name,
            email
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ).run(

        orderId,
        userId,
        tariffKey,
        tariff.price,
        "pending",
        new Date().toISOString(),
        name,
        email
    );

db.prepare(
        UPDATE users
        SET
            name = ?,
            email = ?
        WHERE user_id = ?
    ).run(
        name,
        email,
        userId
    );

    return orderId;
}

function getOrder(orderId) {

    return db.prepare(
        SELECT *
        FROM payments
        WHERE order_id = ?
    ).get(orderId);
}

function getPendingOrder(userId) {

    return db.prepare(
        SELECT *
        FROM payments
        WHERE
            user_id = ?
            AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
    ).get(userId);
}

// ============================================================
// CONFIRM ORDER
// ============================================================

function confirmOrder(orderId) {

    const order =
        getOrder(orderId);

    if (!order) {

        return {
            success: false,
            reason: "not_found"
        };
    }

    if (
        order.status !== "pending"
    ) {

        return {
            success: false,
            reason: "already_processed"
        };
    }

    const tariff =
        TARIFFS[order.tariff];

    if (!tariff) {

        return {
            success: false,
            reason: "tariff_not_found"
        };
    }

    const until =
        setSubscription(
            order.user_id,
            tariff.days
        );

    db.prepare(
        UPDATE payments
        SET
            status = 'paid',
            paid_at = ?
        WHERE
            order_id = ?
            AND status = 'pending'
    ).run(
        new Date().toISOString(),
        orderId
    );

    db.prepare(
        UPDATE users
        SET total_paid =
            total_paid + ?
        WHERE user_id = ?
    ).run(
        order.amount,
        order.user_id
    );

    return {

        success: true,

        userId:
            order.user_id,

        until,

        order
    };
}

// ============================================================
// REJECT
// ============================================================

function rejectOrder(orderId) {

    const order =
        getOrder(orderId);

    if (!order) {

        return {
            success: false,
            reason: "not_found"
        };
    }

    if (
        order.status !== "pending"
    ) {

        return {
            success: false,
            reason: "already_processed"
        };
    }

    db.prepare(
        UPDATE payments
        SET status = 'rejected'
        WHERE
            order_id = ?
            AND status = 'pending'
    ).run(orderId);

    return {

        success: true,

        userId:
            order.user_id,

        order
    };
}

// ============================================================
// EMAIL
// ============================================================

function validEmail(email) {

    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        .test(email);
}

// ============================================================
// MAIN MENU
// ============================================================

function mainMenu() {

    return {

        reply_markup: {

            keyboard: [

                [
                    {
                        text: "🔐 Войти"
                    },
                    {
                        text: "🛒 Купить"
                    }
                ],

                [
                    {
                        text: "👤 Мой аккаунт"
                    },
                    {
                        text: "ℹ️ Помощь"
                    }
                ],

                [
                    {
                        text: "🛠 Тех.поддержка"
                    }
                ]

            ],

            resize_keyboard: true,

            is_persistent: true
        }
    };
}

// ============================================================
// BUY MENU
// ============================================================

function buyMenu() {

    return {

        reply_markup: {

            inline_keyboard: [

[
                    {
                        text: "80 ₽ — 3 дня",
                        callback_data: "buy_80"
                    }
                ],

                [
                    {
                        text: "350 ₽ — 1 месяц",
                        callback_data: "buy_350"
                    }
                ],

                [
                    {
                        text: "700 ₽ — 3 месяца",
                        callback_data: "buy_700"
                    }
                ],

                [
                    {
                        text: "1400 ₽ — 6 месяцев",
                        callback_data: "buy_1400"
                    }
                ],

                [
                    {
                        text: "2800 ₽ — 1 год",
                        callback_data: "buy_2800"
                    }
                ],

                [
                    {
                        text: "5000 ₽ — навсегда",
                        callback_data: "buy_5000"
                    }
                ],

                [
                    {
                        text: "⬅️ Назад",
                        callback_data: "back"
                    }
                ]

            ]
        }
    };
}

// ============================================================
// ADMIN MENU
// ============================================================

function adminMenu() {

    return {

        reply_markup: {

            inline_keyboard: [

                [
                    {
                        text: "🟢 Я онлайн",
                        callback_data: "admin_online"
                    }
                ],

                [
                    {
                        text: "🔴 Я не онлайн",
                        callback_data: "admin_offline"
                    }
                ],

                [
                    {
                        text: "🤖 ИИ для админов",
                        callback_data: "admin_ai"
                    }
                ],

                [
                    {
                        text: "⬅️ Главное меню",
                        callback_data: "back"
                    }
                ]

            ]
        }
    };
}

// ============================================================
// ADMIN ORDER BUTTONS
// ============================================================

function adminOrderButtons(orderId) {

    return {

        reply_markup: {

            inline_keyboard: [

                [
                    {
                        text: "✅ Подтвердить",
                        callback_data:
                            confirm_${orderId}
                    },

                    {
                        text: "❌ Отклонить",
                        callback_data:
                            reject_${orderId}
                    }
                ]

            ]
        }
    };
}

// ============================================================
// STATES
// ============================================================

const userStates =
    new Map();

const adminWaitingTime =
    new Set();

// ============================================================
// ИИ ДЛЯ АДМИНОВ
// ============================================================

const aiMode =
    new Set();

const aiHistory =
    new Map();

const AI_SYSTEM =
    "Ты J.A.R.B.I.S — ИИ-помощник администраторов бота подписок. " +
    "Обращайся «сэр». Отвечай по-русски, кратко и по делу.";

function aiMenu() {

    return {

        reply_markup: {

            inline_keyboard: [

                [
                    {
                        text: "🧹 Очистить диалог",
                        callback_data: "ai_clear"
                    }
                ],

                [
                    {
                        text: "⛔ Выключить ИИ",
                        callback_data: "ai_off"
                    }
                ]

            ]
        }
    };
}

async function askAI(userId, text) {

if (!AI_API_KEY) {

        return "❌ AI_API_KEY не задан в Railway, сэр.";
    }

    const history =
        aiHistory.get(userId) || [];

    history.push({
        role: "user",
        parts: [{ text }]
    });

    while (history.length > 20) {
        history.splice(0, 2);
    }

    const res = await fetch(

        https://generativelanguage.googleapis.com/v1beta/models/${AI_MODEL}:generateContent,

        {
            method: "POST",

            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": AI_API_KEY
            },

            body: JSON.stringify({

                systemInstruction: {
                    parts: [{ text: AI_SYSTEM }]
                },

                contents: history
            })
        }
    );

    const data =
        await res.json();

    if (!res.ok) {

        history.pop();

        throw new Error(
            (data &&
                data.error &&
                data.error.message) ||
            HTTP ${res.status}
        );
    }

    const parts =
        (data &&
            data.candidates &&
            data.candidates[0] &&
            data.candidates[0].content &&
            data.candidates[0].content.parts) ||
        [];

    const answer =
        parts
            .map(p => p.text || "")
            .join("");

    if (!answer) {

        history.pop();

        return "🤔 ИИ не дал ответ, сэр. Переформулируйте вопрос.";
    }

    history.push({
        role: "model",
        parts: [{ text: answer }]
    });

    aiHistory.set(
        userId,
        history
    );

    return answer;
}

// ============================================================
// START
// ============================================================

bot.onText(
    /^\/start$/,
    async msg => {

        try {

            const userId =
                msg.from.id;

            upsertUser(
                userId,
                msg.from.username || null
            );

            const welcomeText =

                "📋 Главное меню\n\n" +

                "👋 Добро пожаловать в J.A.R.B.I.S!\n\n" +

                "🚀 Здесь вы можете приобрести " +
                "подписку и получить доступ к приложению.\n\n" +

                "Если администраторы не отвечают " +
                "обратитесь в тех.поддержку\n\n" +

                "🛒 Выберите тариф через кнопку «Купить».\n\n" +

                getStatusText();

            await bot.sendMessage(
                msg.chat.id,
                welcomeText,
                mainMenu()
            );

            if (
                isAdmin(userId)
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "👨‍💼 Панель администратора\n\n" +

                    🟢 Администраторов онлайн:  +
                    ${getOnlineAdminsCount()}/2,

                    adminMenu()
                );
            }

        } catch (error) {

            console.error(
                "START ERROR:",
                error
            );
        }
    }
);

// ============================================================
// /ID
// ============================================================

bot.onText(
    /^\/id$/,
    async msg => {

        await bot.sendMessage(

            msg.chat.id,

            🆔 Ваш Telegram ID:\n\n${msg.from.id},

            mainMenu()
        );
    }
);

// ============================================================
// /ADMIN
// ============================================================

bot.onText(
    /^\/admin$/,
    async msg => {

        if (
            !isAdmin(
                msg.from.id
            )
        ) {

            return;
        }

        await bot.sendMessage(

            msg.chat.id,

            "👨‍💼 Панель администратора\n\n" +

            🟢 Администраторов онлайн:  +
            ${getOnlineAdminsCount()}/2,

            adminMenu()
        );
    }
);

// ============================================================
// MESSAGE
// ============================================================

bot.on(
    "message",
    async msg => {

        try {

            if (!msg.text) {
                return;
            }

            const text =
                msg.text.trim();

            const userId =
                msg.from.id;

            upsertUser(
                userId,
                msg.from.username || null
            );

            // ==================================================
            // СЕКРЕТНЫЕ КОМАНДЫ
            // ==================================================

            if (
                text === "/как ты"
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "J.A.R.B.I.S: В полном порядке, сэр. " +
                    "Я функционирую нормально, но в конце фраз " +
                    "могу выдавать белиберду..."
                );

                return;
            }

            if (
                text === "/кто это тони старк"
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "Автор: гениц миллиардер плейбой филлиантроп\n\n" +

                    "Стен Ли: кто здесь тони карк?"
                );

                return;
            }

            if (
                text === "/альтрон"
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "Альтрон: в чем смысл человечества " +
                    "остановившись в развитии"
                );

                return;
            }

            if (
                text === "/том холланд"
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "Том холланд работает спойлерщиком"
                );

                return;
            }

            // ==================================================
            // НЕ ДАЁМ КОМАНДАМ ПОПАДАТЬ В СОСТОЯНИЯ
            // ==================================================

            if (
                text === "/start" ||
                text === "/id" ||
                text === "/admin"
            ) {
                return;
            }

            // ==================================================
            // ADMIN OFFLINE TIME
            // ==================================================

            if (
                isAdmin(userId) &&
                adminWaitingTime.has(userId)
            ) {

                const seconds =
                    parseOfflineTime(text);

                if (
                    seconds === "MAX"
                ) {

                    await bot.sendMessage(

                        msg.chat.id,

                        "❌ Максимум — 15 дней.\n\n" +

                        "Примеры:\n" +
                        "5h\n" +
                        "5m\n" +
                        "5s\n" +
                        "5d\n" +
                        "2d 5h 30m"
                    );

                    return;
                }

                if (
                    seconds === null
                ) {

                    await bot.sendMessage(

                        msg.chat.id,

                        "❌ Неверный формат.\n\n" +

                        "Используйте:\n" +
                        "5h\n" +
                        "5m\n" +
                        "5s\n" +
                        "5d\n" +
                        "2d 5h 30m"
                    );

                    return;
                }

                const until =
                    new Date(
                        Date.now() +
                        seconds * 1000
                    );

                setAdminOffline(
                    userId,
                    until
                );

                adminWaitingTime.delete(
                    userId
                );

                await bot.sendMessage(

                    msg.chat.id,

"🔴 Вы теперь не онлайн.\n\n" +

                    ⏱ Время: ${
                        formatDuration(seconds)
                    }\n +

                    🕐 До: ${
                        until.toLocaleString("ru-RU")
                    }\n\n +

                    "Когда вернётесь, " +
                    "нажмите «🟢 Я онлайн».",

                    adminMenu()
                );

                return;
            }

            // ==================================================
            // ADMIN ONLINE
            // ==================================================

            if (
                isAdmin(userId) &&
                text === "🟢 Я онлайн"
            ) {

                setAdminOnline(userId);

                await bot.sendMessage(

                    msg.chat.id,

                    "🟢 Вы снова онлайн!\n\n" +
                    getStatusText(),

                    adminMenu()
                );

                return;
            }

            // ==================================================
            // ADMIN OFFLINE
            // ==================================================

            if (
                isAdmin(userId) &&
                text === "🔴 Я не онлайн"
            ) {

                adminWaitingTime.add(
                    userId
                );

                await bot.sendMessage(

                    msg.chat.id,

                    "⏱ На какое время " +
                    "вы будете не онлайн?\n\n" +

                    "5h — 5 часов\n" +
                    "5m — 5 минут\n" +
                    "5s — 5 секунд\n" +
                    "5d — 5 дней\n\n" +

                    "⚠️ Максимум — 15 дней."
                );

                return;
            }

            // ==================================================
            // LOGIN
            // ==================================================

            if (
                text === "🔐 Войти"
            ) {

                if (
                    !isSubActive(userId)
                ) {

                    await bot.sendMessage(

                        msg.chat.id,

                        "❌ Вход запрещён.\n\n" +

                        "У вас нет активной подписки.\n\n" +

                        "🛒 Купите подписку и дождитесь " +
                        "подтверждения оплаты администратором.",

                        mainMenu()
                    );

                    return;
                }

                await bot.sendMessage(

                    msg.chat.id,

                    "🔐 Ваша подписка активна.\n\n" +

                    "⏳ Ждите, с вами в скором времени " +
                    "свяжутся.",

                    mainMenu()
                );

                return;
            }

            // ==================================================
            // BUY
            // ==================================================

            if (
                text === "🛒 Купить"
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "🛒 Выберите тариф:\n\n" +

                    "💡 После выбора тарифа вам нужно будет " +
                    "указать имя и почту.",

                    buyMenu()
                );

                return;
            }

            // ==================================================
            // SUPPORT
            // ==================================================

            if (
                text === "🛠 Тех.поддержка"
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "🛠 Тех.поддержка\n\n" +

                    "Тех.поддержка По\n" +
                    приложению: ${SUPPORT_APP}\n\n +

                    "Тех.поддержка по\n" +
                    боту: ${SUPPORT_BOT},

                    mainMenu()
                );

                return;
            }

// ==================================================
            // HELP
            // ==================================================

            if (
                text === "ℹ️ Помощь"
            ) {

                await bot.sendMessage(

                    msg.chat.id,

                    "ℹ️ Помощь\n\n" +

                    "🔐 Войти — проверить активную " +
                    "подписку.\n\n" +

                    "🛒 Купить — выбрать тариф и оформить заказ.\n\n" +

                    "👤 Мой аккаунт — посмотреть информацию " +
                    "о вашем аккаунте.\n\n" +

                    "🛠 Тех.поддержка — контакты поддержки.\n\n" +

                    "💳 Оплата производится по реквизитам, " +
                    "которые бот покажет после создания заказа.",

                    mainMenu()
                );

                return;
            }

            // ==================================================
            // MY ACCOUNT
            // ==================================================

            if (
                text === "👤 Мой аккаунт"
            ) {

                const user =
                    getUser(userId);

                let subscription =
                    "❌ Активной подписки нет.";

                if (
                    isSubActive(userId)
                ) {

                    subscription =
                        "✅ Подписка активна.\n\n" +

                        📅 До: ${
                            new Date(
                                user.sub_until
                            ).toLocaleString(
                                "ru-RU"
                            )
                        };
                }

                await bot.sendMessage(

                    msg.chat.id,

                    "👤 Мой аккаунт\n\n" +

                    🆔 Telegram ID: ${userId}\n +

                    👤 Username: ${
                        msg.from.username
                            ? "@" + msg.from.username
                            : "не указан"
                    }\n\n +

                    📧 Почта: ${
                        user.email || "не указана"
                    }\n\n +

                    💰 Всего оплачено: ${
                        user.total_paid || 0
                    } ₽\n\n +

                    subscription,

                    mainMenu()
                );

                return;
            }

            // ==================================================
            // ИИ ДЛЯ АДМИНОВ: кнопка «🤖 ИИ» или команда /ии
            // ==================================================

            if (
                text === AI_BUTTON ||
                text === "/ии"
            ) {

                if (
                    !isAdmin(userId)
                ) {

                    await bot.sendMessage(

                        msg.chat.id,

                        "⛔ Эта команда только для администраторов."
                    );

                    return;
                }

                adminWaitingTime.delete(
                    userId
                );

                aiMode.add(
                    userId
                );

                await bot.sendMessage(

                    msg.chat.id,

                    "🤖 ИИ для админов включён.\n\n" +

                    "Пишите вопрос обычным сообщением, сэр.",

                    aiMenu()
                );

                return;
            }

            // ==================================================
            // ИИ ДЛЯ АДМИНОВ: ответы (пока режим включён)
            // ==================================================

            if (
                isAdmin(userId) &&
                aiMode.has(userId)
            ) {

                await bot.sendChatAction(
                    msg.chat.id,
                    "typing"
                );

                try {

const answer =
                        await askAI(
                            userId,
                            text
                        );

                    for (
                        let i = 0;
                        i < answer.length;
                        i += 4000
                    ) {

                        await bot.sendMessage(

                            msg.chat.id,

                            answer.slice(
                                i,
                                i + 4000
                            )
                        );
                    }

                } catch (e) {

                    console.error(
                        "AI ERROR:",
                        e.message
                    );

                    await bot.sendMessage(

                        msg.chat.id,

                        "❌ Ошибка ИИ, сэр. " +
                        "Проверьте AI_API_KEY и логи Railway."
                    );
                }

                return;
            }

            // ==================================================
            // BUY STATE
            // ==================================================

            const state =
                userStates.get(userId);

            if (!state) {
                return;
            }

            // ==================================================
            // BUY NAME
            // ==================================================

            if (
                state.type === "buy" &&
                state.step === "name"
            ) {

                if (
                    text.length < 2 ||
                    text.length > 100
                ) {

                    await bot.sendMessage(

                        msg.chat.id,

                        "❌ Имя должно содержать " +
                        "от 2 до 100 символов.\n\n" +
                        "Введите имя ещё раз."
                    );

                    return;
                }

                state.name =
                    text;

                state.step =
                    "email";

                userStates.set(
                    userId,
                    state
                );

                await bot.sendMessage(

                    msg.chat.id,

                    "📧 Введите вашу почту:\n\n" +

                    "Например:\n" +
                    "example@gmail.com"
                );

                return;
            }

            // ==================================================
            // BUY EMAIL
            // ==================================================

            if (
                state.type === "buy" &&
                state.step === "email"
            ) {

                const email =
                    text.toLowerCase().trim();

                if (
                    !validEmail(email)
                ) {

                    await bot.sendMessage(

                        msg.chat.id,

                        "❌ Неверный формат почты.\n\n" +
                        "Введите email ещё раз:"
                    );

                    return;
                }

                const tariff =
                    TARIFFS[
                        state.tariffKey
                    ];

                const orderId =
                    createOrder(

                        userId,

                        state.tariffKey,

                        state.name,

                        email
                    );

                userStates.delete(
                    userId
                );

                await bot.sendMessage(

                    msg.chat.id,

                    "🧾 ЗАКАЗ СОЗДАН\n\n" +

                    № Заказа: ${orderId}\n\n +

                    👤 Имя: ${state.name}\n +

                    📧 Почта: ${email}\n\n +

                    📦 Тариф: ${tariff.name}\n +

                    💰 Сумма: ${tariff.price} ₽\n\n +

                    "💳 Реквизиты для оплаты:\n\n" +

Карта:\n${CARD_NUMBER}\n\n +

                    ${CARD_HOLDER}\n\n +

                    "⚠️ После оплаты нажмите " +
                    "«📷 Я оплатил» и отправьте чек.",

                    {

                        reply_markup: {

                            inline_keyboard: [

                                [
                                    {
                                        text: "📷 Я оплатил",
                                        callback_data:
                                            paid_${orderId}
                                    }
                                ],

                                [
                                    {
                                        text: "⬅️ Назад",
                                        callback_data: "back"
                                    }
                                ]

                            ]
                        }
                    }
                );

                return;
            }

        } catch (error) {

            console.error(
                "MESSAGE ERROR:",
                error
            );
        }
    }
);

// ============================================================
// CALLBACK QUERY
// ============================================================

bot.on(
    "callback_query",
    async query => {

        try {

            const data =
                query.data;

            const chatId =
                query.message.chat.id;

            const messageId =
                query.message.message_id;

            const userId =
                query.from.id;

            // ==================================================
            // ИИ ДЛЯ АДМИНОВ
            // ==================================================

            if (
                data === "back"
            ) {

                aiMode.delete(
                    userId
                );
            }

            if (
                data === "admin_ai"
            ) {

                if (
                    !isAdmin(userId)
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Нет доступа",
                            show_alert: true
                        }
                    );

                    return;
                }

                adminWaitingTime.delete(
                    userId
                );

                aiMode.add(
                    userId
                );

                await bot.answerCallbackQuery(
                    query.id
                );

                await bot.sendMessage(

                    chatId,

                    "🤖 ИИ для админов включён.\n\n" +

                    "Пишите вопрос обычным сообщением, сэр.",

                    aiMenu()
                );

                return;
            }

            if (
                data === "ai_clear"
            ) {

                if (
                    !isAdmin(userId)
                ) {
                    return;
                }

                aiHistory.delete(
                    userId
                );

                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text: "Диалог очищен 🧹"
                    }
                );

                return;
            }

            if (
                data === "ai_off"
            ) {

                if (
                    !isAdmin(userId)
                ) {
                    return;
                }

                aiMode.delete(
                    userId
                );

                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text: "ИИ выключен"
                    }
                );

                await bot.sendMessage(

                    chatId,

                    "⛔ ИИ выключен.",

                    adminMenu()
                );

return;
            }

            // ==================================================
            // BACK
            // ==================================================

            if (
                data === "back"
            ) {

                userStates.delete(
                    userId
                );

                adminWaitingTime.delete(
                    userId
                );

                await bot.answerCallbackQuery(
                    query.id
                );

                await bot.sendMessage(

                    chatId,

                    "📋 Главное меню\n\n" +

                    "👋 Вы вернулись в главное меню.\n\n" +

                    "Выберите действие:",

                    mainMenu()
                );

                return;
            }

            // ==================================================
            // ADMIN ONLINE
            // ==================================================

            if (
                data === "admin_online"
            ) {

                if (
                    !isAdmin(userId)
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Нет доступа",
                            show_alert: true
                        }
                    );

                    return;
                }

                setAdminOnline(userId);

                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text: "Вы онлайн 🟢"
                    }
                );

                await bot.sendMessage(

                    chatId,

                    "🟢 Вы онлайн!\n\n" +
                    getStatusText(),

                    adminMenu()
                );

                return;
            }

            // ==================================================
            // ADMIN OFFLINE
            // ==================================================

            if (
                data === "admin_offline"
            ) {

                if (
                    !isAdmin(userId)
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Нет доступа",
                            show_alert: true
                        }
                    );

                    return;
                }

                adminWaitingTime.add(
                    userId
                );

                await bot.answerCallbackQuery(
                    query.id
                );

                await bot.sendMessage(

                    chatId,

                    "⏱ На какое время " +
                    "вы будете не онлайн?\n\n" +

                    "5h — 5 часов\n" +
                    "5m — 5 минут\n" +
                    "5s — 5 секунд\n" +
                    "5d — 5 дней\n\n" +

                    "⚠️ Максимум — 15 дней."
                );

                return;
            }

            // ==================================================
            // BUY
            // ==================================================

            if (
                data.startsWith("buy_")
            ) {

                const tariffKey =
                    data.substring(4);

                const tariff =
                    TARIFFS[tariffKey];

                if (!tariff) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Тариф не найден",
                            show_alert: true
                        }
                    );

                    return;
                }

                userStates.set(

                    userId,

{
                        type: "buy",
                        step: "name",
                        tariffKey: tariffKey
                    }
                );

                await bot.answerCallbackQuery(
                    query.id
                );

                await bot.sendMessage(

                    chatId,

                    📦 Вы выбрали: ${tariff.name}\n\n +

                    💰 Цена: ${tariff.price} ₽\n\n +

                    "👤 Введите ваше имя:"
                );

                return;
            }

            // ==================================================
            // PAID
            // ==================================================

            if (
                data.startsWith("paid_")
            ) {

                const orderId =
                    data.substring(5);

                const order =
                    getOrder(orderId);

                if (!order) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Заказ не найден",
                            show_alert: true
                        }
                    );

                    return;
                }

                if (
                    order.user_id !== userId
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text:
                                "Этот заказ принадлежит другому пользователю",
                            show_alert: true
                        }
                    );

                    return;
                }

                await bot.answerCallbackQuery(
                    query.id
                );

                await bot.sendMessage(

                    chatId,

                    "📷 Отправьте чек оплаты.\n\n" +

                    🧾 Заказ: ${order.order_id}\n\n +

                    👤 Имя: ${order.name}\n +

                    📧 Почта: ${order.email}\n\n +

                    📦 Тариф: ${
                        TARIFFS[
                            order.tariff
                        ].name
                    }\n\n +

                    "После отправки чек будет " +
                    "передан администратору."
                );

                return;
            }

            // ==================================================
            // CONFIRM
            // ==================================================

            if (
                data.startsWith("confirm_")
            ) {

                if (
                    !isAdmin(userId)
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Нет доступа",
                            show_alert: true
                        }
                    );

                    return;
                }

                const orderId =
                    data.substring(8);

                const result =
                    confirmOrder(
                        orderId
                    );

                if (
                    !result.success
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text:
                                result.reason ===
                                "already_processed"
                                    ? "Заказ уже обработан"
                                    : "Заказ не найден",

                            show_alert: true
                        }
                    );

                    return;
                }

                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text:
                            "Оплата подтверждена ✅"
                    }
                );

                try {

await bot.editMessageReplyMarkup(

                        {
                            inline_keyboard: []
                        },

                        {
                            chat_id: chatId,
                            message_id: messageId
                        }
                    );

                } catch (_) {}

                // ==================================================
                // СООБЩЕНИЕ ПОСЛЕ ПОДТВЕРЖДЕНИЯ
                // ==================================================

                await bot.sendMessage(

                    result.userId,

                    "🎉 Оплата подтверждена!\n\n" +

                    "⏳ Ждите, с вами в скором времени " +
                    "свяжутся.\n\n" +

                    👤 Имя: ${result.order.name}\n +

                    📧 Почта: ${result.order.email}\n\n +

                    📦 Тариф: ${
                        TARIFFS[
                            result.order.tariff
                        ].name
                    }\n\n +

                    "📅 Подписка до:\n" +

                    ${result.until.toLocaleString(
                        "ru-RU"
                    )},

                    mainMenu()
                );

                return;
            }

            // ==================================================
            // REJECT
            // ==================================================

            if (
                data.startsWith("reject_")
            ) {

                if (
                    !isAdmin(userId)
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Нет доступа",
                            show_alert: true
                        }
                    );

                    return;
                }

                const orderId =
                    data.substring(7);

                const result =
                    rejectOrder(
                        orderId
                    );

                if (
                    !result.success
                ) {

                    await bot.answerCallbackQuery(

                        query.id,

                        {
                            text: "Заказ уже обработан",
                            show_alert: true
                        }
                    );

                    return;
                }

                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text: "Заказ отклонён ❌"
                    }
                );

                try {

                    await bot.editMessageReplyMarkup(

                        {
                            inline_keyboard: []
                        },

                        {
                            chat_id: chatId,
                            message_id: messageId
                        }
                    );

                } catch (_) {}

                await bot.sendMessage(

                    result.userId,

                    "❌ Ваша оплата не была подтверждена.\n\n" +

                    "Если вы уверены, что оплатили, " +
                    "обратитесь в поддержку:\n\n" +

                    Приложение: ${SUPPORT_APP}\n +

                    Бот: ${SUPPORT_BOT},

                    mainMenu()
                );

                return;
            }

        } catch (error) {

            console.error(
                "CALLBACK ERROR:",
                error
            );

            try {

                await bot.answerCallbackQuery(

                    query.id,

                    {
                        text: "Произошла ошибка",
                        show_alert: true
                    }
                );

            } catch (_) {}
        }
    }
);

// ============================================================
// RECEIPT
// ============================================================

async function handleReceipt(msg) {

    try {

        const order =
            getPendingOrder(
                msg.from.id
            );

        if (!order) {

            await bot.sendMessage(

                msg.chat.id,

                "❌ У вас нет ожидающего заказа.\n\n" +

                "Сначала создайте заказ через «🛒 Купить».",

                mainMenu()
            );

            return;
        }

        await bot.sendMessage(

            msg.chat.id,

            "✅ Чек получен!\n\n" +

            🧾 Заказ: ${order.order_id}\n\n +

            "Ожидайте проверки администратора.",

            mainMenu()
        );

        const username =
            msg.from.username
                ? @${msg.from.username}
                : "нет";

        const tariff =
            TARIFFS[
                order.tariff
            ];

        // ==================================================
        // ВАЖНО:
        // Здесь НЕТ parse_mode: Markdown.
        // Поэтому _ *  и другие символы пользователя
        // больше не вызывают ошибку Telegram 400.
        // ==================================================

        const adminText =

            "📩 НОВАЯ ЗАЯВКА\n\n" +

            🧾 Заказ: ${order.order_id}\n\n +

            👤 Имя: ${order.name}\n +

            📧 Почта: ${order.email}\n +

            👤 User ID: ${order.user_id}\n +

            👤 Username: ${username}\n\n +

            📦 Тариф: ${tariff.name}\n +

            💰 Сумма: ${order.amount} ₽\n\n +

            "💳 Проверьте перевод " +
            "и выберите действие:";

        // ==================================================
        // ОТПРАВКА ОБОИМ АДМИНАМ
        // ==================================================

        for (
            const adminId of ADMIN_IDS
        ) {

            try {

                await bot.sendMessage(

                    adminId,

                    adminText,

                    {
                        ...adminOrderButtons(
                            order.order_id
                        )
                    }
                );

                // Пересылаем сам чек
                await bot.forwardMessage(

                    adminId,

                    msg.chat.id,

                    msg.message_id
                );

                console.log(
                    ✅ Заявка ${order.order_id} отправлена админу ${adminId}
                );

            } catch (error) {

                console.error(

                    ❌ Ошибка отправки админу ${adminId}:`,

                    error.message
                );
            }
        }

    } catch (error) {

        console.error(
            "RECEIPT ERROR:",
            error
        );
    }
}

// ============================================================
// PHOTO
// ============================================================

bot.on(
    "photo",
    handleReceipt
);

// ============================================================
// DOCUMENT
// ============================================================

bot.on(
    "document",
    handleReceipt
);

// ============================================================
// POLLING ERROR
// ============================================================

bot.on(
    "polling_error",
    error => {

        console.error(
            "❌ TELEGRAM POLLING ERROR:",
            error.message
        );
    }
);

// ============================================================
// UNCAUGHT ERRORS
// ============================================================

process.on(
    "uncaughtException",
    error => {

        console.error(
            "❌ UNCAUGHT EXCEPTION:",
            error
        );
    }
);

process.on(
    "unhandledRejection",
    error => {

        console.error(
            "❌ UNHANDLED REJECTION:",
            error
        );
    }
);

// ============================================================
// LOG
// ============================================================

console.log(
    "=========================================="
);

console.log(
    "🤖 J.A.R.B.I.S БОТ ЗАПУЩЕН"
);

console.log(
    "👨‍💼 ADMIN 1:",
    ADMIN_IDS[0]
);

console.log(
    "👨‍💼 ADMIN 2:",
    ADMIN_IDS[1]
);

console.log(
    "🛠 SUPPORT APP:",
    SUPPORT_APP
);

console.log(
    "🛠 SUPPORT BOT:",
    SUPPORT_BOT
);

console.log(
    "💾 DATABASE:",
    DB_FILE
);

console.log(
    "🟢 ONLINE ADMINS:",
    getOnlineAdminsCount()
);

console.log(
    "🤖 AI KEY:",
    AI_API_KEY ? "задан" : "НЕ задан"
);

console.log(
    "💳 CARD:",
    CARD_NUMBER
);

console.log(
    "=========================================="
);
