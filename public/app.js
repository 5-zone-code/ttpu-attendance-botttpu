/* TTPU Attendance — barcha sahifalar uchun umumiy kod (Telegram, til, mavzu, API, oynalar) */

/* ---------- Telegram ---------- */
const tg = window.Telegram?.WebApp;
if (tg) {
    tg.ready();
    tg.expand();
    try { if (tg.isVersionAtLeast && tg.isVersionAtLeast('8.0') && tg.requestFullscreen) tg.requestFullscreen(); } catch (e) {}
    try { if (tg.disableVerticalSwipes) tg.disableVerticalSwipes(); } catch (e) {}
}
const INIT_DATA = tg?.initData || '';

const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
};
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const haptic = (kind) => { try { kind === 'select' ? tg?.HapticFeedback?.selectionChanged() : tg?.HapticFeedback?.notificationOccurred(kind); } catch (e) {} };

/* ---------- Tillar ---------- */
const languages = [
    { code: 'uz', icon: 'https://flagcdn.com/w80/uz.png' },
    { code: 'ru', icon: 'https://flagcdn.com/w80/ru.png' },
    { code: 'en', icon: 'https://flagcdn.com/w80/us.png' },
];
const I18N = {
    uz: {
        loading: "Yuklanmoqda...", deniedTitle: "Kirish taqiqlangan",
        deniedText: "Bu ilova faqat ro'yxatdagi TTPU foydalanuvchilari uchun. ID raqamingizni administratorga yuboring.",
        openInTelegram: "Ilovani Telegram bot orqali oching.",
        lblGroup: "Guruh", week: "Hafta", today: "Bugun", noLessons: "Jadval topilmadi",
        ttError: "Jadvalni yuklab bo'lmadi. Keyinroq urinib ko'ring.",
        settingsTitle: "Sozlamalar", settingsSub: "Ilova ko'rinishi va parametrlari",
        darkModeTitle: "Tungi rejim (Dark Mode)", darkModeSub: "Mavzuni o'zgartirish",
        langTitle: "Til", langName: "O'zbekcha",
        serverError: "Server xatosi. Keyinroq urinib ko'ring.", netError: "Internet aloqasi yo'q.",
        cancel: "Bekor qilish", save: "Saqlash", close: "Yopish", yes: "Ha", no: "Yo'q", confirm: "Tasdiqlash",
        done: "Tayyor", add: "Qo'shish", del: "O'chirish", search: "Qidirish...", nothingFound: "Hech narsa topilmadi",
        chooseGroup: "Guruhni tanlang", noGroups: "Sizga biriktirilgan guruh topilmadi",
        tasksTitle: "Vazifalar", noTasks: "Hozircha vazifa yo'q", openFile: "Faylni ochish",
        active: "Faol", completed: "Yakunlangan", completedTasks: "Yakunlangan vazifalar",
        days: ["Dushanba", "Seshanba", "Chorshanba", "Payshanba", "Juma", "Shanba", "Yakshanba"],
        err_not_your_group: "Bu guruh sizga biriktirilmagan.", err_file_too_big: "Fayl juda katta.",
        err_description_required: "Izoh yozing.", err_user_exists: "Bu ID allaqachon ro'yxatda.",
        err_group_not_found: "Guruh topilmadi.", err_bad_id: "Telegram ID noto'g'ri (faqat raqam).",
        err_bad_name: "Ism familiyani to'liq yozing.", err_owner_only: "Buni faqat Ega qila oladi.",
        err_not_in_edupage: "Bunday guruh EduPage jadvalida yo'q.", err_group_exists: "Bu guruh allaqachon ochilgan.",
        err_group_not_empty: "Guruhda o'quvchilar bor — avval ularni o'chiring.", err_bad_teacher: "EduPage dagi ustozni tanlang.",
        err_subjects_required: "Kamida bitta fan tanlang.", err_bad_subject: "Fan EduPage jadvalida yo'q.",
        err_cannot_delete_owner: "Egani o'chirib bo'lmaydi.", err_cannot_delete_self: "O'zingizni o'chira olmaysiz.",
        err_timetable_unavailable: "EduPage jadvali hozir ochilmayapti.", err_bad_max: "O'quvchilar sonini to'g'ri kiriting.",
        err_session_not_found: "Dars topilmadi.", err_upload_failed: "Faylni yuklab bo'lmadi.",
        err_wrong_role: "Bu sahifa sizning rolingiz uchun emas.",
        err_starosta_only: "Bu bo'lim faqat starosta uchun.", err_students_only: "Faqat o'quvchini starosta qilish mumkin.",
    },
    ru: {
        loading: "Загрузка...", deniedTitle: "Доступ запрещён",
        deniedText: "Приложение только для пользователей TTPU из списка. Отправьте ваш ID администратору.",
        openInTelegram: "Откройте приложение через Telegram-бота.",
        lblGroup: "Группа", week: "Неделя", today: "Сегодня", noLessons: "Расписание не найдено",
        ttError: "Не удалось загрузить расписание. Попробуйте позже.",
        settingsTitle: "Настройки", settingsSub: "Внешний вид и параметры приложения",
        darkModeTitle: "Тёмная тема (Dark Mode)", darkModeSub: "Переключить интерфейс",
        langTitle: "Язык", langName: "Русский",
        serverError: "Ошибка сервера. Попробуйте позже.", netError: "Нет подключения к интернету.",
        cancel: "Отмена", save: "Сохранить", close: "Закрыть", yes: "Да", no: "Нет", confirm: "Подтвердить",
        done: "Готово", add: "Добавить", del: "Удалить", search: "Поиск...", nothingFound: "Ничего не найдено",
        chooseGroup: "Выберите группу", noGroups: "За вами не закреплено ни одной группы",
        tasksTitle: "Задания", noTasks: "Заданий пока нет", openFile: "Открыть файл",
        active: "Активно", completed: "Завершено", completedTasks: "Завершённые задания",
        days: ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
        err_not_your_group: "Эта группа не закреплена за вами.", err_file_too_big: "Файл слишком большой.",
        err_description_required: "Напишите описание.", err_user_exists: "Этот ID уже в списке.",
        err_group_not_found: "Группа не найдена.", err_bad_id: "Неверный Telegram ID (только цифры).",
        err_bad_name: "Введите полное имя.", err_owner_only: "Это может сделать только Владелец.",
        err_not_in_edupage: "Такой группы нет в расписании EduPage.", err_group_exists: "Эта группа уже открыта.",
        err_group_not_empty: "В группе есть студенты — сначала удалите их.", err_bad_teacher: "Выберите преподавателя из EduPage.",
        err_subjects_required: "Выберите хотя бы один предмет.", err_bad_subject: "Предмета нет в расписании EduPage.",
        err_cannot_delete_owner: "Владельца удалить нельзя.", err_cannot_delete_self: "Нельзя удалить себя.",
        err_timetable_unavailable: "Расписание EduPage сейчас недоступно.", err_bad_max: "Введите корректное число студентов.",
        err_session_not_found: "Занятие не найдено.", err_upload_failed: "Не удалось загрузить файл.",
        err_wrong_role: "Эта страница не для вашей роли.",
        err_starosta_only: "Этот раздел только для старосты.", err_students_only: "Старостой можно назначить только студента.",
    },
    en: {
        loading: "Loading...", deniedTitle: "Access denied",
        deniedText: "This app is only for registered TTPU users. Send your ID to the administrator.",
        openInTelegram: "Please open the app from the Telegram bot.",
        lblGroup: "Group", week: "Week", today: "Today", noLessons: "No timetable found",
        ttError: "Couldn't load the timetable. Try again later.",
        settingsTitle: "Settings", settingsSub: "App appearance and preferences",
        darkModeTitle: "Dark Mode", darkModeSub: "Toggle app theme",
        langTitle: "Language", langName: "English",
        serverError: "Server error. Try again later.", netError: "No internet connection.",
        cancel: "Cancel", save: "Save", close: "Close", yes: "Yes", no: "No", confirm: "Confirm",
        done: "Done", add: "Add", del: "Delete", search: "Search...", nothingFound: "Nothing found",
        chooseGroup: "Choose a group", noGroups: "No groups are assigned to you",
        tasksTitle: "Tasks", noTasks: "No tasks yet", openFile: "Open file",
        active: "Active", completed: "Completed", completedTasks: "Completed tasks",
        days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
        err_not_your_group: "This group is not assigned to you.", err_file_too_big: "File is too large.",
        err_description_required: "Please write a description.", err_user_exists: "This ID is already registered.",
        err_group_not_found: "Group not found.", err_bad_id: "Invalid Telegram ID (digits only).",
        err_bad_name: "Enter the full name.", err_owner_only: "Only the Owner can do this.",
        err_not_in_edupage: "This group is not in the EduPage timetable.", err_group_exists: "This group already exists.",
        err_group_not_empty: "The group has students — remove them first.", err_bad_teacher: "Choose the teacher from EduPage.",
        err_subjects_required: "Choose at least one subject.", err_bad_subject: "Subject is not in the EduPage timetable.",
        err_cannot_delete_owner: "The Owner can't be deleted.", err_cannot_delete_self: "You can't delete yourself.",
        err_timetable_unavailable: "EduPage timetable is unavailable right now.", err_bad_max: "Enter a valid number of students.",
        err_session_not_found: "Class session not found.", err_upload_failed: "Couldn't upload the file.",
        err_wrong_role: "This page is not for your role.",
        err_starosta_only: "This section is for the group leader only.", err_students_only: "Only a student can be a group leader.",
    },
};
function addI18n(dict) { for (const l in dict) Object.assign(I18N[l], dict[l]); }
// v4: ro'yxatdan o'tish (umumiy xatolar)
addI18n({
    uz: {
        regRejected: "Ro'yxatdan o'tish arizangiz rad etilgan. Xato bo'lsa, starosta yoki administratorga murojaat qiling.",
        err_registration_closed: "Ro'yxatdan o'tish yopiq. Administratorga murojaat qiling.",
        err_already_registered: "Siz allaqachon ro'yxatdasiz.", err_blocked: "Hisobingiz bloklangan.",
        err_rejected: "Arizangiz rad etilgan.", err_registration_not_found: "Ariza topilmadi.",
    },
    ru: {
        regRejected: "Ваша заявка на регистрацию отклонена. Если это ошибка, обратитесь к старосте или администратору.",
        err_registration_closed: "Регистрация закрыта. Обратитесь к администратору.",
        err_already_registered: "Вы уже зарегистрированы.", err_blocked: "Ваш аккаунт заблокирован.",
        err_rejected: "Ваша заявка отклонена.", err_registration_not_found: "Заявка не найдена.",
        err_bad_name: "Введите имя и фамилию полностью.",
    },
    en: {
        regRejected: "Your registration request was rejected. If this is a mistake, contact your class monitor or an administrator.",
        err_registration_closed: "Registration is closed. Contact an administrator.",
        err_already_registered: "You are already registered.", err_blocked: "Your account is blocked.",
        err_rejected: "Your request was rejected.", err_registration_not_found: "Request not found.",
    },
});

