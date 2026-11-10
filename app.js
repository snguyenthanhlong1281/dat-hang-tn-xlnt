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
  if (m.is_manager) { it.push(['sep', 'QUẢN LÝ TRẠM']); it.push(['dashboard', 'Dashboard Trạm']); it.push(['ke-hoach', 'Kế hoạch']); it.push(['giao-viec', 'Giao việc']); it.push(['lan-den-han', 'Lần đến hạn']); }
  if (a.QUALITY_CHECK) it.push(['xac-nhan', 'Chờ xác nhận']);
  if (a.PLAN_APPROVE || a.ROUTE_EXCEPTION || a.OCC_DISPOSITION) it.push(['duyet', 'Chờ duyệt']);
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
    S.me = me; $('stationName').textContent = me.don_vi_name || 'Quản lý tài sản';
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
var COLOR = { red: 'Quá hạn', amber: 'Đang thực hiện / sắp đến hạn', green: 'Đạt tiến độ', blue: 'Còn hạn', grey: 'Chưa đến kỳ' };
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
    var h = '<h1>Nhiệm vụ của tôi</h1>';
    if (errQ.length) h += '<div class="card bl-red"><h3>Thao tác bị máy chủ từ chối</h3>' + errQ.map(function (q) { return '<div class="small">' + esc(q.label) + ': ' + esc(q.error) + ' <button class="btn sm danger" data-act="dropQ" data-key="' + q.key + '">Bỏ thao tác</button></div>'; }).join('') + '</div>';
    if (!list.length) h += '<div class="card">Chưa có nhiệm vụ được công bố. Kế hoạch ngày tiếp theo được công bố từ 20 giờ.</div>';
    list.forEach(function (a) {
      h += '<div class="card"><div class="row" style="justify-content:space-between"><div><h2>' + esc(a.route_name) + '</h2><div class="sub">Ngày ' + dmy(a.work_date) + ' · Hạn ' + esc(String(a.due_at).slice(11, 16)) + ' · ' + esc(a.assignment_code) + '</div>' +
        (a.reason ? '<div class="small">Lý do giao: ' + esc(a.reason) + '</div>' : '') + '</div>' + chip(AS[a.status] || a.status, a.status === 'COMPLETED' ? 'green' : 'blue') + '</div>' +
        '<div class="grid kpis" style="margin:10px 0"><div class="kpi"><div class="v">' + a.total + '</div><div class="l">phải làm</div></div><div class="kpi"><div class="v" style="color:var(--amber)">' + a.submitted + '</div><div class="l">đã báo hoàn thành</div></div>' +
        '<div class="kpi"><div class="v" style="color:var(--green)">' + a.verified + '</div><div class="l">đã xác nhận đạt</div></div><div class="kpi"><div class="v">' + a.remaining + '</div><div class="l">còn lại</div></div></div>' +
        (!a.accepted ? '<button class="btn big" data-act="accept" data-id="' + a.assignment_id + '">TIẾP NHẬN NHIỆM VỤ</button><div style="height:10px"></div>' : '');
      var pts = a.points.slice().sort(function (x, y) { return (x.point_status === 'RETURNED' ? 0 : 1) - (y.point_status === 'RETURNED' ? 0 : 1) || x.seq_no - y.seq_no; });
      pts.forEach(function (p) {
        var ls = localStatus(p);
        h += '<button class="point bl-' + ls[1] + '" data-act="openPoint" data-a="' + a.assignment_id + '" data-p="' + p.assignment_point_id + '"' + (p.point_status === 'LOCKED' ? ' style="opacity:.75"' : '') + '>' +
          '<div class="num c-' + ls[1] + '">' + p.seq_no + '</div><div style="flex:1;min-width:0"><b>' + esc(p.asset_code) + '</b> · ' + esc(p.asset_name) + '<div class="small muted">' + esc(p.location_text || '') + '</div>' +
          '<div class="small">' + p.items.map(function (i) { return esc(i.work_name); }).join(' · ') + '</div>' + chip(ls[0], ls[1]) +
          (p.items.some(function (i) { return i.return_comment; }) && p.point_status === 'RETURNED' ? '<div class="small err">Trả lại: ' + esc(p.items.filter(function (i) { return i.return_comment; })[0].return_comment) + '</div>' : '') + '</div></button>';
      });
      h += '</div>';
    });
    h += '<button class="btn big warn" data-act="newIncident">GHI NHẬN SỰ CỐ</button>';
    $app.innerHTML = h;
  }).catch(function (e) { if (e.network && S.tasks) { toast('Mất kết nối: đang hiển thị dữ liệu đã tải.', 'info'); } else fail(e); });
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
ROUTES['su-co'] = function (args) {
  var g = args[0] || '';
  api('incidents.list', { group: g }).then(function (list) {
    var mgr = S.me.is_manager, canClose = S.me.authority.indexOf('INCIDENT_CLOSE') >= 0;
    var h = '<div class="row" style="justify-content:space-between"><h1>Sự cố</h1><button class="btn warn" data-act="newIncident">Ghi nhận sự cố</button></div><div class="row" style="margin:8px 0">' +
      [['', 'Tất cả'], ['OPEN', 'Chưa xử lý'], ['HANDLING', 'Đang xử lý'], ['MONITORING', 'Theo dõi'], ['DONE', 'Đã xử lý']].map(function (x) { return '<a class="btn sm ' + (g === x[0] ? '' : 'sec') + '" href="#/su-co/' + x[0] + '">' + x[1] + '</a>'; }).join('') + '</div>';
    if (!list.length) h += '<div class="card">Không có sự cố.</div>';
    list.forEach(function (i) {
      var gg = IG[i.group];
      h += '<div class="card bl-' + gg[1] + '"><div class="row" style="justify-content:space-between"><b>' + esc(i.incident_code) + ' · ' + esc(i.asset_code) + '</b>' + chip(IS[i.status] || i.status, gg[1]) + '</div>' +
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
ACT.incAct = function (d, el) { busy(el, true); api('incidents.act', { incident_id: d.id, to_status: d.to, note: val('in' + d.id) }).then(function () { toast('Đã cập nhật sự cố.', 'ok'); route(); }).catch(function (e) { busy(el, false); fail(e); }); };

// ================= XÁC NHẬN =================
ROUTES['xac-nhan'] = function () {
  api('quality-checks.pending').then(function (list) {
    var groups = {}; list.forEach(function (r) { (groups[r.assignment_point_id] = groups[r.assignment_point_id] || []).push(r); });
    var h = '<h1>Chờ xác nhận</h1><p class="sub">Đối chiếu tiêu chuẩn, ảnh, thời gian và vị trí. Không xác nhận đạt chỉ vì có ảnh hoặc GPS.</p>';
    if (!list.length) h += '<div class="card">Không có kết quả chờ xác nhận.</div>';
    Object.keys(groups).forEach(function (pid) {
      var rs = groups[pid], r0 = rs[0];
      h += '<div class="card bl-amber"><div class="row" style="justify-content:space-between"><h2>' + esc(r0.asset_code) + ' · điểm ' + esc(r0.seq_no) + '</h2><span class="sub">' + esc(r0.assignment_code) + '</span></div>' +
        '<div class="small muted">' + esc(r0.performer) + ' · bắt đầu ' + vnTime(r0.started_at) + ' · báo xong ' + vnTime(r0.submitted_at) + ' · ' + Math.round((r0.duration_seconds || 0) / 60) + ' phút' + (r0.sync_origin === 'OFFLINE_QUEUE' ? ' · gửi sau khi mất mạng' : '') + '</div>' +
        '<div class="small">GPS: ' + (r0.end_lat ? esc(r0.end_lat + ', ' + r0.end_lng + ' (±' + r0.end_acc + ' m)') : 'không có – ' + esc(r0.gps_missing_reason)) + '</div>' +
        '<div class="photos" style="margin:8px 0"><div><div class="small">Ảnh trước</div><img id="pb' + pid + '" class="photo" alt="Ảnh trước"></div><div><div class="small">Ảnh sau</div><img id="pa' + pid + '" class="photo" alt="Ảnh sau"></div></div>' +
        '<div><b>Nội dung:</b> ' + esc(r0.note) + '</div>' +
        rs.map(function (r) { return '<div class="check"><div style="flex:1"><b>' + esc(r.work_name) + '</b> ' + chip(SRC[r.source_type] || '', 'blue') + (r.is_rework ? ' ' + chip('Làm lại', 'amber') : '') + '<div class="small">Tiêu chuẩn: ' + esc(r.standard) + '</div></div>' +
          '<button class="btn sm ok" data-act="qc" data-ids="' + r.work_result_id + '" data-d="PASSED">Đạt</button></div>'; }).join('') +
        '<div class="field" style="margin-top:8px"><label for="qc' + pid + '">Lý do trả lại</label><input id="qc' + pid + '"></div><div class="row">' +
        '<button class="btn ok" data-act="qc" data-ids="' + rs.map(function (r) { return r.work_result_id; }).join(',') + '" data-d="PASSED">Xác nhận đạt cả điểm</button>' +
        '<button class="btn danger" data-act="qc" data-ids="' + rs.map(function (r) { return r.work_result_id; }).join(',') + '" data-d="RETURNED" data-pid="' + pid + '">Trả lại</button></div></div>';
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
ROUTES['duyet'] = function () {
  api('approvals.pending').then(function (r) {
    var h = '<h1>Chờ duyệt</h1>';
    h += '<h2>Kế hoạch</h2>' + (r.plans.length ? r.plans.map(function (p) { return '<div class="card"><b>' + esc(p.plan_code) + '</b> · ' + dmy(p.period_from) + ' – ' + dmy(p.period_to) + ' · ' + esc(p.creator) + (p.self ? ' ' + chip('Do anh/chị lập – không tự duyệt', 'grey') : '') + ' <a class="btn sm sec" href="#/ke-hoach/' + p.plan_id + '">Xem và duyệt</a></div>'; }).join('') : '<div class="card muted">Không có.</div>');
    h += '<h2>Ngoại lệ tuyến</h2>' + (r.exceptions.length ? r.exceptions.map(function (e) {
      return '<div class="card bl-amber"><b>' + esc(e.asset_code) + ' · điểm ' + esc(e.seq_no) + '</b> · ' + (e.scope === 'POINT' ? (e.request_type === 'REORDER' ? 'Đổi thứ tự' : 'Bỏ qua điểm') : 'Không làm hạng mục ' + esc(e.work_name)) +
        '<div class="small">Lý do: ' + esc(reasonLabel(e.reason_code)) + ' · ' + esc(e.description) + '</div><div class="small muted">' + esc(e.requester) + ' · ' + vnTime(e.requested_at) + '</div>' +
        (e.attachment_id ? '<img id="ea' + e.exception_id + '" class="photo" alt="Ảnh hiện trường">' : '') +
        (e.self ? chip('Do anh/chị đề nghị – không tự duyệt', 'grey') : '<div class="field" style="margin-top:6px"><label for="en' + e.exception_id + '">Nội dung quyết định</label><input id="en' + e.exception_id + '"></div><div class="row"><button class="btn sm ok" data-act="exDecide" data-id="' + e.exception_id + '" data-d="APPROVED">Chấp thuận</button><button class="btn sm danger" data-act="exDecide" data-id="' + e.exception_id + '" data-d="REJECTED">Từ chối</button></div>') +
        '<p class="small muted">Chấp thuận không tự tính lần đến hạn là hoàn thành. Cần miễn hoặc dời: vào Lần đến hạn.</p></div>';
    }).join('') : '<div class="card muted">Không có.</div>');
    h += '<h2>Dời, miễn lần đến hạn</h2>' + (r.dispositions.length ? r.dispositions.map(function (x) {
      return '<div class="card"><b>' + esc(x.occurrence_code) + '</b> · ' + (x.disposition_type === 'WAIVED' ? 'Miễn thực hiện' : 'Dời đến ' + dmy(x.new_planned_date)) + '<div class="small">Lý do: ' + esc(x.reason) + (x.reference_document ? ' · Căn cứ: ' + esc(x.reference_document) : '') + '</div><div class="small muted">' + esc(x.requester) + '</div>' +
        (x.self ? chip('Do anh/chị đề nghị – không tự duyệt', 'grey') + ' <button class="btn sm sec" data-act="dsWithdraw" data-id="' + x.disposition_id + '">Rút đề nghị</button>' : '<div class="field" style="margin-top:6px"><label for="dn' + x.disposition_id + '">Ý kiến</label><input id="dn' + x.disposition_id + '"></div><div class="row"><button class="btn sm ok" data-act="dsDecide" data-id="' + x.disposition_id + '" data-d="APPROVED">Duyệt</button><button class="btn sm danger" data-act="dsDecide" data-id="' + x.disposition_id + '" data-d="REJECTED">Từ chối</button></div>') + '</div>';
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
  var per = args[0] || 'month', ref = args[1] || today().slice(0, 7);
  api('dashboard.station', { period: per, ref: ref }).then(function (d) {
    S.dash = { per: per, ref: ref };
    var k = d.kpi;
    var h = '<div class="row" style="justify-content:space-between;align-items:flex-end"><div><div class="sub" style="font-weight:600;letter-spacing:.06em">ĐẶT HÀNG TN-XLNT</div><h1>QUẢN LÝ TÀI SẢN</h1><div>' + esc(d.station) + ' · ' + esc(d.period.label) + '</div></div>' +
      '<div class="row"><select id="dPer" aria-label="Kỳ" style="width:auto"><option value="month"' + (per === 'month' ? ' selected' : '') + '>Tháng</option><option value="quarter"' + (per === 'quarter' ? ' selected' : '') + '>Quý</option><option value="year"' + (per === 'year' ? ' selected' : '') + '>Năm</option></select>' +
      '<input id="dRef" type="month" value="' + ref + '" aria-label="Tháng tham chiếu" style="width:auto"><button class="btn" data-act="dashGo">Xem</button></div></div>' +
      '<p class="small muted">Tính theo ngày đến hạn. Cập nhật lúc ' + vnTime(d.generated_at) + '. Kỳ đã qua: số đã hoàn thành có thể tăng do xác nhận sau kỳ.</p>' +
      '<div class="grid kpis" style="margin:10px 0">' + [['Tổng số tài sản', k.assets, ''], ['Phải thực hiện', k.due, 'lần đã đến hạn'], ['Đã hoàn thành', k.done, 'đã xác nhận đạt', 'var(--green)'], ['Chưa hoàn thành', k.notDone, 'quá hạn ' + k.overdue, 'var(--red)'],
        ['Chưa đến kỳ', k.notYet, 'không tính chưa hoàn thành'], ['Loại trừ theo quyết định', k.excluded, 'miễn đã duyệt'], ['Sự cố', k.incOpen + ' chưa xử lý', k.incPeriod + ' phát sinh trong kỳ', '#7C2D12'], ['Bổ sung / phát sinh', k.bosung + ' / ' + k.phatsinh, 'thống kê riêng']]
        .map(function (x) { return '<div class="card kpi" style="margin:0"><div class="l">' + x[0] + '</div><div class="v"' + (x[3] ? ' style="color:' + x[3] + '"' : '') + '>' + esc(x[1]) + '</div><div class="small muted">' + esc(x[2]) + '</div></div>'; }).join('') + '</div>' +
      '<div class="grid cols4">' + d.columns.map(function (c) {
        var cls = c.empty ? 'off' : c.nhom_code === 'I' ? 'n1' : 'n2';
        var head = '<div class="colhead ' + cls + '"><div class="small" style="font-weight:700;letter-spacing:.06em">NHÓM ' + c.nhom_code + (c.nhom_code === 'I' ? ' · THOÁT NƯỚC THẢI' : ' · THOÁT NƯỚC ĐÔ THỊ') + '</div><b>' + (c.kind === 'CUM' ? 'Cụm tài sản' : 'Hạng mục công việc') + '</b></div>';
        if (c.empty) return '<div class="col">' + head + '<div class="card c-grey">Trạm không quản lý tài sản thuộc Nhóm ' + c.nhom_code + '</div></div>';
        return '<div class="col">' + head + c.cards.map(function (x) {
          if (c.kind === 'CUM') return '<button class="dcard bl-' + x.color + '" data-act="drill" data-cum="' + x.cum_id + '" data-name="' + esc(x.name) + '"><div class="row" style="justify-content:space-between"><b>' + esc(x.name) + '</b>' + chip(COLOR[x.color], x.color) + '</div>' +
            '<div class="nums"><div><b>' + x.assets + '</b><span>tài sản</span></div><div><b>' + x.incOpen + '</b><span>sự cố chưa xử lý</span></div><div><b>' + x.incPeriod + '</b><span>sự cố trong kỳ</span></div></div></button>';
          var st = x.stat, pct = st.due ? Math.round(st.done * 100 / st.due) : 0;
          return '<button class="dcard bl-' + x.color + '" data-act="drill" data-work="' + x.work_id + '" data-name="' + esc(x.name) + '"><div class="row" style="justify-content:space-between"><b>' + esc(x.name) + '</b>' + chip(COLOR[x.color], x.color) + '</div>' +
            '<div class="nums"><div><b style="color:var(--green)">' + st.done + '/' + st.due + '</b><span>đã hoàn thành</span></div><div><b style="color:var(--red)">' + st.notDone + '</b><span>chưa hoàn thành</span></div><div><b style="color:#7C2D12">' + x.inc + '</b><span>sự cố phát sinh</span></div></div>' +
            '<div class="bar"><div style="width:' + pct + '%;background:' + (x.color === 'red' ? '#C0392B' : x.color === 'green' ? '#1E7B45' : x.color === 'amber' ? '#C98A00' : '#1D4ED8') + '"></div></div>' +
            '<div class="small muted">Chưa đến kỳ ' + st.notYet + ' · Bổ sung ' + x.bosung + ' · Phát sinh ' + x.phatsinh + (x.excluded ? ' · Loại trừ ' + x.excluded : '') + '</div></button>';
        }).join('') + '</div>';
      }).join('') + '</div><div id="drill"></div>';
    $app.innerHTML = h;
  }).catch(fail);
};
ACT.dashGo = function () { location.hash = '#/dashboard/' + val('dPer') + '/' + (val('dRef') || today().slice(0, 7)); };
ACT.drill = function (d) {
  $('drill').innerHTML = '<div class="loading">Đang tải…</div>';
  api('dashboard.drilldown', { period: S.dash.per, ref: S.dash.ref, work_id: d.work || '', cum_id: d.cum || '' }).then(function (rows) {
    $('drill').innerHTML = '<div class="card" style="margin-top:14px"><h2>' + esc(d.name) + ' – từng lần đến hạn</h2>' + occTable(rows, false) + '</div>';
    $('drill').scrollIntoView({ behavior: 'smooth' });
  }).catch(fail);
};
var OC = { PASSED: 'green', OVERDUE: 'red', OPEN: 'blue', NOT_YET: 'grey', EXCLUDED: 'dark' };
function occTable(rows, actions) {
  if (!rows.length) return '<div class="muted">Không có lần đến hạn.</div>';
  return '<div class="tbl"><table><thead><tr><th>Tài sản</th><th>Hạng mục</th><th>Lần</th><th>Ngày đến hạn</th><th>Hạn hoàn thành</th><th>Trạng thái</th>' + (actions ? '<th></th>' : '') + '</tr></thead><tbody>' +
    rows.map(function (o) { return '<tr><td><b>' + esc(o.asset_code) + '</b></td><td>' + esc(o.work_name) + '</td><td>' + esc(o.seq_in_period) + '</td><td>' + dmy(o.due_date) + (o.planned_date ? '<div class="small">dời đến ' + dmy(o.planned_date) + '</div>' : '') + '</td><td>' + dmy(o.completion_deadline) + '</td><td>' + chip(o.state_label, OC[o.state] || 'grey') + (o.disposition_pending ? '<div class="small">đề nghị đang chờ duyệt</div>' : '') + '</td>' +
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
