(function () {
'use strict';
var API_URL = window.APP_API_URL || '';
var CFG = {};
var S = { token: '', me: null, lists: null, form: {}, cache: {} };
try { S.token = sessionStorage.getItem('tk') || ''; } catch (e) {}
var $app = document.getElementById('app');
var WRITE = { 'notifications.read':1,'assignments.accept':1,'executions.start':1,'executions.complete':1,'files.upload':1,'route-exceptions.create':1,
  'route-exceptions.decide':1,'quality-checks.create':1,'incidents.create':1,'incidents.act':1,'dispositions.create':1,'dispositions.decide':1,
  'dispositions.withdraw':1,'plans.create':1,'plans.add-items':1,'plans.remove-item':1,'plans.submit':1,'plans.decide':1,'plans.cancel':1,'plans.publish':1,
  'assign.route':1,'assign.single':1,'assign.cancel':1,'assign.close':1,'admin.import':1,'admin.generate':1 };

// ---------- tiện ích ----------
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'k' + Date.now() + Math.random().toString(16).slice(2); }
function $(id) { return document.getElementById(id); }
function val(id) { var e = $(id); return e ? e.value.trim() : ''; }
function vnDate(iso) { if (!iso) return ''; var d = new Date(new Date(iso).getTime() + 7 * 3600000); return d.toISOString().slice(0, 10); }
function vnTime(iso) { if (!iso) return ''; var d = new Date(new Date(iso).getTime() + 7 * 3600000).toISOString(); return d.slice(11, 16) + ' ' + d.slice(8, 10) + '/' + d.slice(5, 7); }
function dmy(s) { return s ? s.slice(8, 10) + '/' + s.slice(5, 7) + '/' + s.slice(0, 4) : ''; }
function today() { return vnDate(new Date().toISOString()); }
function vnFull(iso) { if (!iso) return ''; var d = new Date(new Date(iso).getTime() + 7 * 3600000).toISOString(); return d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) + ' ' + d.slice(11, 19); }
function dur(sec) { sec = Number(sec) || 0; var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), x = sec % 60; return (h ? h + ' giờ ' : '') + m + ' phút ' + x + ' giây'; }
function mapLink(lat, lng, acc) { if (lat === '' || lat === null || lat === undefined) return ''; return '<a href="https://www.google.com/maps?q=' + encodeURIComponent(lat + ',' + lng) + '" target="_blank" rel="noopener">' + esc(Number(lat).toFixed(5) + ', ' + Number(lng).toFixed(5)) + '</a>' + (acc ? ' (±' + esc(acc) + ' m)' : ''); }
// V1.2: bộ chọn kỳ dùng chung (tháng, quý, năm, toàn bộ thời gian)
function periodPicker(per, ref, act) {
  return '<div class="row"><select id="dPer" aria-label="Kỳ" style="width:auto" data-change="perChange"><option value="month"' + (per === 'month' ? ' selected' : '') + '>Tháng</option><option value="quarter"' + (per === 'quarter' ? ' selected' : '') + '>Quý</option><option value="year"' + (per === 'year' ? ' selected' : '') + '>Năm</option><option value="all"' + (per === 'all' ? ' selected' : '') + '>Toàn bộ thời gian</option></select>' +
    '<input id="dRef" type="month" value="' + esc(ref) + '" aria-label="Tháng tham chiếu" style="width:auto"' + (per === 'all' ? ' hidden' : '') + '><button class="btn" data-act="' + act + '">Xem</button></div>';
}
function perVal() { var p = val('dPer') || 'month'; return [p, p === 'all' ? today().slice(0, 7) : (val('dRef') || today().slice(0, 7))]; }
function toast(msg, kind) { var t = $('toast'); t.textContent = msg; t.className = 'toast ' + (kind || 'info'); t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(function () { t.hidden = true; }, 5000); }
function load(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { toast('Bộ nhớ thiết bị đầy, không lưu được dữ liệu chờ gửi.', 'err'); return false; } }

function api(action, payload, opts) {
  opts = opts || {};
  if (!navigator.onLine && action !== 'public.config') return Promise.reject({ code: 'NETWORK', network: true, message: 'Mất kết nối.' });
  var req = { action: action, token: S.token, payload: payload || {}, idempotency_key: opts.key || (WRITE[action] ? uid() : '') };
  var netErr = function (m) { return { code: 'NETWORK', network: true, message: m || 'Không kết nối được máy chủ.' }; };
  // text/plain: yêu cầu đơn giản, trình duyệt không gửi yêu cầu kiểm tra trước (CR-01 Mục 5.2)
  return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(req), redirect: 'follow' })
    .then(function (res) {
      if (!res.ok) throw netErr('Máy chủ trả lỗi ' + res.status + '.');
      return res.json().catch(function () { throw netErr('Máy chủ trả dữ liệu không đọc được.'); });
    }, function () { throw netErr(); })
    .then(function (r) {
      if (r && r.success) return r.data;
      var e = (r && r.error) || { code: 'INTERNAL', message: 'Lỗi không xác định.' };
      if (e.code === 'AUTH' || e.code === 'LOCKED') { logout(e.message); }
      throw e;
    });
}
function fail(e) { toast(e && e.message ? e.message : 'Có lỗi xảy ra.', 'err'); }

// ---------- hàng chờ khi mất mạng (QĐ-07) ----------
var Q = load('queue', []);
var syncing = false;
function saveQ() { var r = save('queue', Q); renderNet(); return r; }
function enqueue(item) { item.key = item.key || uid(); item.status = 'PENDING'; item.created = new Date().toISOString(); Q.push(item); return saveQ(); }
function queuedFor(pid) { return Q.filter(function (q) { return q.point_id === pid; }); }
function syncQueue() {
  if (syncing || !navigator.onLine || !S.token || !Q.some(function (q) { return q.status === 'PENDING'; })) return Promise.resolve();
  syncing = true;
  var sent = 0;
  var run = function (i) {
    if (i >= Q.length) return Promise.resolve();
    var it = Q[i];
    if (it.status !== 'PENDING') return run(i + 1);
    var steps = Promise.resolve();
    Object.keys(it.photos || {}).forEach(function (field) {
      steps = steps.then(function () {
        if (it.payload[field] || !it.photos[field]) return;
        return api('files.upload', { data_base64: it.photos[field], mime_type: 'image/jpeg', evidence_type: field }, { key: it.key + '-' + field })
          .then(function (r) { it.payload[field] = r.attachment_id; delete it.photos[field]; saveQ(); });
      });
    });
    return steps.then(function () { return api(it.action, it.payload, { key: it.key }); })
      .then(function () { Q.splice(i, 1); saveQ(); sent++; return run(i); })
      .catch(function (e) { if (e.network) return Promise.reject(e); it.status = 'ERROR'; it.error = e.message; saveQ(); return run(i + 1); });
  };
  return run(0).catch(function () {}).then(function () {
    syncing = false;
    if (sent) { toast('Đã gửi ' + sent + ' thao tác chờ. Máy chủ đã ghi nhận.', 'ok'); route(); }
  });
}
function renderNet() {
  var n = $('net'), pend = Q.filter(function (q) { return q.status === 'PENDING'; }).length, err = Q.filter(function (q) { return q.status === 'ERROR'; }).length;
  if (!navigator.onLine) { n.className = 'chip chip-off'; n.textContent = 'Mất kết nối' + (pend ? ' · ' + pend + ' chờ gửi' : ''); }
  else { n.className = 'chip chip-ok'; n.textContent = pend ? 'Đang gửi ' + pend : err ? err + ' cần xử lý' : 'Trực tuyến'; if (err) n.className = 'chip c-amber'; }
}
window.addEventListener('online', function () { renderNet(); syncQueue(); });
window.addEventListener('offline', renderNet);
setInterval(syncQueue, 30000);