let currentLangIdx = 0;
let lang = 'uz';
const langHooks = [];
function t(key, vars) {
    let s = I18N[lang]?.[key] ?? I18N.uz[key] ?? key;
    if (vars && typeof s === 'string') for (const k in vars) s = s.split('{' + k + '}').join(vars[k]);
    return s;
}
function errMsg(r) {
    if (!r) return t('serverError');
    if (r.error === 'network') return t('netError');
    const k = 'err_' + r.error;
    return I18N[lang]?.[k] || I18N.uz[k] || t('serverError');
}
function applyLanguage(code) {
    lang = I18N[code] ? code : 'uz';
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.innerText = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    const btn = $('langBtn');
    if (btn) btn.innerHTML = `<img src="${languages[currentLangIdx].icon}" alt="${lang}" />`;
    document.documentElement.lang = lang;
    langHooks.forEach((fn) => { try { fn(); } catch (e) { console.error(e); } });
}
function rotateLanguage() {
    currentLangIdx = (currentLangIdx + 1) % languages.length;
    store.set('app_lang', languages[currentLangIdx].code);
    applyLanguage(languages[currentLangIdx].code);
}
function initLang() {
    const saved = store.get('app_lang') || 'uz';
    currentLangIdx = Math.max(0, languages.findIndex((l) => l.code === saved));
    applyLanguage(languages[currentLangIdx].code);
}

/* ---------- Mavzu ---------- */
function toggleTheme() {
    const isDark = $('themeToggle').checked;
    document.body.classList.toggle('dark-mode', isDark);
    store.set('theme', isDark ? 'dark' : 'light');
    try { tg?.setHeaderColor?.(isDark ? '#0b1329' : '#f0f3f8'); tg?.setBackgroundColor?.(isDark ? '#0b1329' : '#f0f3f8'); } catch (e) {}
}
function initTheme() {
    const saved = store.get('theme');
    const dark = saved ? saved === 'dark' : true;
    if ($('themeToggle')) $('themeToggle').checked = dark;
    document.body.classList.toggle('dark-mode', dark);
}

/* ---------- API ---------- */
async function api(path, opts = {}) {
    let r;
    try {
        r = await fetch(path, {
            method: opts.method || (opts.body ? 'POST' : 'GET'),
            headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': INIT_DATA },
            body: opts.body ? JSON.stringify(opts.body) : undefined,
        });
    } catch (e) {
        return { ok: false, error: 'network' };
    }
    let j = {};
    try { j = await r.json(); } catch (e) { j = { ok: false, error: 'server_error' }; }
    j.status = r.status;
    return j;
}

/* ---------- Yordamchilar ---------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function locale() { return lang === 'en' ? 'en-GB' : lang === 'ru' ? 'ru-RU' : 'uz-UZ'; }
function fmtDate(iso) { return new Date(iso).toLocaleDateString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Asia/Tashkent' }); }
function fmtTime(iso) { return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tashkent' }); }
function fmtSize(b) { b = Number(b) || 0; return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; }
function tashkentNow() {
    const d = new Date(Date.now() + 5 * 3600 * 1000);
    return { day: (d.getUTCDay() + 6) % 7, mins: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
function loadScript(src) {
    return new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = src; s.onload = res; s.onerror = () => rej(new Error('script'));
        document.head.appendChild(s);
    });
}
function fileIcon(name) {
    const ext = (/\.([a-z0-9]+)$/i.exec(name || '') || [, ''])[1].toLowerCase();
    if (ext === 'pdf') return 'fa-file-pdf';
    if (['doc', 'docx'].includes(ext)) return 'fa-file-word';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return 'fa-file-excel';
    if (['ppt', 'pptx'].includes(ext)) return 'fa-file-powerpoint';
    if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext)) return 'fa-file-image';
    if (['zip', 'rar', '7z'].includes(ext)) return 'fa-file-zipper';
    return 'fa-file-lines';
}

/* ---------- Ekranlar ---------- */
function showOnly(id) {
    document.querySelectorAll('.center-screen, .screen-view').forEach((el) => el.classList.remove('active'));
    $(id).classList.add('active');
}
function enterMain(screenId) {
    showOnly(screenId);
    $('mainNav').classList.add('active');
    document.body.classList.add('in-student-mode');
}
function switchTab(tabName, el) {
    document.querySelectorAll('.tab-content').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('#mainNav .nav-link').forEach((link) => link.classList.remove('active'));
    $('tab-' + tabName).classList.add('active');
    const navEl = el || document.querySelector(`#mainNav .nav-link[data-tab="${tabName}"]`);
    if (navEl) navEl.classList.add('active');
    window.scrollTo(0, 0);
    haptic('select');
    if (window.onTab) window.onTab(tabName);
}