// ---------- ảnh, GPS ----------
function readPhoto(file) {
  return new Promise(function (res, rej) {
    var img = new Image(), url = URL.createObjectURL(file);
    img.onload = function () {
      var m = 1600, s = Math.min(1, m / Math.max(img.width, img.height)), c = document.createElement('canvas');
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url);
      res(c.toDataURL('image/jpeg', 0.7).split(',')[1]);
    };
    img.onerror = function () { rej(new Error('Không đọc được ảnh')); }; img.src = url;
  });
}
function getGps() {
  return new Promise(function (res) {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(function (p) { res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy) }); },
      function () { res(null); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
function loadPhoto(id, imgId) { if (!id) return; if (S.cache['p' + id]) { var e = $(imgId); if (e) e.src = S.cache['p' + id]; return; }
  api('files.get', { attachment_id: id }).then(function (r) { S.cache['p' + id] = r.data_url; var e = $(imgId); if (e) e.src = r.data_url; }).catch(function () {}); }

// ---------- đăng nhập ----------
function logout(msg) { try { sessionStorage.removeItem('tk'); } catch (e) {} S.token = ''; S.me = null; showLogin(msg); }
function showLogin(msg) {
  $('nav').hidden = true; $('menuBtn').hidden = true; $('bellBtn').hidden = true;
  var dev = CFG.authMode === 'DEV';
  $('devbar').hidden = !dev;
  $app.innerHTML = '<div class="login card"><h1>Đăng nhập</h1><p class="sub">Dùng tài khoản Google đã đăng ký với hệ thống.</p>' +
    (msg ? '<div class="banner c-red">' + esc(msg) + '</div>' : '') +
    (dev ? '<div class="field"><label for="devEmail">Gmail (môi trường thử)</label><input id="devEmail" type="email" autocomplete="email"></div><button class="btn big" data-act="devLogin">ĐĂNG NHẬP</button>'
      : '<div id="gisBtn" style="min-height:48px"></div><p class="small muted">Không thấy nút đăng nhập: quản trị kiểm tra nguồn được phép (Authorized JavaScript origins) có địa chỉ <b>' + esc(location.origin) + '</b>.</p>') +
    '<p class="small muted">Phiên bản ' + esc(CFG.version) + '</p></div>';
  if (!dev) {
    if (!CFG.clientId) { $('gisBtn').innerHTML = '<div class="banner c-red">Chưa cấu hình GIS_CLIENT_ID.</div>'; return; }
    var go = function () {
      google.accounts.id.initialize({ client_id: CFG.clientId, callback: function (r) { doLogin({ id_token: r.credential }); } });
      google.accounts.id.renderButton($('gisBtn'), { theme: 'filled_blue', size: 'large', text: 'signin_with', locale: 'vi' });
    };
    if (window.google && google.accounts) go();
    else { var sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.onload = go; sc.onerror = function () { $('gisBtn').innerHTML = '<div class="banner c-red">Không tải được dịch vụ đăng nhập Google.</div>'; }; document.head.appendChild(sc); }
  }
}
function doLogin(p) {
  api('auth.login', p).then(function (r) { S.token = r.token; try { sessionStorage.setItem('tk', r.token); } catch (e) {} S.me = r.me; boot(); }).catch(fail);
}

// ---------- khung ----------
function navItems() {
  var m = S.me, a = {}; (m.authority || []).forEach(function (x) { a[x] = 1; });
  var roles = {}; (m.roles || []).forEach(function (x) { roles[x] = 1; });
  var it = [];
  if (roles.WORKER || roles.TEAM_LEAD) it.push(['nhiem-vu', 'Nhiệm vụ của tôi']);
  if (m.is_manager) { it.push(['sep', 'QUẢN LÝ TRẠM']); it.push(['dashboard', 'Dashboard Trạm']); it.push(['ca-nhan', 'Dashboard cá nhân']); it.push(['ke-hoach', 'Kế hoạch']); it.push(['giao-viec', 'Giao việc']); it.push(['lan-den-han', 'Lần đến hạn']); it.push(['nhan-su', 'Nhân sự']); }
  // V1.2.2 (CR-03): Quản trị xem được mọi hàng chờ; nút quyết định theo thẩm quyền
  if (a.QUALITY_CHECK || m.is_admin) it.push(['xac-nhan', 'Chờ xác nhận']);
  if (a.PLAN_APPROVE || a.ROUTE_EXCEPTION || a.OCC_DISPOSITION || m.is_admin) it.push(['duyet', 'Chờ duyệt']);
  it.push(['sep', 'CHUNG']); it.push(['su-co', 'Sự cố']); it.push(['thong-bao', 'Thông báo']);
  if (m.is_admin) it.push(['quan-tri', 'Quản trị']);
  return it;
}
function renderNav() {
  var cur = (location.hash.slice(2) || '').split('/')[0];
  $('nav').innerHTML = navItems().map(function (x) { return x[0] === 'sep' ? '<div class="sep">' + x[1] + '</div>' : '<a href="#/' + x[0] + '" class="' + (cur === x[0] ? 'on' : '') + '">' + x[1] + '</a>'; }).join('') +
    '<div class="sep">TÀI KHOẢN</div><div class="small muted" style="padding:0 12px">' + esc(S.me.full_name) + '<br>' + esc(S.me.email) + '</div><a href="#" data-act="logout">Đăng xuất</a>';
}
function boot() {
  $('devbar').hidden = CFG.authMode !== 'DEV';
  var p = S.me ? Promise.resolve(S.me) : api('me');
  p.then(function (me) {
    S.me = me; $('stationName').textContent = (me.in_station === false ? '' : me.don_vi_name) || (me.is_admin ? 'Quản trị' : 'Quản lý tài sản');
    $('nav').hidden = false; $('menuBtn').hidden = false; $('bellBtn').hidden = false;
    if (window.innerWidth <= 800) $('nav').classList.add('closed');
    return api('lists.get');
  }).then(function (l) { S.lists = l; route(); refreshBell(); syncQueue(); }).catch(function (e) { if (e.code !== 'AUTH') fail(e); });
}
function refreshBell() { api('notifications.list').then(function (ns) { var n = ns.filter(function (x) { return !x.read_at; }).length; $('bellCount').hidden = !n; $('bellCount').textContent = n; }).catch(function () {}); }
setInterval(function () { if (S.token && navigator.onLine) refreshBell(); }, 120000);

var ROUTES = {};
function route() {
  if (!S.token) return showLogin();
  if (!S.me) return boot();
  var parts = location.hash.replace(/^#\/?/, '').split('/'), name = parts[0];
  if (!name) { name = (S.me.roles.indexOf('WORKER') >= 0 && !S.me.is_manager) ? 'nhiem-vu' : (S.me.is_manager ? 'dashboard' : 'nhiem-vu'); }
  renderNav(); renderNet();
  if (window.innerWidth <= 800) $('nav').classList.add('closed');
  var fn = ROUTES[name] || ROUTES['nhiem-vu'];
  $app.innerHTML = '<div class="loading">Đang tải…</div>';
  fn(parts.slice(1));
}
window.addEventListener('hashchange', route);
$('menuBtn').addEventListener('click', function () { $('nav').classList.toggle('closed'); });
$('bellBtn').addEventListener('click', function () { location.hash = '#/thong-bao'; });

var ACT = {};
document.addEventListener('click', function (ev) {
  var t = ev.target.closest('[data-act]');
  if (!t) return;
  ev.preventDefault();
  var f = ACT[t.getAttribute('data-act')];
  if (f) f(t.dataset, t);
});
document.addEventListener('change', function (ev) {
  var t = ev.target.closest('[data-change]');
  if (t && ACT[t.getAttribute('data-change')]) ACT[t.getAttribute('data-change')](t.dataset, t, ev);
});
ACT.logout = function () { api('auth.logout').catch(function () {}); logout(); };
ACT.devLogin = function () { doLogin({ dev_email: val('devEmail') }); };
function busy(el, on) { if (el) el.disabled = on; }

// ---------- nhãn ----------
var PT = { LOCKED: ['Chưa đến lượt', 'grey'], READY: ['Đến lượt', 'blue'], STARTED: ['Đang thực hiện', 'amber'], SUBMITTED: ['Đã báo hoàn thành – chờ xác nhận', 'amber'],
  VERIFIED: ['Đã xác nhận đạt', 'green'], RETURNED: ['Bị trả lại – cần làm lại', 'red'], EXCEPTION_PENDING: ['Chờ duyệt ngoại lệ', 'amber'],
  EXCEPTION_APPROVED: ['Ngoại lệ đã duyệt', 'grey'], EXCEPTION_REJECTED: ['Ngoại lệ bị từ chối', 'red'] };
var AS = { ASSIGNED: 'Đã giao – chưa tiếp nhận', ACCEPTED: 'Đã tiếp nhận', IN_PROGRESS: 'Đang thực hiện', SUBMITTED: 'Đã báo hoàn thành', COMPLETED: 'Hoàn tất',
  CLOSED_INCOMPLETE: 'Đóng chưa hoàn tất', CANCELLED: 'Đã hủy' };
var PS = { DRAFT: 'Dự thảo', SUBMITTED: 'Chờ duyệt', APPROVED: 'Đã duyệt', RETURNED: 'Bị trả lại', REJECTED: 'Không duyệt', CANCELLED: 'Đã hủy', CLOSED: 'Đã kết thúc' };
var IS = { NEW: 'Mới ghi nhận', RECEIVED: 'Đã tiếp nhận', IN_PROGRESS: 'Đang xử lý', RESOLVED: 'Đã xử lý', MONITORING: 'Tiếp tục theo dõi', CLOSED: 'Đóng hồ sơ', REOPENED: 'Mở lại' };
var IG = { OPEN: ['Chưa xử lý', 'red'], HANDLING: ['Đang xử lý', 'amber'], DONE: ['Đã xử lý', 'green'], MONITORING: ['Tiếp tục theo dõi', 'blue'] };
var SRC = { DINH_KY: 'Định kỳ', BAO_DUONG_BO_SUNG: 'Bảo dưỡng bổ sung', PHAT_SINH: 'Phát sinh' };
var COLOR = { green: 'Hoàn thành / đạt tiến độ', amber: 'Đang thực hiện / có nguy cơ chậm', red: 'Quá hạn / chưa hoàn thành', grey: 'Chưa đến kỳ', blue: 'Kế hoạch đã duyệt' };
function legend() { return '<div class="row small" style="margin:6px 0 10px">' + Object.keys(COLOR).map(function (k) { return chip(COLOR[k], k); }).join(' ') + '</div>'; }
function chip(label, c) { return '<span class="chip c-' + c + '">' + esc(label) + '</span>'; }
function localStatus(p) {
  var q = queuedFor(p.assignment_point_id);
  if (q.some(function (x) { return x.action === 'executions.complete'; })) return ['Đã làm – chờ gửi (mất kết nối)', 'dark', 'QUEUED'];
  if (q.some(function (x) { return x.action === 'route-exceptions.create'; })) return ['Đề nghị ngoại lệ chờ gửi', 'dark', 'QUEUED'];
  if (q.some(function (x) { return x.action === 'executions.start'; })) return ['Đang thực hiện (chờ gửi)', 'amber', 'STARTED_LOCAL'];
  var s = PT[p.point_status] || [p.point_status, 'grey']; return [s[0], s[1], p.point_status];
}

// ================= NHIỆM VỤ CỦA TÔI =================
ROUTES['nhiem-vu'] = function () {
  api('my-tasks').then(function (list) {
    S.tasks = list;
    var errQ = Q.filter(function (q) { return q.status === 'ERROR'; });
    var h = errQ.length ? '<div class="card bl-red"><h3>Thao tác bị máy chủ từ chối</h3>' + errQ.map(function (q) { return '<div class="small">' + esc(q.label) + ': ' + esc(q.error) + ' <button class="btn sm danger" data-act="dropQ" data-key="' + q.key + '">Bỏ thao tác</button></div>'; }).join('') + '</div>' : '';
    $app.innerHTML = h + personalView(list, { name: S.me.full_name, date: today(), readOnly: false });
  }).catch(function (e) { if (e.network && S.tasks) { toast('Mất kết nối: đang hiển thị dữ liệu đã tải.', 'info'); } else fail(e); });
};
// V1.2.2 (CR-03): Dashboard cá nhân theo hình minh họa – dùng chung cho người lao động và chế độ xem của Quản trị
function personalView(list, o) {
  var sum = function (k) { return list.reduce(function (t, a) { return t + (Number(a[k]) || 0); }, 0); };
  var cur = null;
  list.forEach(function (a) { a.points.slice().sort(function (x, y) { return x.seq_no - y.seq_no; }).forEach(function (p) {
    if (!cur && ['READY', 'STARTED', 'RETURNED'].indexOf(p.point_status) >= 0) cur = { a: a.assignment_id, p: p.assignment_point_id, asset: p.asset_id };
  }); });
  var h = '<div class="sub" style="font-weight:600;letter-spacing:.06em">ĐẶT HÀNG TN-XLNT</div><h1>DASHBOARD CÁ NHÂN</h1>' +
    '<div>Người thực hiện: <b>' + esc(o.name) + '</b> · Ngày: ' + dmy(o.date) + '</div>' +
    (o.readOnly ? '<div class="banner c-blue" style="margin-top:8px">Chế độ xem của người quản lý: chỉ hiển thị, không thao tác thay người thực hiện.</div>' : '') +
    '<div class="grid kpis5" style="margin:12px 0">' +
    '<div class="card kpi" style="margin:0"><div class="l">TUYẾN ĐƯỢC GIAO</div><div class="v sm">' + (list.length ? list.map(function (a) { return esc(a.route_name); }).join('<br>') : '–') + '</div></div>' +
    [['ĐIỂM PHẢI LÀM', sum('total'), ''], ['ĐÃ HOÀN THÀNH', sum('verified'), 'var(--green)'], ['CÒN LẠI', sum('remaining'), '']].map(function (x) {
      return '<div class="card kpi" style="margin:0"><div class="l">' + x[0] + '</div><div class="v"' + (x[2] ? ' style="color:' + x[2] + '"' : '') + '>' + x[1] + '</div></div>'; }).join('') + '</div>';
  h += '<h2>DANH SÁCH ĐIỂM THEO THỨ TỰ TUYẾN</h2>';
  if (!list.length) h += '<div class="card">Chưa có nhiệm vụ được công bố. Kế hoạch ngày tiếp theo được công bố từ 20 giờ.</div>';
  list.forEach(function (a) {
    h += '<div class="card"><div class="row" style="justify-content:space-between"><div><b>' + esc(a.route_name) + '</b><div class="sub">Ngày ' + dmy(a.work_date) + ' · Hạn ' + esc(String(a.due_at).slice(11, 16)) + ' · ' + esc(a.assignment_code) + ' · đã báo hoàn thành ' + a.submitted + '/' + a.total + '</div>' +
      (a.reason ? '<div class="small">Lý do giao: ' + esc(a.reason) + '</div>' : '') + '</div>' + chip(AS[a.status] || a.status, a.status === 'COMPLETED' ? 'green' : 'blue') + '</div>' +
      (!a.accepted && !o.readOnly ? '<div style="height:8px"></div><button class="btn big" data-act="accept" data-id="' + a.assignment_id + '">TIẾP NHẬN NHIỆM VỤ</button>' : '') + '<div style="height:8px"></div>';
    a.points.slice().sort(function (x, y) { return x.seq_no - y.seq_no; }).forEach(function (p) {
      var ls = o.readOnly ? (PT[p.point_status] || [p.point_status, 'grey']) : localStatus(p);
      var act = !o.readOnly && ['READY', 'STARTED', 'RETURNED'].indexOf(p.point_status) >= 0;
      var inner = '<div class="num c-' + ls[1] + '">' + (p.seq_no < 10 ? '0' : '') + p.seq_no + '</div><div style="flex:1;min-width:0"><b>' + esc(p.asset_code) + '</b> · ' + esc(p.asset_name) + '<div class="small muted">' + esc(p.location_text || '') + '</div>' +
        '<div class="small">' + p.items.map(function (i) { return esc(i.work_name); }).join(' · ') + '</div>' + chip(ls[0], ls[1]) +
        (p.items.some(function (i) { return i.return_comment; }) && p.point_status === 'RETURNED' ? '<div class="small err">Trả lại: ' + esc(p.items.filter(function (i) { return i.return_comment; })[0].return_comment) + '</div>' : '') + '</div>' +
        (act ? '<span class="small" style="color:var(--blue);font-weight:600">' + (p.point_status === 'READY' ? 'BẮT ĐẦU' : 'TIẾP TỤC') + '</span>' : '');
      h += o.readOnly ? '<div class="point bl-' + ls[1] + '">' + inner + '</div>'
        : '<button class="point bl-' + ls[1] + '" data-act="openPoint" data-a="' + a.assignment_id + '" data-p="' + p.assignment_point_id + '"' + (p.point_status === 'LOCKED' ? ' style="opacity:.75"' : '') + '>' + inner + '</button>';
    });
    h += '</div>';
  });
  if (!o.readOnly) h += '<h2>THAO TÁC</h2><div class="grid acts3">' +
    '<button class="btn big" data-act="curPoint"' + (cur ? ' data-a="' + cur.a + '" data-p="' + cur.p + '"' : ' disabled') + '>BẮT ĐẦU / HOÀN THÀNH</button>' +
    '<button class="btn big warn" data-act="newIncident"' + (cur ? ' data-asset="' + cur.asset + '" data-p="' + cur.p + '"' : '') + '>GHI NHẬN SỰ CỐ</button>' +
    '<button class="btn big sec" data-act="exception"' + (cur ? ' data-a="' + cur.a + '" data-p="' + cur.p + '"' : ' disabled') + '>ĐỀ NGHỊ NGOẠI LỆ</button></div>';
  h += '<p class="small muted">Chỉ xem nhiệm vụ được giao; hoàn thành chính thức sau khi được xác nhận đạt.</p>';
  return h;
}
ACT.curPoint = function (d) { if (d.a) location.hash = '#/diem/' + d.a + '/' + d.p; };
// Quản trị, người quản lý: chọn người để xem Dashboard cá nhân
ROUTES['ca-nhan'] = function (args) {
  if (args[0]) {
    api('tasks.of', { user_id: args[0] }).then(function (r) {
      $app.innerHTML = '<a href="#/ca-nhan">← Chọn người</a> · <a href="#/nhan-su-ct/' + r.person.user_id + '">Hồ sơ tác nghiệp</a><div style="height:6px"></div>' +
        personalView(r.tasks, { name: r.person.full_name + ' (' + r.person.employee_code + ')', date: r.date, readOnly: true });
    }).catch(fail);
    return;
  }
  api('people.list', {}).then(function (r) {
    $app.innerHTML = '<h1>Dashboard cá nhân</h1><div class="sub">' + esc(S.me.don_vi_name) + ' · chọn người để xem màn hình Nhiệm vụ của tôi của người đó (chỉ xem)</div><div style="height:8px"></div>' +
      (r.people.length ? r.people.map(function (u) { return '<a class="point" href="#/ca-nhan/' + u.user_id + '"><div style="flex:1"><b>' + esc(u.full_name) + '</b> · ' + esc(u.employee_code) + '<div class="small muted">' + esc(u.team_name || '') + ' · ' + esc((u.roles || []).join(', ')) + '</div></div><span class="small">Nhiệm vụ trong kỳ: ' + u.assignments + '</span></a>'; }).join('')
        : '<div class="card muted">Trạm chưa có người dùng. Nhập dữ liệu nền tại mục Quản trị.</div>');
  }).catch(fail);
};
ACT.dropQ = function (d) { Q = Q.filter(function (q) { return q.key !== d.key; }); saveQ(); route(); };
ACT.accept = function (d, el) { busy(el, true); api('assignments.accept', { assignment_id: d.id }).then(function () { toast('Đã tiếp nhận nhiệm vụ.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.openPoint = function (d) {
  var a = (S.tasks || []).filter(function (x) { return x.assignment_id === d.a; })[0], p = a && a.points.filter(function (x) { return x.assignment_point_id === d.p; })[0];
  if (p && p.point_status === 'LOCKED' && !queuedFor(p.assignment_point_id).length) { toast('Điểm ' + p.seq_no + ' chưa đến lượt. Hoàn thành điểm trước hoặc gửi đề nghị ngoại lệ.', 'info'); }
  location.hash = '#/diem/' + d.a + '/' + d.p;
};
ACT.newIncident = function (d) { location.hash = '#/su-co-moi' + (d.asset ? '/' + d.asset + '/' + (d.p || '') : ''); };

function findPoint(aid, pid) {
  var a = (S.tasks || []).filter(function (x) { return x.assignment_id === aid; })[0];
  return { a: a, p: a ? a.points.filter(function (x) { return x.assignment_point_id === pid; })[0] : null };
}
ROUTES['diem'] = function (args) {
  var go = function () {
    var f = findPoint(args[0], args[1]); if (!f.p) { $app.innerHTML = '<div class="card">Không tìm thấy điểm.</div>'; return; }
    var a = f.a, p = f.p, ls = localStatus(p), F = S.form[p.assignment_point_id] = S.form[p.assignment_point_id] || {};
    var started = ls[2] === 'STARTED' || ls[2] === 'STARTED_LOCAL';
    var need = { before: p.items.some(function (i) { return i.require_photo_before; }), after: p.items.some(function (i) { return i.require_photo_after; }), gps: p.items.some(function (i) { return i.require_gps; }) };
    var h = '<a href="#/nhiem-vu">← Danh sách điểm</a><div class="card" style="margin-top:8px"><div class="sub">Điểm ' + p.seq_no + '/' + a.total + ' · ' + esc(a.route_name) + '</div><h1>' + esc(p.asset_code) + '</h1><div>' + esc(p.asset_name) + '</div>' +
      '<div class="small muted">' + esc(p.location_text || '') + '</div><div style="margin:8px 0">' + chip(ls[0], ls[1]) + '</div><h3>Hạng mục tại điểm</h3>' +
      p.items.map(function (i) {
        return '<div class="card" style="background:var(--bg);margin-bottom:6px"><b>' + esc(i.work_name) + '</b> ' + chip(SRC[i.source_type] || '', 'blue') +
          '<div class="small">' + (i.standard ? 'Tiêu chuẩn: ' + esc(i.standard) : '') + '</div><div class="small muted">Yêu cầu: ' + [i.require_photo_before ? 'ảnh trước' : '', i.require_photo_after ? 'ảnh sau' : '', i.require_gps ? 'GPS' : ''].filter(Boolean).join(', ') + (i.deadline ? ' · Hạn ' + dmy(i.deadline) : '') + '</div>' +
          (i.return_comment ? '<div class="small err">Trả lại: ' + esc(i.return_comment) + '</div>' : '') + (i.exception_pending ? chip('Đề nghị ngoại lệ hạng mục đang chờ', 'amber') : '') +
          (i.item_status === 'EXCEPTION_APPROVED' ? chip('Không thực hiện – ngoại lệ đã duyệt', 'grey') : '') + '</div>';
      }).join('') + '</div>';
    if (!a.accepted && ['READY', 'RETURNED'].indexOf(p.point_status) >= 0) h += '<div class="banner c-blue">Bấm Bắt đầu sẽ đồng thời ghi nhận đã tiếp nhận nhiệm vụ.</div>';
    if ((p.point_status === 'READY' || p.point_status === 'RETURNED') && ls[2] !== 'STARTED_LOCAL' && ls[2] !== 'QUEUED')
      h += '<button class="btn big" data-act="start" data-a="' + a.assignment_id + '" data-p="' + p.assignment_point_id + '">' + (p.point_status === 'RETURNED' ? 'LÀM LẠI' : 'BẮT ĐẦU') + '</button>';
    if (started) {
      h += '<div class="card"><h3>Kết quả thực hiện</h3>' +
        photoField('before', 'Ảnh trước', need.before, F.before) + photoField('after', 'Ảnh sau', need.after, F.after) +
        '<div class="field"><label>GPS' + (need.gps ? ' (bắt buộc)' : '') + '</label><div id="gpsTxt" class="small">' + (F.gps ? esc(F.gps.lat.toFixed(5) + ', ' + F.gps.lng.toFixed(5) + ' · ±' + F.gps.acc + ' m') : 'Đang lấy vị trí…') + '</div>' +
        '<button class="btn sm sec" data-act="gps" data-p="' + p.assignment_point_id + '">Lấy lại GPS</button></div>' +
        '<div class="field"><label for="gpsReason">Lý do không có GPS (nếu không lấy được)</label><input id="gpsReason" value="' + esc(F.gpsReason || '') + '"></div>' +
        '<div class="field"><label for="note">Nội dung kết quả</label><textarea id="note" placeholder="Ví dụ: đã vớt rác, lòng cửa thu thông thoáng">' + esc(F.note || '') + '</textarea></div>' +
        '<div id="cErr" class="banner c-red" hidden></div><button class="btn big ok" data-act="complete" data-a="' + a.assignment_id + '" data-p="' + p.assignment_point_id + '">HOÀN THÀNH</button>' +
        '<p class="small muted">Điểm tiếp theo mở khi máy chủ nhận đủ kết quả. Điểm chỉ được tính hoàn thành sau khi được xác nhận đạt.</p></div>';
    }
    if (['READY', 'STARTED', 'LOCKED'].indexOf(p.point_status) >= 0 && ls[2] !== 'QUEUED')
      h += '<div class="row" style="margin-top:10px"><button class="btn sec" style="flex:1" data-act="exception" data-a="' + a.assignment_id + '" data-p="' + p.assignment_point_id + '">ĐỀ NGHỊ NGOẠI LỆ</button>' +
        '<button class="btn warn" style="flex:1" data-act="newIncident" data-asset="' + p.asset_id + '" data-p="' + p.assignment_point_id + '">GHI NHẬN SỰ CỐ</button></div>';
    if (p.last_exception && p.last_exception.decision !== 'PENDING') h += '<div class="banner ' + (p.last_exception.decision === 'APPROVED' ? 'c-green' : 'c-red') + '" style="margin-top:10px">Đề nghị ngoại lệ ' + (p.last_exception.decision === 'APPROVED' ? 'được chấp thuận' : 'bị từ chối') + (p.last_exception.note ? ': ' + esc(p.last_exception.note) : '') + '</div>';
    $app.innerHTML = h;
    if (started && !F.gps) ACT.gps({ p: p.assignment_point_id });
  };
  if (S.tasks) go(); else api('my-tasks').then(function (l) { S.tasks = l; go(); }).catch(fail);
};
function photoField(k, label, req, b64) {
  return '<div class="field"><label for="ph_' + k + '">' + label + (req ? ' (bắt buộc)' : '') + '</label><input id="ph_' + k + '" type="file" accept="image/*" capture="environment" data-change="photo" data-k="' + k + '">' +
    (b64 ? '<img class="photo" alt="' + label + '" src="data:image/jpeg;base64,' + b64 + '">' : '') + '</div>';
}
function curPid() { var x = location.hash.split('/'); return x[3]; }
ACT.photo = function (d, el) {
  var file = el.files && el.files[0]; if (!file) return;
  readPhoto(file).then(function (b64) { var F = S.form[curPid()]; F[d.k] = b64; keepInputs(); route(); }).catch(function (e) { toast(e.message, 'err'); });
};
function keepInputs() { var F = S.form[curPid()]; if (!F) return; if ($('note')) F.note = $('note').value; if ($('gpsReason')) F.gpsReason = $('gpsReason').value; }
ACT.gps = function (d) { getGps().then(function (g) { var F = S.form[d.p]; if (!F) return; F.gps = g; var t = $('gpsTxt'); if (t) t.textContent = g ? g.lat.toFixed(5) + ', ' + g.lng.toFixed(5) + ' · ±' + g.acc + ' m' : 'Không lấy được GPS. Bật định vị hoặc nhập lý do.'; }); };
ACT.start = function (d, el) {
  busy(el, true);
  getGps().then(function (g) {
    var payload = { assignment_point_id: d.p, lat: g && g.lat, lng: g && g.lng, acc: g && g.acc, device_time: new Date().toISOString() };
    return api('executions.start', payload).then(function (v) { replaceTask(v); S.form[d.p] = { gps: g }; toast('Đã bắt đầu. Máy chủ đã ghi thời gian và GPS.', 'ok'); route(); })
      .catch(function (e) {
        if (!e.network) { busy(el, false); return fail(e); }
        payload.sync_origin = 'OFFLINE_QUEUE';
        if (enqueue({ action: 'executions.start', payload: payload, point_id: d.p, label: 'Bắt đầu điểm' })) { S.form[d.p] = { gps: g }; toast('Mất kết nối: đã lưu bắt đầu, thời điểm chính thức ghi khi máy chủ nhận.', 'info'); route(); }
      });
  });
};
function replaceTask(v) { if (!S.tasks || !v || !v.assignment_id) return; S.tasks = S.tasks.map(function (x) { return x.assignment_id === v.assignment_id ? v : x; }); }
ACT.complete = function (d, el) {
  keepInputs();
  var F = S.form[d.p] || {}, f = findPoint(d.a, d.p), p = f.p, miss = [];
  var need = { before: p.items.some(function (i) { return i.require_photo_before; }), after: p.items.some(function (i) { return i.require_photo_after; }), gps: p.items.some(function (i) { return i.require_gps; }) };
  if (need.before && !F.before) miss.push('ảnh trước'); if (need.after && !F.after) miss.push('ảnh sau');
  if (need.gps && !F.gps && !(F.gpsReason || '').trim()) miss.push('GPS hoặc lý do không có GPS');
  if (!(F.note || '').trim()) miss.push('nội dung kết quả');
  if (miss.length) { var b = $('cErr'); b.hidden = false; b.textContent = 'Còn thiếu: ' + miss.join(', ') + '. Điểm tiếp theo chưa mở.'; return; }
  var key = uid(), payload = { assignment_point_id: d.p, note: F.note, lat: F.gps && F.gps.lat, lng: F.gps && F.gps.lng, acc: F.gps && F.gps.acc, gps_missing_reason: F.gpsReason || '', device_time: new Date().toISOString() };
  var photos = {}; if (F.before) photos.photo_before_id = F.before; if (F.after) photos.photo_after_id = F.after;
  var queueIt = function () {
    payload.sync_origin = 'OFFLINE_QUEUE';
    if (enqueue({ key: key, action: 'executions.complete', payload: payload, photos: photos, point_id: d.p, label: 'Hoàn thành điểm ' + p.seq_no })) {
      delete S.form[d.p]; toast('Mất kết nối: kết quả đã lưu chờ gửi. Chưa được ghi nhận, điểm tiếp theo chưa mở.', 'info'); location.hash = '#/nhiem-vu';
    }
  };
  if (!navigator.onLine || queuedFor(d.p).length) return queueIt();
  busy(el, true);
  var up = Promise.resolve();
  Object.keys(photos).forEach(function (fld) { up = up.then(function () { return api('files.upload', { data_base64: photos[fld], mime_type: 'image/jpeg', evidence_type: fld }, { key: key + '-' + fld }).then(function (r) { payload[fld] = r.attachment_id; }); }); });
  up.then(function () { return api('executions.complete', payload, { key: key }); }).then(function (v) {
    replaceTask(v); delete S.form[d.p];
    toast(v.opened_seq ? 'Máy chủ đã nhận. Điểm ' + v.opened_seq + ' đã mở. Kết quả chờ xác nhận.' : 'Máy chủ đã nhận kết quả. Chờ xác nhận.', 'ok'); location.hash = '#/nhiem-vu';
  }).catch(function (e) { busy(el, false); if (e.network) queueIt(); else { var b = $('cErr'); b.hidden = false; b.textContent = e.message; } });
};
ACT.exception = function (d) { location.hash = '#/ngoai-le/' + d.a + '/' + d.p; };
ROUTES['ngoai-le'] = function (args) {
  var f = findPoint(args[0], args[1]); if (!f.p) { location.hash = '#/nhiem-vu'; return; }
  var p = f.p, L = S.lists;
  $app.innerHTML = '<a href="#/diem/' + args[0] + '/' + args[1] + '">← Quay lại điểm ' + p.seq_no + '</a><div class="card" style="margin-top:8px"><h1>Đề nghị ngoại lệ – ' + esc(p.asset_code) + '</h1>' +
    '<div class="field"><label for="exScope">Phạm vi</label><select id="exScope"><option value="POINT|SKIP">Cả điểm – bỏ qua điểm này</option><option value="POINT|REORDER">Cả điểm – làm sau (đổi thứ tự)</option>' +
    p.items.map(function (i) { return '<option value="WORK_ITEM|' + i.assignment_item_id + '">Một hạng mục không thực hiện được: ' + esc(i.work_name) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="exReason">Lý do</label><select id="exReason"><option value="">– Chọn lý do –</option>' + (L.exception_reasons || []).map(function (r) { return '<option value="' + esc(r.code) + '">' + esc(r.label) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="exDesc">Mô tả tình trạng</label><textarea id="exDesc"></textarea></div>' +
    '<div class="field"><label for="exPhoto">Ảnh hiện trường (nếu có)</label><input id="exPhoto" type="file" accept="image/*" capture="environment"></div>' +
    '<button class="btn big" data-act="sendException" data-a="' + args[0] + '" data-p="' + args[1] + '">GỬI ĐỀ NGHỊ</button><p class="small muted">Người đề nghị không tự duyệt. Điểm giữ khóa cho đến khi có quyết định.</p></div>';
};
ACT.sendException = function (d, el) {
  var sc = val('exScope').split('|'), payload = { assignment_point_id: d.p, scope: sc[0], request_type: sc[0] === 'POINT' ? sc[1] : 'CANNOT_PERFORM', assignment_item_id: sc[0] === 'WORK_ITEM' ? sc[1] : '', reason_code: val('exReason'), description: val('exDesc') };
  if (!payload.reason_code) return toast('Chọn lý do trước khi gửi.', 'err');
  busy(el, true);
  var file = $('exPhoto').files[0], key = uid();
  Promise.all([getGps(), file ? readPhoto(file) : Promise.resolve(null)]).then(function (r) {
    if (r[0]) { payload.lat = r[0].lat; payload.lng = r[0].lng; payload.acc = r[0].acc; }
    var photos = r[1] ? { attachment_id: r[1] } : {};
    var q = function () { if (enqueue({ key: key, action: 'route-exceptions.create', payload: payload, photos: photos, point_id: d.p, label: 'Đề nghị ngoại lệ' })) { toast('Mất kết nối: đề nghị đã lưu chờ gửi.', 'info'); location.hash = '#/nhiem-vu'; } };
    if (!navigator.onLine) return q();
    var up = r[1] ? api('files.upload', { data_base64: r[1], mime_type: 'image/jpeg', evidence_type: 'PHOTO_SCENE' }, { key: key + '-a' }).then(function (x) { payload.attachment_id = x.attachment_id; }) : Promise.resolve();
    return up.then(function () { return api('route-exceptions.create', payload, { key: key }); }).then(function (v) { replaceTask(v); toast('Đã gửi đề nghị. Chờ người có thẩm quyền quyết định.', 'ok'); location.hash = '#/diem/' + d.a + '/' + d.p; })
      .catch(function (e) { busy(el, false); if (e.network) q(); else fail(e); });
  });
};

// ================= SỰ CỐ =================
ROUTES['su-co-moi'] = function (args) {
  var L = S.lists;
  $app.innerHTML = '<a href="javascript:history.back()">← Quay lại</a><div class="card" style="margin-top:8px"><h1>Ghi nhận sự cố</h1>' +
    '<div class="field"><label for="icAsset">Tài sản</label><select id="icAsset"><option value="">– Chọn tài sản –</option>' + L.assets.map(function (a) { return '<option value="' + a.asset_id + '"' + (a.asset_id === args[0] ? ' selected' : '') + '>' + esc(a.asset_code + ' – ' + a.asset_name) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="icType">Loại sự cố</label><select id="icType"><option value="">– Chọn –</option>' + (L.incident_types || []).map(function (x) { return '<option value="' + esc(x.code) + '">' + esc(x.label) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label for="icSev">Mức độ</label><select id="icSev"><option value="">– Chọn –</option>' + (L.severities || []).map(function (x) { return '<option value="' + esc(x.code) + '">' + esc(x.label) + '</option>'; }).join('') + '</select></div>' +
    '<div class="field"><label>Hạng mục liên quan (nếu xác định được)</label>' + L.works.map(function (w) { return '<label class="check" style="font-weight:400"><input type="checkbox" class="icWork" value="' + w.work_id + '">' + esc(w.work_name) + '</label>'; }).join('') + '</div>' +
    '<div class="field"><label for="icDesc">Mô tả</label><textarea id="icDesc"></textarea></div>' +
    '<div class="field"><label for="icPhoto">Ảnh hiện trường</label><input id="icPhoto" type="file" accept="image/*" capture="environment"></div>' +
    '<button class="btn big warn" data-act="sendIncident" data-p="' + esc(args[1] || '') + '">GỬI SỰ CỐ</button><p class="small muted">Sự cố là hồ sơ riêng, không thay cho kết quả bảo dưỡng.</p></div>';
};
ACT.sendIncident = function (d, el) {
  var payload = { asset_id: val('icAsset'), incident_type_code: val('icType'), severity_code: val('icSev'), description: val('icDesc'), assignment_point_id: d.p || '',
    work_ids: Array.prototype.slice.call(document.querySelectorAll('.icWork:checked')).map(function (x) { return x.value; }) };
  if (!payload.asset_id || !payload.description) return toast('Chọn tài sản và nhập mô tả.', 'err');
  busy(el, true);
  var file = $('icPhoto').files[0], key = uid();
  Promise.all([getGps(), file ? readPhoto(file) : Promise.resolve(null)]).then(function (r) {
    if (r[0]) { payload.lat = r[0].lat; payload.lng = r[0].lng; payload.acc = r[0].acc; }
    var q = function () { if (enqueue({ key: key, action: 'incidents.create', payload: payload, photos: r[1] ? { photo_id: r[1] } : {}, label: 'Ghi nhận sự cố' })) { toast('Mất kết nối: sự cố đã lưu chờ gửi.', 'info'); history.back(); } };
    if (!navigator.onLine) return q();
    var up = r[1] ? api('files.upload', { data_base64: r[1], mime_type: 'image/jpeg', evidence_type: 'PHOTO_SCENE' }, { key: key + '-p' }).then(function (x) { payload.photo_id = x.attachment_id; }) : Promise.resolve();
    return up.then(function () { return api('incidents.create', payload, { key: key }); }).then(function (x) { toast('Đã ghi nhận sự cố ' + x.incident_code + (x.is_recurrence ? ' (tái diễn)' : '') + '.', 'ok'); history.back(); })
      .catch(function (e) { busy(el, false); if (e.network) q(); else fail(e); });
  });
};
function incRange(kind, d) {
  if (kind === 'day') return { from: d, to: d };
  if (kind === 'month') return { from: d.slice(0, 7) + '-01', to: d.slice(0, 7) + '-31' };
  if (kind === 'year') return { from: d.slice(0, 4) + '-01-01', to: d.slice(0, 4) + '-12-31' };
  return {};
}
ROUTES['su-co'] = function (args) {
  var g = args[0] || '', kind = args[1] || 'all', day = args[2] || today(), rg = incRange(kind, day);
  S.incF = { g: g, kind: kind, day: day };
  api('incidents.list', { group: g, from: rg.from || '', to: rg.to || '' }).then(function (list) {
    var mgr = S.me.is_manager, canClose = S.me.authority.indexOf('INCIDENT_CLOSE') >= 0;
    var h = '<div class="row" style="justify-content:space-between"><h1>Sự cố</h1><button class="btn warn" data-act="newIncident">Ghi nhận sự cố</button></div><div class="row" style="margin:8px 0">' +
      [['', 'Tất cả'], ['OPEN', 'Chưa xử lý'], ['HANDLING', 'Đang xử lý'], ['MONITORING', 'Theo dõi'], ['DONE', 'Đã xử lý']].map(function (x) { return '<a class="btn sm ' + (g === x[0] ? '' : 'sec') + '" href="#/su-co/' + x[0] + '/' + kind + '/' + day + '">' + x[1] + '</a>'; }).join('') + '</div>' +
      '<div class="row" style="margin-bottom:8px"><select id="iKind" aria-label="Lọc theo thời gian" style="width:auto">' + [['all', 'Toàn bộ thời gian'], ['day', 'Ngày'], ['month', 'Tháng'], ['year', 'Năm']].map(function (x) { return '<option value="' + x[0] + '"' + (kind === x[0] ? ' selected' : '') + '>' + x[1] + '</option>'; }).join('') + '</select>' +
      '<input id="iDay" type="date" value="' + esc(day) + '" aria-label="Ngày tham chiếu" style="width:auto"><button class="btn sm" data-act="incGo">Lọc</button><span class="small muted">' + list.length + ' sự cố</span></div>';
    if (!list.length) h += '<div class="card">Không có sự cố.</div>';
    list.forEach(function (i) {
      var gg = IG[i.group];
      h += '<div class="card bl-' + gg[1] + '"><div class="row" style="justify-content:space-between"><a href="#/su-co-ct/' + i.incident_id + '"><b>' + esc(i.incident_code) + ' · ' + esc(i.asset_code) + '</b></a>' + chip(IS[i.status] || i.status, gg[1]) + '</div>' +
        '<div>' + esc(i.description) + '</div><div class="small muted">Phát hiện ' + vnTime(i.detected_at) + ' · ' + esc(i.reporter || '') + (i.handler ? ' · Xử lý: ' + esc(i.handler) : '') + (i.is_recurrence ? ' · <b>Tái diễn</b>' : '') + '</div>' +
        (i.resolution_note ? '<div class="small">Kết quả: ' + esc(i.resolution_note) + '</div>' : '') +
        (i.photo_id ? '<img id="ip' + i.incident_id + '" class="photo" alt="Ảnh sự cố">' : '');
      if (mgr && i.next.length) {
        var acts = i.next.filter(function (n) { return canClose || ['RECEIVED', 'IN_PROGRESS'].indexOf(n) >= 0; });
        if (acts.length) h += '<div class="field" style="margin-top:8px"><label for="in' + i.incident_id + '">Nội dung</label><input id="in' + i.incident_id + '"></div><div class="row">' +
          acts.map(function (n) { return '<button class="btn sm" data-act="incAct" data-id="' + i.incident_id + '" data-to="' + n + '">' + esc(IS[n]) + '</button>'; }).join('') + '</div>';
      }
      h += '</div>';
    });
    $app.innerHTML = h;
    list.forEach(function (i) { if (i.photo_id) loadPhoto(i.photo_id, 'ip' + i.incident_id); });
  }).catch(fail);
};
ACT.incGo = function () { location.hash = '#/su-co/' + (S.incF ? S.incF.g : '') + '/' + val('iKind') + '/' + (val('iDay') || today()); };

// ================= NHÂN SỰ (V1.2.1, bản tổng hợp Mục 8.3) =================
ROUTES['nhan-su'] = function (args) {
  var per = args[0] || 'month', ref = args[1] || today().slice(0, 7);
  api('people.list', { period: per, ref: ref }).then(function (r) {
    S.pp = { per: per, ref: ref };
    $app.innerHTML = '<div class="row" style="justify-content:space-between;align-items:flex-end"><div><h1>Nhân sự</h1><div class="sub">' + esc(S.me.don_vi_name) + ' · ' + esc(r.period.label) + ' · ' + r.people.length + ' người</div></div>' + periodPicker(per, ref, 'peopleGo') + '</div>' +
      '<p class="small muted">Số liệu thống kê theo kỳ, sắp theo mã nhân viên. Bấm họ tên để xem hồ sơ tác nghiệp.</p>' +
      (r.people.length ? '<div class="tbl"><table><thead><tr><th>Mã</th><th>Họ tên</th><th>Tổ</th><th>Vai trò</th><th>Nhiệm vụ được giao</th><th>Kết quả đã báo</th><th>Đạt</th><th>Bị trả lại</th><th>Sự cố phát hiện</th></tr></thead><tbody>' +
        r.people.map(function (u) {
          return '<tr><td>' + esc(u.employee_code) + '</td><td><a href="#/nhan-su-ct/' + u.user_id + '/' + per + '/' + ref + '"><b>' + esc(u.full_name) + '</b></a>' + (u.account_status !== 'ACTIVE' ? ' ' + chip('Đã khóa', 'grey') : '') + '<div class="small muted">' + esc(u.email) + '</div></td><td>' + esc(u.team_name) + '</td><td>' + esc(u.roles.join(', ')) + '</td>' +
            '<td>' + u.assignments + '</td><td>' + u.submitted + '</td><td style="color:var(--green)">' + u.passed + '</td><td style="color:var(--red)">' + u.returned + '</td><td>' + u.incidents + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<div class="card muted">Trạm chưa có người dùng.</div>');
  }).catch(fail);
};
ACT.peopleGo = function () { var v = perVal(); location.hash = '#/nhan-su/' + v[0] + '/' + v[1]; };
var AS2 = { ROUTE: 'Theo tuyến', SINGLE: 'Đơn lẻ' };
ROUTES['nhan-su-ct'] = function (args) {
  var id = args[0], per = args[1] || 'month', ref = args[2] || today().slice(0, 7);
  api('people.get', { user_id: id, period: per, ref: ref }).then(function (r) {
    var u = r.person, k = r.summary;
    S.person = { id: id };
    var h = '<a href="#/nhan-su/' + per + '/' + ref + '">← Nhân sự</a> · <a href="#/ca-nhan/' + id + '">Xem Dashboard cá nhân</a><div class="row" style="justify-content:space-between;align-items:flex-end;margin-top:8px"><div><div class="sub">' + esc(u.employee_code) + ' · ' + esc(u.team_name) + ' · ' + esc(u.roles.join(', ')) + '</div><h1>' + esc(u.full_name) + '</h1><div class="small muted">' + esc(u.email) + (u.account_status !== 'ACTIVE' ? ' · Đã khóa' : '') + ' · ' + esc(r.period.label) + '</div></div>' + periodPicker(per, ref, 'personGo') + '</div>' +
      '<div class="grid kpis" style="margin:10px 0">' + [['Nhiệm vụ được giao', k.assignments, ''], ['Kết quả đã báo', k.submitted, ''], ['Đạt', k.passed, 'var(--green)'], ['Chờ xác nhận', k.waiting, 'var(--amber)'], ['Bị trả lại', k.returned, 'var(--red)'], ['Sự cố', k.incidents, '#7C2D12'], ['Đề nghị ngoại lệ', k.exceptions, '']]
        .map(function (x) { return '<div class="card kpi" style="margin:0"><div class="l">' + x[0] + '</div><div class="v"' + (x[2] ? ' style="color:' + x[2] + '"' : '') + '>' + x[1] + '</div></div>'; }).join('') + '</div>';
    h += '<div class="card"><h2>Nhiệm vụ được giao</h2>' + (r.assignments.length ? '<div class="tbl"><table><thead><tr><th>Ngày</th><th>Mã</th><th>Tuyến / công việc</th><th>Loại</th><th>Tiếp nhận</th><th>Tiến độ</th><th>Trạng thái</th></tr></thead><tbody>' +
      r.assignments.map(function (a) { return '<tr><td>' + dmy(a.work_date) + '</td><td>' + esc(a.assignment_code) + '</td><td>' + esc(a.route_name) + '</td><td>' + esc(AS2[a.mode] || a.mode) + '</td><td>' + (a.accepted_at ? vnFull(a.accepted_at) : '<span class="muted">Chưa</span>') + '</td><td>' + a.verified + '/' + a.points + ' đạt</td><td>' + esc(AS[a.status] || a.status) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="muted">Không có nhiệm vụ trong kỳ.</div>') + '</div>';
    h += '<div class="card"><h2>Kết quả thực hiện</h2>' + (r.results.length ? '<div class="tbl"><table><thead><tr><th>Tài sản</th><th>Hạng mục</th><th>Bắt đầu</th><th>Kết thúc</th><th>Thời lượng</th><th>GPS</th><th>Trạng thái</th></tr></thead><tbody>' +
      r.results.map(function (x) { return '<tr><td><a href="#/tai-san/' + x.asset_id + '"><b>' + esc(x.asset_code) + '</b></a></td><td>' + (x.occurrence_id ? '<a href="#/lan/' + x.occurrence_id + '">' + esc(x.work_name) + '</a>' : esc(x.work_name) + ' <span class="small muted">(' + esc(SRC[x.source_type] || '') + ')</span>') + (x.is_rework ? ' ' + chip('Làm lại', 'amber') : '') + '</td><td>' + vnFull(x.started_at) + '</td><td>' + vnFull(x.submitted_at) + '</td><td>' + (x.submitted_at ? dur(x.duration_seconds) : '') + '</td><td>' + (mapLink(x.end_lat, x.end_lng, x.end_acc) || esc(x.gps_missing_reason || '')) + (x.sync_origin === 'OFFLINE_QUEUE' ? '<div class="small muted">gửi sau khi mất mạng</div>' : '') + '</td><td>' + chip(RS[x.result_status] || x.result_status, x.result_status === 'PASSED' ? 'green' : x.result_status === 'RETURNED' ? 'red' : 'amber') + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="muted">Không có kết quả trong kỳ.</div>') + '</div>';
    h += '<div class="card"><h2>Sự cố</h2>' + (r.incidents.length ? r.incidents.map(function (i) { var gg = IG[i.group]; return '<div class="check"><div style="flex:1"><a href="#/su-co-ct/' + i.incident_id + '"><b>' + esc(i.incident_code) + '</b> · ' + esc(i.asset_code) + '</a> ' + chip(IS[i.status] || i.status, gg[1]) + ' <span class="small muted">' + esc(i.role) + ' · ' + vnTime(i.detected_at) + '</span><div class="small">' + esc(i.description) + '</div></div></div>'; }).join('') : '<div class="muted">Không có sự cố trong kỳ.</div>') + '</div>';
    h += '<div class="card"><h2>Đề nghị ngoại lệ</h2>' + (r.exceptions.length ? r.exceptions.map(function (e) { return '<div class="small">' + vnFull(e.requested_at) + ' · ' + esc(e.asset_code) + ' · ' + (e.scope === 'POINT' ? (e.request_type === 'REORDER' ? 'Đổi thứ tự' : 'Bỏ qua điểm') : 'Không làm hạng mục') + ' · ' + esc(reasonLabel(e.reason_code)) + ' · <b>' + ({ PENDING: 'Chờ duyệt', APPROVED: 'Chấp thuận', REJECTED: 'Từ chối' }[e.decision] || e.decision) + '</b>' + (e.decision_note ? ': ' + esc(e.decision_note) : '') + '</div>'; }).join('') : '<div class="muted">Không có.</div>') + '</div>';
    $app.innerHTML = h;
  }).catch(fail);
};
ACT.personGo = function () { var v = perVal(); location.hash = '#/nhan-su-ct/' + S.person.id + '/' + v[0] + '/' + v[1]; };

// ================= HỒ SƠ SỰ CỐ (V1.2, bản tổng hợp Mục 7) =================
var PH = { PHOTO_SCENE: 'Ảnh hiện trường', INCIDENT_BEFORE: 'Ảnh trước xử lý', INCIDENT_AFTER: 'Ảnh sau xử lý' };
ROUTES['su-co-ct'] = function (args) {
  api('incidents.get', { incident_id: args[0] }).then(function (i) {
    var gg = IG[i.group], L = S.lists || {};
    var lbl = function (list, c) { var x = (list || []).filter(function (y) { return y.code === c; })[0]; return x ? x.label : c; };
    var h = '<a href="javascript:history.back()">← Quay lại</a><div class="card bl-' + gg[1] + '" style="margin-top:8px"><div class="row" style="justify-content:space-between"><h1>' + esc(i.incident_code) + '</h1>' + chip(IS[i.status] || i.status, gg[1]) + '</div>' +
      '<div>' + (S.me.is_manager ? '<a href="#/tai-san/' + i.asset_id + '"><b>' + esc(i.asset_code) + '</b></a>' : '<b>' + esc(i.asset_code) + '</b>') + ' · ' + esc(i.asset_name) + (i.is_recurrence ? ' ' + chip('Tái diễn', 'red') : '') + '</div>' +
      '<div class="tbl" style="margin-top:8px"><table><tbody>' +
      [['Mô tả', esc(i.description)], ['Loại', esc(lbl(L.incident_types, i.incident_type_code))], ['Mức độ', esc(lbl(L.severities, i.severity_code))], ['Phát hiện', vnFull(i.detected_at) + ' · ' + esc(i.reporter)],
        ['Vị trí', mapLink(i.latitude, i.longitude, i.gps_accuracy_m)], ['Hạng mục liên quan', esc(i.works.join(', ')) || '<span class="muted">Chưa xác định – ghi nhận ở cấp tài sản</span>'],
        ['Người xử lý', esc(i.handler)], ['Kết quả xử lý', esc(i.resolution_note) + (i.resolved_at ? ' <span class="small muted">(' + vnFull(i.resolved_at) + ')</span>' : '')], ['Đóng hồ sơ', i.closed_at ? vnFull(i.closed_at) + ' · ' + esc(i.closed_by) : '']]
        .map(function (y) { return '<tr><th style="width:34%">' + y[0] + '</th><td>' + y[1] + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      (i.photos.length ? '<div class="photos" style="margin:8px 0">' + i.photos.map(function (p) { return '<div><div class="small">' + (PH[p.evidence_type] || 'Ảnh') + '</div><img id="ic' + p.attachment_id + '" class="photo" alt="' + (PH[p.evidence_type] || 'Ảnh') + '"></div>'; }).join('') + '</div>' : '') + '</div>';
    if (i.next.length) {
      var acts = i.next.filter(function (n) { return S.me.authority.indexOf('INCIDENT_CLOSE') >= 0 || ['RECEIVED', 'IN_PROGRESS'].indexOf(n) >= 0; });
      if (acts.length) h += '<div class="card"><h2>Xử lý</h2><div class="field"><label for="icNote">Nội dung</label><input id="icNote"></div>' +
        '<div class="field"><label for="icBefore">Ảnh trước xử lý (nếu có)</label><input id="icBefore" type="file" accept="image/*" capture="environment"></div>' +
        '<div class="field"><label for="icAfter">Ảnh sau xử lý (nếu có)</label><input id="icAfter" type="file" accept="image/*" capture="environment"></div><div class="row">' +
        acts.map(function (n) { return '<button class="btn" data-act="incActCt" data-id="' + i.incident_id + '" data-to="' + n + '">' + esc(IS[n]) + '</button>'; }).join('') + '</div></div>';
    }
    h += '<div class="card"><h2>Nhật ký xử lý</h2>' + i.actions.map(function (x) { return '<div class="check"><div style="flex:1"><div class="small muted">' + vnFull(x.action_at) + ' · ' + esc(x.actor) + '</div>' + esc(IS[x.status_after] || x.action_type) + (x.note ? ': ' + esc(x.note) : '') + '</div></div>'; }).join('') + '</div>';
    $app.innerHTML = h;
    i.photos.forEach(function (p) { loadPhoto(p.attachment_id, 'ic' + p.attachment_id); });
  }).catch(fail);
};
ACT.incActCt = function (d, el) {
  busy(el, true);
  var files = [['photo_before_id', $('icBefore').files[0], 'INCIDENT_BEFORE'], ['photo_after_id', $('icAfter').files[0], 'INCIDENT_AFTER']].filter(function (x) { return x[1]; });
  var payload = { incident_id: d.id, to_status: d.to, note: val('icNote') }, up = Promise.resolve();
  files.forEach(function (x) { up = up.then(function () { return readPhoto(x[1]); }).then(function (b64) { return api('files.upload', { data_base64: b64, mime_type: 'image/jpeg', evidence_type: x[2] }); }).then(function (r) { payload[x[0]] = r.attachment_id; }); });
  up.then(function () { return api('incidents.act', payload); }).then(function () { toast('Đã cập nhật sự cố.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); });
};
ACT.incAct = function (d, el) { busy(el, true); api('incidents.act', { incident_id: d.id, to_status: d.to, note: val('in' + d.id) }).then(function () { toast('Đã cập nhật sự cố.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };

// ================= XÁC NHẬN =================
ROUTES['xac-nhan'] = function () {
  api('quality-checks.pending').then(function (list) {
    var groups = {}; list.forEach(function (r) { (groups[r.assignment_point_id] = groups[r.assignment_point_id] || []).push(r); });
    var canQ = (S.me.authority || []).indexOf('QUALITY_CHECK') >= 0;
    var h = '<h1>Chờ xác nhận</h1><p class="sub">Đối chiếu tiêu chuẩn, ảnh, thời gian và vị trí. Không xác nhận đạt chỉ vì có ảnh hoặc GPS.</p>' + (canQ ? '' : VIEWONLY);
    if (!list.length) h += '<div class="card">Không có kết quả chờ xác nhận.</div>';
    Object.keys(groups).forEach(function (pid) {
      var rs = groups[pid], r0 = rs[0];
      h += '<div class="card bl-amber"><div class="row" style="justify-content:space-between"><h2>' + esc(r0.asset_code) + ' · điểm ' + esc(r0.seq_no) + '</h2><span class="sub">' + esc(r0.assignment_code) + '</span></div>' +
        '<div class="small muted">' + esc(r0.performer) + ' · bắt đầu ' + vnTime(r0.started_at) + ' · báo xong ' + vnTime(r0.submitted_at) + ' · ' + Math.round((r0.duration_seconds || 0) / 60) + ' phút' + (r0.sync_origin === 'OFFLINE_QUEUE' ? ' · gửi sau khi mất mạng' : '') + '</div>' +
        '<div class="small">GPS: ' + (r0.end_lat ? esc(r0.end_lat + ', ' + r0.end_lng + ' (±' + r0.end_acc + ' m)') : 'không có – ' + esc(r0.gps_missing_reason)) + '</div>' +
        '<div class="photos" style="margin:8px 0"><div><div class="small">Ảnh trước</div><img id="pb' + pid + '" class="photo" alt="Ảnh trước"></div><div><div class="small">Ảnh sau</div><img id="pa' + pid + '" class="photo" alt="Ảnh sau"></div></div>' +
        '<div><b>Nội dung:</b> ' + esc(r0.note) + '</div>' +
        rs.map(function (r) { return '<div class="check"><div style="flex:1"><b>' + esc(r.work_name) + '</b> ' + chip(SRC[r.source_type] || '', 'blue') + (r.is_rework ? ' ' + chip('Làm lại', 'amber') : '') + '<div class="small">Tiêu chuẩn: ' + esc(r.standard) + '</div></div>' +
          (canQ ? '<button class="btn sm ok" data-act="qc" data-ids="' + r.work_result_id + '" data-d="PASSED">Đạt</button>' : '') + '</div>'; }).join('') + (!canQ ? '</div>' :
        '<div class="field" style="margin-top:8px"><label for="qc' + pid + '">Lý do trả lại</label><input id="qc' + pid + '"></div><div class="row">' +
        '<button class="btn ok" data-act="qc" data-ids="' + rs.map(function (r) { return r.work_result_id; }).join(',') + '" data-d="PASSED">Xác nhận đạt cả điểm</button>' +
        '<button class="btn danger" data-act="qc" data-ids="' + rs.map(function (r) { return r.work_result_id; }).join(',') + '" data-d="RETURNED" data-pid="' + pid + '">Trả lại</button></div></div>');
    });
    $app.innerHTML = h;
    Object.keys(groups).forEach(function (pid) { loadPhoto(groups[pid][0].photo_before_id, 'pb' + pid); loadPhoto(groups[pid][0].photo_after_id, 'pa' + pid); });
  }).catch(fail);
};
ACT.qc = function (d, el) {
  var c = d.pid ? val('qc' + d.pid) : '';
  if (d.d === 'RETURNED' && !c) return toast('Nhập lý do trả lại.', 'err');
  busy(el, true);
  api('quality-checks.create', { work_result_ids: d.ids.split(','), decision: d.d, comment: c }).then(function () { toast(d.d === 'PASSED' ? 'Đã xác nhận đạt.' : 'Đã trả lại kết quả.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); });
};

// ================= CHỜ DUYỆT =================
var VIEWONLY = '<div style="margin-top:6px">' + chip('Chỉ xem – loại quyết định đã giao cho người có thẩm quyền', 'grey') + '</div>';
ROUTES['duyet'] = function () {
  api('approvals.pending').then(function (r) {
    var h = '<h1>Chờ duyệt</h1>';
    h += '<h2>Kế hoạch</h2>' + (r.plans.length ? r.plans.map(function (p) { return '<div class="card"><b>' + esc(p.plan_code) + '</b> · ' + dmy(p.period_from) + ' – ' + dmy(p.period_to) + ' · ' + esc(p.creator) + (p.self ? ' ' + chip('Do anh/chị lập – không tự duyệt', 'grey') : '') + ' <a class="btn sm sec" href="#/ke-hoach/' + p.plan_id + '">' + (r.can && r.can.plans ? 'Xem và duyệt' : 'Xem') + '</a></div>'; }).join('') : '<div class="card muted">Không có.</div>');
    h += '<h2>Ngoại lệ tuyến</h2>' + (r.exceptions.length ? r.exceptions.map(function (e) {
      return '<div class="card bl-amber"><b>' + esc(e.asset_code) + ' · điểm ' + esc(e.seq_no) + '</b> · ' + (e.scope === 'POINT' ? (e.request_type === 'REORDER' ? 'Đổi thứ tự' : 'Bỏ qua điểm') : 'Không làm hạng mục ' + esc(e.work_name)) +
        '<div class="small">Lý do: ' + esc(reasonLabel(e.reason_code)) + ' · ' + esc(e.description) + '</div><div class="small muted">' + esc(e.requester) + ' · ' + vnTime(e.requested_at) + '</div>' +
        (e.attachment_id ? '<img id="ea' + e.exception_id + '" class="photo" alt="Ảnh hiện trường">' : '') +
        (e.self ? chip('Do anh/chị đề nghị – không tự duyệt', 'grey') : !(r.can && r.can.exceptions) ? VIEWONLY : '<div class="field" style="margin-top:6px"><label for="en' + e.exception_id + '">Nội dung quyết định</label><input id="en' + e.exception_id + '"></div><div class="row"><button class="btn sm ok" data-act="exDecide" data-id="' + e.exception_id + '" data-d="APPROVED">Chấp thuận</button><button class="btn sm danger" data-act="exDecide" data-id="' + e.exception_id + '" data-d="REJECTED">Từ chối</button></div>') +
        '<p class="small muted">Chấp thuận không tự tính lần đến hạn là hoàn thành. Cần miễn hoặc dời: vào Lần đến hạn.</p></div>';
    }).join('') : '<div class="card muted">Không có.</div>');
    h += '<h2>Dời, miễn lần đến hạn</h2>' + (r.dispositions.length ? r.dispositions.map(function (x) {
      return '<div class="card"><b>' + esc(x.occurrence_code) + '</b> · ' + (x.disposition_type === 'WAIVED' ? 'Miễn thực hiện' : 'Dời đến ' + dmy(x.new_planned_date)) + '<div class="small">Lý do: ' + esc(x.reason) + (x.reference_document ? ' · Căn cứ: ' + esc(x.reference_document) : '') + '</div><div class="small muted">' + esc(x.requester) + '</div>' +
        (x.self ? chip('Do anh/chị đề nghị – không tự duyệt', 'grey') + ' <button class="btn sm sec" data-act="dsWithdraw" data-id="' + x.disposition_id + '">Rút đề nghị</button>' : !(r.can && r.can.dispositions) ? VIEWONLY : '<div class="field" style="margin-top:6px"><label for="dn' + x.disposition_id + '">Ý kiến</label><input id="dn' + x.disposition_id + '"></div><div class="row"><button class="btn sm ok" data-act="dsDecide" data-id="' + x.disposition_id + '" data-d="APPROVED">Duyệt</button><button class="btn sm danger" data-act="dsDecide" data-id="' + x.disposition_id + '" data-d="REJECTED">Từ chối</button></div>') + '</div>';
    }).join('') : '<div class="card muted">Không có.</div>');
    $app.innerHTML = h;
    r.exceptions.forEach(function (e) { if (e.attachment_id) loadPhoto(e.attachment_id, 'ea' + e.exception_id); });
  }).catch(fail);
};
function reasonLabel(c) { var x = (S.lists.exception_reasons || []).filter(function (r) { return r.code === c; })[0]; return x ? x.label : c; }
ACT.exDecide = function (d, el) { busy(el, true); api('route-exceptions.decide', { exception_id: d.id, decision: d.d, note: val('en' + d.id) }).then(function () { toast('Đã ghi quyết định.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.dsDecide = function (d, el) { busy(el, true); api('dispositions.decide', { disposition_id: d.id, decision: d.d, note: val('dn' + d.id) }).then(function () { toast('Đã ghi quyết định.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.dsWithdraw = function (d, el) { busy(el, true); api('dispositions.withdraw', { disposition_id: d.id }).then(function () { toast('Đã rút đề nghị.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };

// ================= DASHBOARD =================
ROUTES['dashboard'] = function (args) {
  var per = args[0] || 'month', ref = args[1] || today().slice(0, 7), nhom = args[2] && args[2] !== '-' ? args[2] : '', cum = args[3] || '';
  api('dashboard.station', { period: per, ref: ref, nhom: nhom, cum_id: cum }).then(function (d) {
    S.dash = { per: per, ref: ref };
    var k = d.kpi;
    // V1.2.2 (CR-03): bố cục theo hình minh họa và MD-04 Mục 4 – dải 5 chỉ số phụ trợ, 4 cột cố định
    var h = '<div class="row" style="justify-content:space-between;align-items:flex-end"><div><div class="sub" style="font-weight:600;letter-spacing:.06em">ĐẶT HÀNG TN-XLNT</div><h1>DASHBOARD ĐƠN VỊ / TRẠM</h1>' +
      '<div>Trạm: <b>' + esc(d.station || 'chưa có dữ liệu Trạm') + '</b> · Kỳ theo dõi: ' + esc(d.period.label) + '</div></div>' + periodPicker(per, ref, 'dashGo') + '</div>' +
      '<div class="row" style="margin-top:6px"><select id="dNhom" aria-label="Nhóm quản lý" style="width:auto"><option value="">Tất cả nhóm</option><option value="I"' + (nhom === 'I' ? ' selected' : '') + '>Nhóm I – Thoát nước thải</option><option value="II"' + (nhom === 'II' ? ' selected' : '') + '>Nhóm II – Thoát nước đô thị</option></select>' +
      '<select id="dCum" aria-label="Cụm tài sản" style="width:auto"><option value="">Tất cả cụm</option>' + (d.cum_options || []).map(function (c) { return '<option value="' + c.cum_id + '"' + (cum === c.cum_id ? ' selected' : '') + '>Nhóm ' + esc(c.nhom_code) + ' · ' + esc(c.name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="grid kpis5" style="margin:12px 0 6px">' + [['TỔNG TÀI SẢN', k.assets, ''], ['LẦN PHẢI LÀM', k.due, 'đã đến hạn trong kỳ'], ['ĐÃ ĐẠT', k.done, 'đã xác nhận đạt', 'var(--green)'], ['CHƯA ĐẠT', k.notDone, 'quá hạn ' + k.overdue, 'var(--red)'], ['SỰ CỐ', k.incOpen, 'chưa xử lý · ' + k.incPeriod + ' phát sinh trong kỳ', '#7C2D12']]
        .map(function (x) { return '<div class="card kpi" style="margin:0"><div class="l">' + x[0] + '</div><div class="v"' + (x[3] ? ' style="color:' + x[3] + '"' : '') + '>' + esc(x[1]) + '</div><div class="small muted">' + esc(x[2]) + '</div></div>'; }).join('') + '</div>' +
      '<p class="small muted" style="margin:0 0 6px">Chưa đến kỳ ' + k.notYet + ' (không tính chưa đạt) · Loại trừ theo quyết định ' + k.excluded + ' · Bổ sung ' + k.bosung + ' · Phát sinh ' + k.phatsinh + ' (thống kê riêng) · Cập nhật ' + vnTime(d.generated_at) + '</p>' + legend() +
      '<div class="grid cols4">' + d.columns.map(function (c) {
        var head = '<div class="colhead ' + (c.nhom_code === 'I' ? 'n1' : 'n2') + '"><div class="small" style="font-weight:700;letter-spacing:.06em">NHÓM ' + c.nhom_code + '</div><b>' + (c.kind === 'CUM' ? 'CỤM TÀI SẢN' : 'HẠNG MỤC CÔNG VIỆC') + '</b></div>';
        if (c.empty) return '<div class="col">' + head + '<div class="card c-grey small">' + (c.empty_reason === 'FILTERED' ? 'Không thuộc phạm vi lọc.' : c.empty_reason === 'NOT_MANAGED' ? 'Trạm không quản lý tài sản Nhóm ' + c.nhom_code + '.' :
          (c.kind === 'CUM' ? 'Chưa có cụm tài sản' : 'Chưa có hạng mục công việc') + ' Nhóm ' + c.nhom_code + '. Nhập dữ liệu nền tại mục Quản trị.') + '</div></div>';
        return '<div class="col">' + head + c.cards.map(function (x) {
          if (c.kind === 'CUM') return '<button class="dcard bl-' + x.color + '" data-act="drill" data-cum="' + x.cum_id + '" data-name="' + esc(x.name) + '"><div class="row" style="justify-content:space-between"><b>' + esc(x.name) + '</b>' + chip(COLOR[x.color], x.color) + '</div>' +
            '<div class="nums"><div><b>' + x.assets + '</b><span>tài sản</span></div><div><b style="color:#7C2D12">' + x.incOpen + '</b><span>sự cố chưa xử lý</span></div><div><b>' + x.incPeriod + '</b><span>sự cố trong kỳ</span></div></div></button>';
          var st = x.stat, pct = st.due ? Math.round(st.done * 100 / st.due) : 0;
          return '<button class="dcard bl-' + x.color + '" data-act="drill" data-work="' + x.work_id + '" data-name="' + esc(x.name) + '"><div class="row" style="justify-content:space-between"><b>' + esc(x.name) + '</b>' + chip(COLOR[x.color], x.color) + '</div>' +
            '<div class="nums"><div><b style="color:var(--green)">' + st.done + '/' + st.due + '</b><span>đạt</span></div><div><b style="color:var(--red)">' + st.notDone + '</b><span>chưa đạt</span></div><div><b style="color:#7C2D12">' + x.inc + '</b><span>sự cố</span></div></div>' +
            '<div class="bar"><div style="width:' + pct + '%;background:' + (x.color === 'red' ? '#C0392B' : x.color === 'green' ? '#1E7B45' : x.color === 'amber' ? '#C98A00' : '#1D4ED8') + '"></div></div>' +
            '<div class="small muted">Chưa đến kỳ ' + st.notYet + ' · Bổ sung ' + x.bosung + ' · Phát sinh ' + x.phatsinh + (x.excluded ? ' · Loại trừ ' + x.excluded : '') + '</div></button>';
        }).join('') + '</div>';
      }).join('') + '</div><p class="small muted">Bấm cụm / hạng mục để xem tài sản và từng lần thực hiện.</p>';
    $app.innerHTML = h;
  }).catch(fail);
};
ACT.dashGo = function () { var v = perVal(), n = val('dNhom'), c = val('dCum'); location.hash = '#/dashboard/' + v[0] + '/' + v[1] + (n || c ? '/' + (n || '-') + (c ? '/' + c : '') : ''); };
ACT.perChange = function () { var r = $('dRef'); if (r) r.hidden = val('dPer') === 'all'; };
// V1.2: bấm cụm → tài sản thuộc cụm; bấm hạng mục → tài sản áp dụng hạng mục
ACT.drill = function (d) { location.hash = '#/ds-tai-san/' + S.dash.per + '/' + S.dash.ref + '/' + (d.cum ? 'cum/' + d.cum : 'work/' + d.work); };
ROUTES['ds-tai-san'] = function (args) {
  var per = args[0] || 'month', ref = args[1] || today().slice(0, 7), kind = args[2], id = args[3];
  var q = { period: per, ref: ref }; q[kind === 'cum' ? 'cum_id' : 'work_id'] = id;
  api('dashboard.assets', q).then(function (r) {
    S.dash = { per: per, ref: ref };
    var h = '<a href="#/dashboard/' + per + '/' + ref + '">← Dashboard Trạm</a><div class="row" style="justify-content:space-between;align-items:flex-end;margin-top:8px"><div><div class="sub">' + (r.kind === 'CUM' ? 'Cụm tài sản' : 'Hạng mục công việc') + ' · ' + esc(r.period.label) + '</div><h1>' + esc(r.title) + '</h1><div class="small muted">' + r.assets.length + ' tài sản</div></div></div>' + legend();
    h += r.assets.length ? '<div class="tbl"><table><thead><tr><th>Tài sản</th>' + (r.kind === 'WORK' ? '<th>Cụm</th>' : '') + '<th>Phải thực hiện</th><th>Đã hoàn thành</th><th>Chưa hoàn thành</th><th>Chưa đến kỳ</th><th>Sự cố chưa xử lý</th><th>Trạng thái</th></tr></thead><tbody>' +
      r.assets.map(function (a) {
        return '<tr><td><a href="#/tai-san/' + a.asset_id + '/' + per + '/' + ref + '"><b>' + esc(a.asset_code) + '</b></a><div class="small">' + esc(a.asset_name) + '</div></td>' + (r.kind === 'WORK' ? '<td>' + esc(a.cum_name) + '</td>' : '') +
          '<td>' + a.stat.due + '</td><td style="color:var(--green)">' + a.stat.done + '</td><td style="color:var(--red)">' + a.stat.notDone + '</td><td>' + a.stat.notYet + '</td><td>' + a.incOpen + '</td><td>' + chip(COLOR[a.color], a.color) + '</td></tr>';
      }).join('') + '</tbody></table></div>' : '<div class="card muted">Không có tài sản.</div>';
    h += '<div class="card" style="margin-top:12px"><button class="btn sec" data-act="occAll" data-k="' + esc(kind) + '" data-id="' + esc(id) + '">Xem từng lần đến hạn</button><div id="occAll"></div></div>';
    $app.innerHTML = h;
  }).catch(fail);
};
ACT.occAll = function (d) {
  $('occAll').innerHTML = '<div class="loading">Đang tải…</div>';
  var q = { period: S.dash.per, ref: S.dash.ref }; q[d.k === 'cum' ? 'cum_id' : 'work_id'] = d.id;
  api('dashboard.drilldown', q).then(function (rows) { $('occAll').innerHTML = occTable(rows, false); }).catch(fail);
};

// ================= HỒ SƠ TÀI SẢN (V1.2, bản tổng hợp Mục 4) =================
ROUTES['tai-san'] = function (args) {
  var id = args[0], per = args[1] || 'month', ref = args[2] || today().slice(0, 7);
  api('assets.get', { asset_id: id, period: per, ref: ref }).then(function (r) {
    var a = r.asset, I = r.incidents;
    S.asset = { id: id };
    var h = '<a href="javascript:history.back()">← Quay lại</a><div class="row" style="justify-content:space-between;align-items:flex-end;margin-top:8px"><div><div class="sub">' + esc(a.nhom_name) + ' · ' + esc(a.cum_name) + '</div><h1>' + esc(a.asset_code) + '</h1><div>' + esc(a.asset_name) + '</div></div>' + periodPicker(per, ref, 'assetGo') + '</div>' +
      '<div class="row small" style="margin:8px 0"><a class="btn sm sec" href="#hs1" data-act="jump" data-to="hs1">1. Hồ sơ</a><a class="btn sm sec" href="#hs2" data-act="jump" data-to="hs2">2. Bảo dưỡng định kỳ</a><a class="btn sm sec" href="#hs3" data-act="jump" data-to="hs3">3. Sự cố</a><a class="btn sm sec" href="#hs4" data-act="jump" data-to="hs4">4. Lịch sử</a></div>';
    var f = [['Loại tài sản', a.asset_type], ['Tình trạng', a.asset_status], ['Vị trí', a.location_text], ['Tọa độ', mapLink(a.latitude, a.longitude)], ['Thông số kỹ thuật', a.technical_specs], ['Ngày bắt đầu quản lý', dmy(String(a.effective_from || '').slice(0, 10))], ['Nguồn hồ sơ', a.source_ref], ['Ghi chú', a.note]];
    h += '<div class="card" id="hs1"><h2>1. Hồ sơ tài sản</h2><div class="tbl"><table><tbody>' + f.map(function (x) { return '<tr><th style="width:38%">' + x[0] + '</th><td>' + (x[0] === 'Tọa độ' ? x[1] : esc(x[1])) + '</td></tr>'; }).join('') + '</tbody></table></div>' +
      '<h3 style="margin-top:12px">Hạng mục áp dụng</h3>' + (r.applied.length ? '<div class="tbl"><table><thead><tr><th>Hạng mục</th><th>Chu kỳ</th><th>Từ ngày</th></tr></thead><tbody>' + r.applied.map(function (w) { return '<tr><td>' + esc(w.work_name) + '</td><td>' + esc(w.cycle) + '</td><td>' + dmy(String(w.effective_from || '').slice(0, 10)) + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="muted small">Chưa có.</div>') + '</div>';
    var groups = {}; r.maintenance.forEach(function (o) { (groups[o.work_name] = groups[o.work_name] || []).push(o); });
    h += '<div class="card" id="hs2"><h2>2. Bảo dưỡng định kỳ · ' + esc(r.period.label) + '</h2>' + (r.maintenance.length ? Object.keys(groups).map(function (w) {
      var g = groups[w], ok = g.filter(function (o) { return o.state === 'PASSED'; }).length;
      return '<h3 style="margin-top:10px">' + esc(w) + ' <span class="small muted">' + ok + '/' + g.length + ' lần đã đạt</span></h3><div class="tbl"><table><thead><tr><th>Lần</th><th>Ngày đến hạn</th><th>Hạn hoàn thành</th><th>Trạng thái</th></tr></thead><tbody>' +
        g.map(function (o) { return '<tr><td><a href="#/lan/' + o.occurrence_id + '">Lần ' + esc(o.seq_in_period) + ' · ' + esc(o.period_key) + '</a></td><td>' + dmy(o.due_date) + (o.planned_date ? '<div class="small">dời đến ' + dmy(o.planned_date) + '</div>' : '') + '</td><td>' + dmy(o.completion_deadline) + '</td><td>' + chip(o.state_label, OC[o.state] || 'grey') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }).join('') : '<div class="muted">Không có lần đến hạn trong kỳ.</div>') + '</div>';
    h += '<div class="card" id="hs3"><h2>3. Sự cố phát sinh và xử lý · ' + esc(r.period.label) + '</h2><div class="grid kpis" style="margin-bottom:8px">' +
      [['Tổng số', I.total, ''], ['Đã xử lý', I.done, 'var(--green)'], ['Chưa xử lý', I.open, 'var(--red)'], ['Tái diễn', I.recurrence, '#7C2D12']].map(function (x) { return '<div class="kpi"><div class="v"' + (x[2] ? ' style="color:' + x[2] + '"' : '') + '>' + x[1] + '</div><div class="l">' + x[0] + '</div></div>'; }).join('') + '</div>' +
      (I.list.length ? I.list.map(function (i) { var gg = IG[i.group]; return '<a class="card bl-' + gg[1] + '" style="display:block;text-decoration:none;color:inherit;margin-bottom:6px" href="#/su-co-ct/' + i.incident_id + '"><b>' + esc(i.incident_code) + '</b> ' + chip(IS[i.status] || i.status, gg[1]) + (i.is_recurrence ? ' ' + chip('Tái diễn', 'red') : '') + '<div class="small">' + esc(i.description) + '</div><div class="small muted">' + vnTime(i.detected_at) + '</div></a>'; }).join('') : '<div class="muted">Không có sự cố trong kỳ.</div>') + '</div>';
    h += '<div class="card" id="hs4"><h2>4. Lịch sử tài sản</h2>' + (r.history.length ? r.history.map(function (x) {
      var link = x.occurrence_id ? '#/lan/' + x.occurrence_id : x.incident_id ? '#/su-co-ct/' + x.incident_id : '';
      return '<div class="check"><div style="flex:1"><div class="small muted">' + vnFull(x.at) + ' · ' + esc(x.kind) + (x.by ? ' · ' + esc(x.by) : '') + '</div>' + (link ? '<a href="' + link + '">' + esc(x.text) + '</a>' : esc(x.text)) + '</div></div>';
    }).join('') : '<div class="muted">Chưa có.</div>') + '</div>';
    $app.innerHTML = h;
  }).catch(fail);
};
ACT.assetGo = function () { var v = perVal(); location.hash = '#/tai-san/' + S.asset.id + '/' + v[0] + '/' + v[1]; };
ACT.jump = function (d) { var e = $(d.to); if (e) e.scrollIntoView({ behavior: 'smooth' }); };

// ================= CHI TIẾT TỪNG LẦN THỰC HIỆN (V1.2, bản tổng hợp Mục 3.5) =================
ROUTES['lan'] = function (args) {
  api('occurrences.detail', { occurrence_id: args[0] }).then(function (r) {
    var o = r.occurrence;
    var h = '<a href="javascript:history.back()">← Quay lại</a><div class="card" style="margin-top:8px"><div class="sub">' + esc(o.occurrence_code) + '</div><h1>' + esc(o.work_name) + ' · lần ' + esc(o.seq_in_period) + '</h1>' +
      '<div><a href="#/tai-san/' + o.asset_id + '"><b>' + esc(o.asset_code) + '</b></a> · ' + esc(o.asset_name) + '</div>' +
      '<div class="small">Kỳ ' + esc(o.period_key) + ' · Đến hạn ' + dmy(o.due_date) + ' · Hạn hoàn thành ' + dmy(o.completion_deadline) + (o.planned_date ? ' · Dời đến ' + dmy(o.planned_date) : '') + '</div>' +
      (o.quality_standard_text ? '<div class="small">Tiêu chuẩn: ' + esc(o.quality_standard_text) + '</div>' : '') + '<div style="margin-top:6px">' + chip(o.state_label, OC[o.state] || 'grey') + '</div></div>';
    if (!r.results.length) h += '<div class="card muted">Chưa có lần thực hiện.</div>';
    r.results.forEach(function (x, k) {
      h += '<div class="card"><div class="row" style="justify-content:space-between"><h2>Lần thực hiện ' + (k + 1) + (x.is_rework ? ' ' + chip('Làm lại', 'amber') : '') + '</h2>' + chip(RS[x.result_status] || x.result_status, x.result_status === 'PASSED' ? 'green' : x.result_status === 'RETURNED' ? 'red' : 'amber') + '</div>' +
        '<div class="tbl"><table><tbody>' +
        [['Người thực hiện', esc(x.performer) + (x.assignment_code ? ' <span class="small muted">(' + esc(x.assignment_code) + ')</span>' : '')], ['Bắt đầu', vnFull(x.started_at)], ['Kết thúc', vnFull(x.submitted_at)], ['Thời lượng', x.submitted_at ? dur(x.duration_seconds) : ''],
          ['GPS bắt đầu', mapLink(x.start_lat, x.start_lng, x.start_acc)], ['GPS kết thúc', mapLink(x.end_lat, x.end_lng, x.end_acc) || esc(x.gps_missing_reason ? 'Không có – ' + x.gps_missing_reason : '')],
          ['Nội dung kết quả', esc(x.note)], ['Ghi nhận', x.sync_origin === 'OFFLINE_QUEUE' ? 'Gửi sau khi mất mạng; giờ trên máy ' + esc(vnFull(x.device_time)) : 'Trực tuyến']]
          .map(function (y) { return '<tr><th style="width:34%">' + y[0] + '</th><td>' + y[1] + '</td></tr>'; }).join('') + '</tbody></table></div>' +
        '<div class="photos" style="margin:8px 0"><div><div class="small">Ảnh trước</div><img id="rb' + x.work_result_id + '" class="photo" alt="Ảnh trước"></div><div><div class="small">Ảnh sau</div><img id="ra' + x.work_result_id + '" class="photo" alt="Ảnh sau"></div></div>' +
        '<h3>Xác nhận</h3>' + (x.checks.length ? x.checks.map(function (q) { return '<div class="small">' + vnFull(q.checked_at) + ' · ' + esc(q.checker) + ' · <b>' + (q.decision === 'PASSED' ? 'Đạt' : 'Trả lại') + '</b>' + (q.comment ? ': ' + esc(q.comment) : '') + '</div>'; }).join('') : '<div class="small muted">Chưa xác nhận.</div>') + '</div>';
    });
    $app.innerHTML = h;
    r.results.forEach(function (x) { loadPhoto(x.photo_before_id, 'rb' + x.work_result_id); loadPhoto(x.photo_after_id, 'ra' + x.work_result_id); });
  }).catch(fail);
};
var RS = { IN_PROGRESS: 'Đang thực hiện', SUBMITTED: 'Chờ xác nhận', PASSED: 'Đạt', RETURNED: 'Bị trả lại', CANCELLED: 'Đã hủy' };
var OC = { PASSED: 'green', OVERDUE: 'red', OPEN: 'blue', NOT_YET: 'grey', EXCLUDED: 'dark' };
function occTable(rows, actions) {
  if (!rows.length) return '<div class="muted">Không có lần đến hạn.</div>';
  return '<div class="tbl"><table><thead><tr><th>Tài sản</th><th>Hạng mục</th><th>Lần</th><th>Ngày đến hạn</th><th>Hạn hoàn thành</th><th>Trạng thái</th>' + (actions ? '<th></th>' : '') + '</tr></thead><tbody>' +
    rows.map(function (o) { return '<tr><td><b>' + esc(o.asset_code) + '</b></td><td>' + esc(o.work_name) + '</td><td><a href="#/lan/' + o.occurrence_id + '">' + esc(o.seq_in_period) + '</a></td><td>' + dmy(o.due_date) + (o.planned_date ? '<div class="small">dời đến ' + dmy(o.planned_date) + '</div>' : '') + '</td><td>' + dmy(o.completion_deadline) + '</td><td>' + chip(o.state_label, OC[o.state] || 'grey') + (o.disposition_pending ? '<div class="small">đề nghị đang chờ duyệt</div>' : '') + '</td>' +
      (actions ? '<td>' + (o.state !== 'PASSED' && o.state !== 'EXCLUDED' && !o.disposition_pending ? '<button class="btn sm sec" data-act="dsForm" data-id="' + o.occurrence_id + '" data-code="' + esc(o.occurrence_code) + '" data-dl="' + o.completion_deadline + '">Dời / miễn</button>' : '') + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>';
}

// ================= LẦN ĐẾN HẠN =================
ROUTES['lan-den-han'] = function () {
  var f = S.occF = S.occF || { from: today().slice(0, 8) + '01', to: today(), state: '' };
  api('occurrences.list', f).then(function (rows) {
    $app.innerHTML = '<h1>Lần đến hạn</h1><div class="card row"><div><label for="oFrom">Từ ngày</label><input id="oFrom" type="date" value="' + f.from + '"></div><div><label for="oTo">Đến ngày</label><input id="oTo" type="date" value="' + f.to + '"></div>' +
      '<div><label for="oState">Trạng thái</label><select id="oState"><option value="">Tất cả</option><option value="OVERDUE"' + (f.state === 'OVERDUE' ? ' selected' : '') + '>Quá hạn</option><option value="OPEN"' + (f.state === 'OPEN' ? ' selected' : '') + '>Chưa hoàn thành, còn hạn</option><option value="PASSED"' + (f.state === 'PASSED' ? ' selected' : '') + '>Đã đạt</option><option value="EXCLUDED"' + (f.state === 'EXCLUDED' ? ' selected' : '') + '>Đã loại trừ</option><option value="NOT_YET"' + (f.state === 'NOT_YET' ? ' selected' : '') + '>Chưa đến kỳ</option></select></div>' +
      '<div style="align-self:flex-end"><button class="btn" data-act="occGo">Lọc</button></div></div><div id="dsBox"></div>' + occTable(rows, true);
  }).catch(fail);
};
ACT.occGo = function () { S.occF = { from: val('oFrom'), to: val('oTo'), state: val('oState') }; route(); };
ACT.dsForm = function (d) {
  $('dsBox').innerHTML = '<div class="card bl-blue"><h2>Đề nghị xử lý ' + esc(d.code) + '</h2><div class="field"><label for="dsType">Loại</label><select id="dsType"><option value="RESCHEDULED">Dời ngày thực hiện (không quá hạn hoàn thành ' + dmy(d.dl) + ')</option><option value="WAIVED">Miễn thực hiện – loại khỏi số phải thực hiện</option></select></div>' +
    '<div class="field"><label for="dsDate">Ngày mới (khi dời)</label><input id="dsDate" type="date" max="' + d.dl + '"></div><div class="field"><label for="dsReason">Lý do</label><textarea id="dsReason"></textarea></div>' +
    '<div class="field"><label for="dsRef">Căn cứ (biên bản, văn bản)</label><input id="dsRef"></div><button class="btn" data-act="dsSend" data-id="' + d.id + '">Gửi đề nghị</button> <span class="small muted">Người đề nghị không tự duyệt.</span></div>';
  $('dsBox').scrollIntoView({ behavior: 'smooth' });
};
ACT.dsSend = function (d, el) { busy(el, true); api('dispositions.create', { occurrence_id: d.id, disposition_type: val('dsType'), new_planned_date: val('dsDate'), reason: val('dsReason'), reference_document: val('dsRef') }).then(function () { toast('Đã gửi đề nghị.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };

// ================= KẾ HOẠCH =================
ROUTES['ke-hoach'] = function (args) {
  if (args[0]) return planDetail(args[0]);
  api('plans.list').then(function (list) {
    var t = today();
    $app.innerHTML = '<h1>Kế hoạch bảo dưỡng</h1><div class="card"><h2>Lập kế hoạch mới</h2><div class="row"><div><label for="pFrom">Từ ngày</label><input id="pFrom" type="date" value="' + t + '"></div><div><label for="pTo">Đến ngày</label><input id="pTo" type="date"></div><div style="align-self:flex-end"><button class="btn" data-act="planNew">Tạo kế hoạch</button></div></div></div>' +
      (list.length ? '<div class="tbl"><table><thead><tr><th>Mã</th><th>Kỳ</th><th>Trạng thái</th><th>Dòng / đã giao</th></tr></thead><tbody>' + list.map(function (p) { return '<tr><td><a href="#/ke-hoach/' + p.plan_id + '">' + esc(p.plan_code) + '</a></td><td>' + dmy(p.period_from) + ' – ' + dmy(p.period_to) + '</td><td>' + esc(PS[p.plan_status] || p.plan_status) + '</td><td>' + p.items + ' / ' + p.assigned + '</td></tr>'; }).join('') + '</tbody></table></div>' : '<div class="card muted">Chưa có kế hoạch.</div>');
  }).catch(fail);
};
ACT.planNew = function (d, el) { busy(el, true); api('plans.create', { period_from: val('pFrom'), period_to: val('pTo') }).then(function (p) { location.hash = '#/ke-hoach/' + p.plan_id; }).catch(function (e) { busy(el, false); fail(e); }); };
function planDetail(id) {
  api('plans.get', { plan_id: id }).then(function (r) {
    var p = r.plan, edit = ['DRAFT', 'RETURNED'].indexOf(p.plan_status) >= 0, auth = S.me.authority.indexOf('PLAN_APPROVE') >= 0;
    var h = '<a href="#/ke-hoach">← Danh sách kế hoạch</a><div class="card" style="margin-top:8px"><div class="row" style="justify-content:space-between"><div><h1>' + esc(p.plan_code) + '</h1><div class="sub">' + dmy(p.period_from) + ' – ' + dmy(p.period_to) + ' · Lập bởi ' + esc(r.creator) + '</div></div>' + chip(PS[p.plan_status], p.plan_status === 'APPROVED' ? 'green' : p.plan_status === 'SUBMITTED' ? 'amber' : 'grey') + '</div>' +
      (p.decision_note ? '<div class="small">Ý kiến: ' + esc(p.decision_note) + '</div>' : '') + '</div>';
    if (edit) h += '<div class="card"><h2>Thêm việc theo tuyến</h2><div class="row"><div style="flex:1;min-width:180px"><label for="aRoute">Tuyến</label><select id="aRoute">' + S.lists.routes.map(function (x) { return '<option value="' + x.route_id + '">' + esc(x.route_name) + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="aDate">Ngày thực hiện</label><input id="aDate" type="date" min="' + p.period_from + '" max="' + p.period_to + '" value="' + p.period_from + '"></div><div style="align-self:flex-end"><button class="btn sec" data-act="suggest" data-id="' + p.plan_id + '">Lấy lần đến hạn</button></div></div><div id="sugBox"></div></div>';
    var groups = {}; r.items.forEach(function (i) { var k = i.planned_date + ' · ' + i.route_name; (groups[k] = groups[k] || []).push(i); });
    h += '<div class="card"><h2>Nội dung kế hoạch (' + r.items.length + ' dòng)</h2>' + (Object.keys(groups).length ? Object.keys(groups).sort().map(function (k) {
      return '<h3 style="margin-top:10px">' + dmy(k.slice(0, 10)) + k.slice(10) + '</h3><div class="tbl"><table><tbody>' + groups[k].map(function (i) { return '<tr><td><b>' + esc(i.asset_code) + '</b></td><td>' + esc(i.work_name) + '</td><td>đến hạn ' + dmy(i.due_date) + '</td><td>' + (i.assigned ? chip('Đã giao', 'green') : '') + '</td><td>' + (edit ? '<button class="btn sm danger" data-act="rmItem" data-id="' + i.plan_item_id + '">Bỏ</button>' : '') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    }).join('') : '<div class="muted">Chưa có dòng nào.</div>') + '</div>';
    var btns = [];
    if (edit) btns.push('<button class="btn" data-act="planSubmit" data-id="' + p.plan_id + '">Trình duyệt</button>');
    if (p.plan_status === 'SUBMITTED' && auth && p.created_by !== S.me.user_id) h += '<div class="card bl-amber"><h2>Quyết định</h2><div class="field"><label for="pNote">Ý kiến (bắt buộc khi trả lại, không duyệt)</label><input id="pNote"></div><div class="row"><button class="btn ok" data-act="planDecide" data-id="' + p.plan_id + '" data-d="APPROVED">Duyệt</button><button class="btn sec" data-act="planDecide" data-id="' + p.plan_id + '" data-d="RETURNED">Trả lại</button><button class="btn danger" data-act="planDecide" data-id="' + p.plan_id + '" data-d="REJECTED">Không duyệt</button></div></div>';
    if (p.plan_status === 'APPROVED') btns.push('<a class="btn" href="#/giao-viec/' + p.plan_id + '">Giao việc</a>');
    if (auth && ['CANCELLED', 'REJECTED', 'CLOSED'].indexOf(p.plan_status) < 0) btns.push('<button class="btn danger" data-act="planCancel" data-id="' + p.plan_id + '">Hủy kế hoạch</button>');
    if (btns.length) h += '<div class="row">' + btns.join('') + '</div>';
    h += '<div class="card" style="margin-top:12px"><h3>Lịch sử</h3>' + r.approvals.map(function (a) { return '<div class="small">' + vnTime(a.acted_at) + ' · ' + esc(a.actor) + ' · ' + esc(PS[a.action] || a.action) + (a.note ? ': ' + esc(a.note) : '') + '</div>'; }).join('') + '</div>';
    $app.innerHTML = h;
  }).catch(fail);
}
ACT.suggest = function (d) {
  var route_id = val('aRoute'), date = val('aDate');
  api('plans.suggest', { plan_id: d.id, route_id: route_id, date: date }).then(function (rows) {
    $('sugBox').innerHTML = rows.length ? '<p class="small muted">Đánh dấu sẵn các lần đến hạn đến ngày ' + dmy(date) + '. Lần quá hạn hiển thị chữ đỏ.</p>' + rows.map(function (o) {
      return '<label class="check" style="font-weight:400"><input type="checkbox" class="sugChk" value="' + o.occurrence_id + '"' + (o.default_checked ? ' checked' : '') + '><span><b>' + o.seq_on_route + '. ' + esc(o.asset_code) + '</b> · ' + esc(o.work_name) + ' · đến hạn ' + dmy(o.due_date) + (o.overdue ? ' <span class="err">quá hạn</span>' : '') + '</span></label>';
    }).join('') + '<button class="btn" data-act="addItems" data-id="' + d.id + '" data-r="' + route_id + '" data-date="' + date + '">Thêm vào kế hoạch</button>' : '<p class="muted">Không còn lần đến hạn chưa lập kế hoạch trên tuyến này.</p>';
  }).catch(fail);
};
ACT.addItems = function (d, el) {
  var ids = Array.prototype.slice.call(document.querySelectorAll('.sugChk:checked')).map(function (x) { return x.value; });
  if (!ids.length) return toast('Chưa chọn lần đến hạn.', 'err');
  busy(el, true); api('plans.add-items', { plan_id: d.id, route_id: d.r, date: d.date, occurrence_ids: ids }).then(function (r) { toast('Đã thêm ' + r.added + ' dòng.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); });
};
ACT.rmItem = function (d, el) { busy(el, true); api('plans.remove-item', { plan_item_id: d.id }).then(function () { route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.planSubmit = function (d, el) { busy(el, true); api('plans.submit', { plan_id: d.id }).then(function () { toast('Đã trình duyệt.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.planDecide = function (d, el) { busy(el, true); api('plans.decide', { plan_id: d.id, decision: d.d, note: val('pNote') }).then(function () { toast('Đã ghi quyết định.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.planCancel = function (d, el) {
  var box = $('cancelBox');
  if (!box) { el.insertAdjacentHTML('afterend', '<div id="cancelBox" class="card bl-red" style="width:100%"><label for="cReason">Lý do hủy</label><input id="cReason"><button class="btn danger" style="margin-top:8px" data-act="planCancel" data-id="' + d.id + '">Xác nhận hủy</button></div>'); return; }
  busy(el, true); api('plans.cancel', { plan_id: d.id, reason: val('cReason') }).then(function () { toast('Đã hủy kế hoạch.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); });
};

// ================= GIAO VIỆC =================
ROUTES['giao-viec'] = function (args) {
  if (args[0]) return assignBoard(args[0]);
  api('plans.list').then(function (list) {
    var ok = list.filter(function (p) { return p.plan_status === 'APPROVED'; }), L = S.lists;
    $app.innerHTML = '<h1>Giao việc</h1><div class="card"><h2>Theo kế hoạch đã duyệt</h2>' + (ok.length ? ok.map(function (p) { return '<div class="row" style="justify-content:space-between;border-top:1px solid #E3E7EC;padding:8px 0"><span><b>' + esc(p.plan_code) + '</b> · ' + dmy(p.period_from) + ' – ' + dmy(p.period_to) + ' · đã giao ' + p.assigned + '/' + p.items + '</span><a class="btn sm" href="#/giao-viec/' + p.plan_id + '">Mở</a></div>'; }).join('') : '<div class="muted">Chưa có kế hoạch đã duyệt.</div>') + '</div>' +
      '<div class="card"><h2>Nhiệm vụ đơn lẻ: bảo dưỡng bổ sung, công việc phát sinh</h2><p class="small muted">Không cộng vào số lần phải thực hiện định kỳ. Giao trực tiếp người lao động.</p>' +
      '<div class="field"><label for="sType">Loại</label><select id="sType"><option value="BAO_DUONG_BO_SUNG">Bảo dưỡng bổ sung (hạng mục đã có chu kỳ)</option><option value="PHAT_SINH">Công việc phát sinh</option></select></div>' +
      '<div class="field"><label for="sAsset">Tài sản</label><select id="sAsset">' + L.assets.map(function (a) { return '<option value="' + a.asset_id + '">' + esc(a.asset_code + ' – ' + a.asset_name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="sWork">Hạng mục</label><select id="sWork"><option value="">– Không chọn (phát sinh, ghi mô tả) –</option>' + L.works.map(function (w) { return '<option value="' + w.work_id + '">' + esc(w.work_name) + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="sDesc">Mô tả công việc (phát sinh)</label><input id="sDesc"></div><div class="field"><label for="sReason">Lý do giao</label><input id="sReason"></div>' +
      '<div class="row"><div style="flex:1;min-width:180px"><label for="sUser">Người nhận</label><select id="sUser">' + L.workers.map(function (u) { return '<option value="' + u.user_id + '">' + esc(u.full_name + ' (' + u.employee_code + ')') + '</option>'; }).join('') + '</select></div>' +
      '<div><label for="sDate">Ngày</label><input id="sDate" type="date" value="' + today() + '"></div><div><label for="sDue">Hạn (giờ)</label><input id="sDue" type="time" value="16:30"></div></div>' +
      '<button class="btn" style="margin-top:10px" data-act="assignSingle">Giao nhiệm vụ</button></div>';
  }).catch(fail);
};
ACT.assignSingle = function (d, el) { busy(el, true); api('assign.single', { source_type: val('sType'), asset_id: val('sAsset'), work_id: val('sWork'), adhoc_description: val('sDesc'), reason: val('sReason'), assignee_id: val('sUser'), date: val('sDate'), due_time: val('sDue') }).then(function (r) { toast('Đã giao ' + r.assignment_code + '.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
function assignBoard(planId) {
  api('assign.board', { plan_id: planId }).then(function (r) {
    var L = S.lists, dates = {};
    var h = '<a href="#/giao-viec">← Giao việc</a><h1 style="margin-top:8px">Giao việc – ' + esc(r.plan.plan_code) + '</h1><p class="sub">Giao trực tiếp từng người lao động. Kế hoạch ngày tiếp theo được công bố từ 20 giờ khi mọi dòng của ngày đã giao.</p>';
    r.groups.forEach(function (g) {
      dates[g.planned_date] = dates[g.planned_date] || { pub: g.published, open: 0 }; dates[g.planned_date].open += g.unassigned;
      var gid = (g.planned_date + g.route_id).replace(/[^a-z0-9]/gi, '');
      h += '<div class="card ' + (g.unassigned ? 'bl-amber' : 'bl-green') + '"><div class="row" style="justify-content:space-between"><h3>' + dmy(g.planned_date) + ' · ' + esc(g.route_name) + '</h3>' + (g.published ? chip('Đã công bố', 'green') : chip('Chưa công bố', 'grey')) + '</div>' +
        '<div class="small">' + g.items + ' dòng · chưa giao ' + g.unassigned + '</div>' +
        g.assignments.map(function (a) { return '<div class="row small" style="border-top:1px solid #E3E7EC;padding:6px 0;justify-content:space-between"><span>' + esc(a.assignee) + ' · ' + esc(AS[a.status] || a.status) + '</span><span class="row">' +
          (['ASSIGNED', 'ACCEPTED'].indexOf(a.status) >= 0 ? '<button class="btn sm danger" data-act="asgCancel" data-id="' + a.assignment_id + '">Hủy giao</button>' : '') +
          (['IN_PROGRESS', 'SUBMITTED'].indexOf(a.status) >= 0 ? '<button class="btn sm danger" data-act="asgClose" data-id="' + a.assignment_id + '">Đóng chưa hoàn tất</button>' : '') + '</span></div>'; }).join('') +
        (g.unassigned ? '<div class="row" style="margin-top:8px"><div style="flex:1;min-width:180px"><label for="u' + gid + '">Người nhận</label><select id="u' + gid + '">' + L.workers.map(function (u) { return '<option value="' + u.user_id + '">' + esc(u.full_name + ' (' + u.employee_code + ')') + '</option>'; }).join('') + '</select></div>' +
          '<div><label for="t' + gid + '">Hạn (giờ)</label><input id="t' + gid + '" type="time" value="16:30"></div><div style="align-self:flex-end"><button class="btn" data-act="assignRoute" data-plan="' + planId + '" data-r="' + g.route_id + '" data-date="' + g.planned_date + '" data-g="' + gid + '">Giao</button></div></div>' : '') + '</div>';
    });
    var pubBtns = Object.keys(dates).filter(function (x) { return !dates[x].pub && !dates[x].open; });
    if (pubBtns.length && S.me.authority.indexOf('PLAN_APPROVE') >= 0) h += '<div class="card"><h3>Công bố thủ công</h3><p class="small muted">Dùng khi đã qua giờ chạy bù hoặc cần công bố ngay.</p>' + pubBtns.map(function (x) { return '<button class="btn sm sec" data-act="publish" data-plan="' + planId + '" data-date="' + x + '">Công bố ngày ' + dmy(x) + '</button> '; }).join('') + '</div>';
    $app.innerHTML = h;
  }).catch(fail);
}
ACT.assignRoute = function (d, el) { busy(el, true); api('assign.route', { plan_id: d.plan, route_id: d.r, date: d.date, assignee_id: val('u' + d.g), due_time: val('t' + d.g) }).then(function (r) { toast('Đã giao ' + r.assignment_code + ' (' + r.points + ' điểm).', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.publish = function (d, el) { busy(el, true); api('plans.publish', { plan_id: d.plan, date: d.date }).then(function (r) { toast('Đã công bố, gửi ' + r.notifications + ' thông báo.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
function reasonPrompt(el, act, id) {
  var bid = 'rb' + id;
  if (!$(bid)) { el.insertAdjacentHTML('afterend', '<div id="' + bid + '" style="width:100%"><label for="ri' + id + '">Lý do</label><input id="ri' + id + '"><button class="btn sm danger" style="margin-top:6px" data-act="' + act + '" data-id="' + id + '" data-go="1">Xác nhận</button></div>'); return null; }
  return val('ri' + id);
}
ACT.asgCancel = function (d, el) { var r = reasonPrompt(el, 'asgCancel', d.id); if (r === null) return; busy(el, true); api('assign.cancel', { assignment_id: d.id, reason: r }).then(function () { toast('Đã hủy giao việc.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.asgClose = function (d, el) { var r = reasonPrompt(el, 'asgClose', d.id); if (r === null) return; busy(el, true); api('assign.close', { assignment_id: d.id, reason: r }).then(function () { toast('Đã đóng giao việc.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };

// ================= THÔNG BÁO =================
ROUTES['thong-bao'] = function () {
  api('notifications.list').then(function (ns) {
    $app.innerHTML = '<div class="row" style="justify-content:space-between"><h1>Thông báo</h1><button class="btn sm sec" data-act="readAll">Đánh dấu đã đọc</button></div>' +
      (ns.length ? ns.map(function (n) { return '<a class="card" style="display:block;text-decoration:none;color:inherit' + (n.read_at ? ';opacity:.7' : '') + '" href="' + esc(n.link || '#/') + '"><b>' + esc(n.title) + '</b><div class="small">' + esc(n.body) + '</div><div class="small muted">' + vnTime(n.created_at) + '</div></a>'; }).join('') : '<div class="card muted">Không có thông báo.</div>');
  }).catch(fail);
};
ACT.readAll = function () { api('notifications.read', { ids: [] }).then(function () { refreshBell(); route(); }).catch(fail); };

// ================= QUẢN TRỊ =================
ROUTES['quan-tri'] = function () {
  api('admin.status').then(function (s) {
    $app.innerHTML = '<h1>Quản trị</h1><p class="sub">Phiên bản ' + esc(s.version) + '</p>' +
      '<div class="card"><h2>1. Nhập dữ liệu nền</h2><p class="small">Tải file Excel mẫu bản 1.1 lên Google Drive, mở bằng Google Trang tính, sao chép ID trong đường dẫn (đoạn giữa /d/ và /edit).</p><div class="field"><label for="srcId">ID file nguồn</label><input id="srcId"></div>' +
      '<div class="row"><button class="btn sec" data-act="imp" data-dry="1">Kiểm tra trước</button><button class="btn" data-act="imp">Nhập dữ liệu</button></div><div id="impOut"></div></div>' +
      '<div class="card"><h2>2. Sinh lần đến hạn</h2><div class="row"><div><label for="gFrom">Từ ngày</label><input id="gFrom" type="date" value="' + today().slice(0, 8) + '01"></div><div><label for="gTo">Đến ngày</label><input id="gTo" type="date"></div><div style="align-self:flex-end"><button class="btn" data-act="gen">Sinh</button></div></div><p class="small muted">Chạy lại không tạo trùng. Hệ thống tự chạy 01:00 hằng ngày sau khi cài trình kích hoạt.</p></div>' +
      '<div class="card"><h2>3. Trình kích hoạt</h2><div class="small">Đang có: ' + (s.triggers.length ? esc(s.triggers.join(', ')) : 'chưa cài') + '</div><button class="btn sec" style="margin-top:8px" data-act="trig">Cài lại trình kích hoạt</button></div>' +
      '<div class="card"><h2>Số bản ghi</h2><div class="tbl"><table><tbody>' + Object.keys(s.counts).map(function (k) { return '<tr><td>' + k + '</td><td>' + s.counts[k] + '</td></tr>'; }).join('') + '</tbody></table></div></div>' +
      '<div class="card"><h2>Cấu hình</h2><div class="tbl"><table><tbody>' + Object.keys(s.config).map(function (k) { return '<tr><td>' + k + '</td><td>' + esc(s.config[k]) + '</td></tr>'; }).join('') + '</tbody></table></div><p class="small muted">Sửa trong Apps Script: Cài đặt dự án › Thuộc tính tập lệnh.</p></div>' +
      '<div class="card"><h2>Tác vụ nền gần đây</h2>' + (s.jobs.length ? s.jobs.map(function (j) { return '<div class="small">' + vnTime(j.started_at) + ' · ' + esc(j.job_name) + ' · ' + esc(j.status) + (j.is_catch_up === true || j.is_catch_up === 'TRUE' ? ' · chạy bù' : '') + ' · ' + esc(j.detail).slice(0, 160) + '</div>'; }).join('') : '<div class="muted small">Chưa có.</div>') + '</div>';
  }).catch(fail);
};
ACT.imp = function (d, el) {
  busy(el, true);
  api('admin.import', { source_spreadsheet_id: val('srcId'), dry_run: !!d.dry }).then(function (r) {
    busy(el, false);
    $('impOut').innerHTML = '<div class="banner ' + (r.ok ? 'c-green' : 'c-red') + '">' + (r.ok ? (r.dry_run ? 'Kiểm tra đạt. Có thể nhập.' : 'Đã nhập.') : esc(r.message)) + '</div>' +
      (r.errors.length ? '<div class="small err">' + r.errors.map(esc).join('<br>') + '</div>' : '') + '<div class="small">' + Object.keys(r.counts).map(function (k) { return k + ': ' + r.counts[k]; }).join(' · ') + '</div>';
    if (r.ok && !r.dry_run) api('lists.get').then(function (l) { S.lists = l; });
  }).catch(function (e) { busy(el, false); fail(e); });
};
ACT.gen = function (d, el) { busy(el, true); api('admin.generate', { from: val('gFrom'), to: val('gTo') }).then(function (r) { busy(el, false); toast('Tạo mới ' + r.created + ', bỏ qua trùng ' + r.skipped_duplicate + ', chu kỳ không tự sinh ' + r.skipped_rule + '.', 'ok'); }).catch(function (e) { busy(el, false); fail(e); }); };
ACT.trig = function (d, el) { busy(el, true); api('admin.install-triggers').then(function () { toast('Đã cài trình kích hoạt.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };

// ---------- khởi động ----------
renderNet();
CFG = load('cfg', {});
api('public.config').then(function (c) { CFG = c || {}; save('cfg', CFG); }).catch(function () {})
  .then(function () { if (S.token) boot(); else showLogin(); });
})();