/** /api/me — ro'yxatda bo'lmasa rad ekrani; boshqa rol bo'lsa to'g'ri sahifaga yo'naltiradi */
async function bootAuth(expectedRoles) {
    if (!INIT_DATA) {
        showOnly('denied-screen');
        $('deniedText').innerText = t('openInTelegram');
        return null;
    }
    const r = await api('/api/me');
    // Ro'yxatda yo'q, lekin o'zi ro'yxatdan o'tishi mumkin -> o'quvchi sahifasidagi forma
    if (!r.ok && r.error === 'not_allowed' && r.reg && r.reg.mode !== 'off' && r.reg.status !== 'rejected') {
        if (window.onNotRegistered) { window.onNotRegistered(r.reg); return null; }
        location.replace('/');
        return null;
    }
    if (!r.ok) {
        if (r.reg && r.reg.status === 'rejected') { $('deniedText').dataset.i18n = 'regRejected'; $('deniedText').innerText = t('regRejected'); }
        showOnly('denied-screen');
        const uid = tg?.initDataUnsafe?.user?.id;
        $('deniedId').innerText = uid ? 'ID: ' + uid : '';
        if (r.error === 'network') $('deniedText').innerText = t('netError');
        else if (r.error !== 'not_allowed' && r.error !== 'unauthorized') $('deniedText').innerText = t('serverError');
        return null;
    }
    if (!expectedRoles.includes(r.user.role)) {
        location.replace(r.page + location.hash);
        return null;
    }
    return r;
}

/* ---------- Oynalar ---------- */
function showCustomAlert(text) {
    $('customAlertText').innerText = text;
    $('customAlertModal').classList.add('active');
}
function closeCustomAlert() { $('customAlertModal').classList.remove('active'); }

let toastTimer = null;
function toast(text, kind = '') {
    let el = $('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.className = 'toast ' + kind;
    el.innerText = text;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

/** Pastdan chiqadigan oyna. html — ichki kontent. {close, el} qaytaradi. */
function openSheet(title, html, { onClose, z = 2050 } = {}) {
    const ov = document.createElement('div');
    ov.className = 'modal-overlay sheet-overlay active';
    ov.style.zIndex = z;
    ov.innerHTML = `<div class="sheet"><div class="sheet-head"><h3>${esc(title)}</h3><button class="sheet-close" aria-label="close"><i class="fa-solid fa-xmark"></i></button></div><div class="sheet-body">${html}</div></div>`;
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        ov.remove();
        if (onClose) onClose();
    };
    ov.addEventListener('click', (e) => { if (e.target === ov) close(); });
    ov.querySelector('.sheet-close').onclick = close;
    document.body.appendChild(ov);
    return { el: ov.querySelector('.sheet-body'), close, root: ov };
}

/** Variantlardan birini tanlash. options: [{value, label, sub, icon}] */
function pick(title, options, { searchable = false } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const s = openSheet(title, `${searchable ? `<div class="field search"><i class="fa-solid fa-magnifying-glass"></i><input type="text" placeholder="${esc(t('search'))}"></div>` : ''}<div class="option-list"></div>`, {
            onClose: () => { if (!done) resolve(null); },
            z: 2080,
        });
        const list = s.el.querySelector('.option-list');
        const render = (q = '') => {
            const qq = q.trim().toLowerCase();
            const items = options.filter((o) => !qq || (o.label + ' ' + (o.sub || '')).toLowerCase().includes(qq)).slice(0, 200);
            list.innerHTML = items.length
                ? items.map((o, i) => `<div class="option" data-i="${options.indexOf(o)}">${o.icon ? `<div class="ic"><i class="fa-solid ${o.icon}"></i></div>` : ''}<div><h4>${esc(o.label)}</h4>${o.sub ? `<p>${esc(o.sub)}</p>` : ''}</div></div>`).join('')
                : `<div class="empty">${esc(t('nothingFound'))}</div>`;
            list.querySelectorAll('.option').forEach((el) => {
                el.onclick = () => { done = true; haptic('select'); s.close(); resolve(options[Number(el.dataset.i)].value); };
            });
        };
        render();
        const inp = s.el.querySelector('input');
        if (inp) inp.oninput = () => render(inp.value);
    });
}

function confirmBox(text, { danger = false } = {}) {
    return new Promise((resolve) => {
        let done = false;
        const s = openSheet(t('confirm'), `<p style="font-size:15px; line-height:1.5; margin-bottom:18px;">${esc(text)}</p>
            <button class="btn-primary" style="margin-top:0;${danger ? 'background:#ef4444;' : ''}" data-yes>${esc(t('yes'))}</button>
            <button class="btn-ghost" data-no>${esc(t('cancel'))}</button>`, { onClose: () => { if (!done) resolve(false); }, z: 2090 });
        s.el.querySelector('[data-yes]').onclick = () => { done = true; s.close(); resolve(true); };
        s.el.querySelector('[data-no]').onclick = () => { done = true; s.close(); resolve(false); };
    });
}

/* ---------- Dars jadvali (talaba va ustoz uchun umumiy) ---------- */
function renderLessons(container, r, { showNow } = {}) {
    if (!r || !r.lessons || !r.lessons.length) {
        container.innerHTML = `<div class="muted-box">${esc(t('noLessons'))}</div>`;
        if (showNow) showNow(null);
        return;
    }
    const now = tashkentNow();
    const byDay = {};
    r.lessons.forEach((l) => { (byDay[l.day] = byDay[l.day] || []).push(l); });
    const shortDays = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
    let current = null;
    container.innerHTML = Object.keys(byDay).map(Number).sort((a, b) => a - b).map((day) => {
        const isToday = day === now.day;
        const items = byDay[day].map((l) => {
            const isNow = isToday && now.mins >= toMin(l.start) && now.mins <= toMin(l.end);
            if (isNow) current = l;
            const meta = [l.teacher, l.room, l.group].filter(Boolean).map(esc).join(' • ');
            return `<div class="lesson-item${isNow ? ' now' : ''}"><div class="lesson-info"><h4>${esc(l.subject)}</h4><p>${meta}</p></div><div class="lesson-time">${esc(l.start)} - ${esc(l.end)}</div></div>`;
        }).join('');
        return `<div class="timetable-day"><div class="day-title"><i class="fa-regular fa-calendar"></i> ${esc(t('days')[day])} (${shortDays[day]})${isToday ? ` <span class="today-badge">${esc(t('today'))}</span>` : ''}</div>${items}</div>`;
    }).join('');
    if (showNow) showNow(current);
}

function lessonItemHtml(l) {
    const meta = [l.teacher, l.room, l.group].filter(Boolean).map(esc).join(' • ');
    return `<div class="lesson-item" style="margin:0;"><div class="lesson-info"><h4>${esc(l.subject)}</h4><p>${meta}</p></div><div class="lesson-time">${esc(l.start)} - ${esc(l.end)}</div></div>`;
}

/* ---------- Vazifa kartasi (talaba va ustoz) ---------- */
function taskCardHtml(tk, { teacherView = false } = {}) {
    const done = tk.status === 'done';
    const meta = teacherView
        ? `${esc(tk.group)} • ${fmtDate(tk.createdAt)}`
        : `${esc(tk.teacher || '')} • ${fmtDate(tk.createdAt)}`;
    return `<div class="task-card${done ? ' done' : ''}" data-id="${esc(tk.id)}">
        <div class="task-top"><div><h4>${esc(tk.subject)}</h4><div class="task-meta">${meta}</div></div>
        <span class="badge ${done ? 'gray' : 'green'}">${esc(t(done ? 'completed' : 'active'))}</span></div>
        <div class="task-desc">${esc(tk.description)}</div>
        ${tk.file ? `<div class="task-file" data-file="${esc(tk.id)}"><i class="fa-solid ${fileIcon(tk.file.name)}"></i><span>${esc(tk.file.name)}</span><small style="margin-left:auto;color:var(--text-sub);white-space:nowrap;">${fmtSize(tk.file.size)}</small></div>` : ''}
        ${teacherView ? `<div style="display:flex; gap:8px; justify-content:flex-end;">
            ${!done ? `<button class="btn-small success" data-complete="${esc(tk.id)}"><i class="fa-solid fa-check"></i> ${esc(t('finishTask'))}</button>` : ''}
            <button class="btn-small danger" data-delete="${esc(tk.id)}"><i class="fa-solid fa-trash"></i></button></div>` : ''}
    </div>`;
}

async function openTaskFile(id) {
    const r = await api('/api/tasks?action=file&id=' + encodeURIComponent(id));
    if (!r.ok) return toast(errMsg(r), 'error');
    // Brauzerda ochiladi: PDF/rasm ko'rinadi, boshqa turlar yuklab olinadi
    try { if (tg?.openLink) return tg.openLink(r.url); } catch (e) {}
    window.open(r.url, '_blank');
}
