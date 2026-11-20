"use strict";
const ICONS = {
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a2 2 0 0 1-2-2V5.5a2 2 0 0 1 2-2Z"/><path d="M14 3.5v5h5M8.5 13h7M8.5 16.5h5"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 12.5 4.2 4.2L19 7"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></svg>',
  users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="9" cy="8" r="3.5"/><path d="M3 20c0-3.1 2.5-5.5 5.5-5.5h1c3 0 5.5 2.4 5.5 5.5M16 5.2a3.5 3.5 0 0 1 0 6.7M17 15c2.3.5 4 2.4 4 5"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 3 19 6v5c0 4.8-3 8-7 10-4-2-7-5.2-7-10V6l7-3Z"/><path d="m9 12 2 2 4-4"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M4 19.5h16M7 16V10m5 6V5m5 11v-4"/></svg>'
};
const MAX_ATTACHMENT_BYTES = 1.5 * 1024 * 1024;
const MAX_ATTACHMENT_COUNT = 5;
const ATTACHMENT_TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".pdf": "application/pdf" };
const SERVICES = [
  { name: "Surat Keterangan Tidak Mampu", short: "SKTM", icon: ICONS.users },
  { name: "Surat Keterangan Usaha", short: "SKU", icon: ICONS.file },
  { name: "Pengantar KTP / KK", short: "Administrasi", icon: ICONS.shield },
  { name: "Surat Keterangan Pindah", short: "Kependudukan", icon: ICONS.pin }
];
const PAGES = { dashboard: "Ringkasan", permohonan: "Permohonan", warga: "Data warga", surat: "Arsip surat", analitik: "Analitik" };
let requests = [];
let currentPage = "dashboard";
let role = "Operator Kelurahan";
let currentUser = null;
let listFilter = "Semua status";
const ROLE_PAGES = {
  "Operator Kelurahan": ["dashboard", "permohonan", "warga", "surat", "analitik"],
  "Lurah / Seklur": ["dashboard", "permohonan", "surat", "analitik"],
  "Warga / Pemohon": ["dashboard", "permohonan", "surat"]
};

async function apiFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  let payload;
  try { payload = await response.json(); }
  catch (error) { throw new Error("Respons server tidak valid."); }
  if (!response.ok) throw new Error(payload.error || "Permintaan gagal diproses.");
  return payload;
}
async function loadRequests() {
  const payload = await apiFetch("/api/requests");
  requests = payload.requests;
  return requests;
}
function escapeHTML(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}
function readAttachment(file) {
  const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
  const type = ATTACHMENT_TYPES[extension];
  if (!type || (file.type && file.type !== type)) return Promise.reject(new Error(`Format berkas ${file.name} tidak didukung.`));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error(`Berkas ${file.name} gagal dibaca.`));
        return;
      }
      resolve({ name: file.name, size: file.size, type, dataUrl: reader.result });
    };
    reader.onerror = () => reject(reader.error || new Error(`Berkas ${file.name} gagal dibaca.`));
    reader.readAsDataURL(file);
  });
}
function attachmentMarkup(file, requestId, index) {
  const attachment = typeof file === "string" ? { name: file } : file;
  const name = escapeHTML(attachment.name || "Berkas tanpa nama");
  const type = attachment.type;
  const supported = Object.values(ATTACHMENT_TYPES).includes(type);
  const fileUrl = attachment.available && supported
    ? `/api/requests/${encodeURIComponent(requestId)}/attachments/${index}`
    : "";
  const thumbnail = fileUrl && type.startsWith("image/")
    ? `<img class="attachment-preview" src="${fileUrl}" alt="Pratinjau ${name}">`
    : `<div class="attachment-file-icon">${type === "application/pdf" ? "PDF" : "FILE"}</div>`;
  const actions = fileUrl
    ? `<div class="attachment-actions"><a href="${fileUrl}" target="_blank" rel="noopener noreferrer">Buka berkas</a><a href="${fileUrl}?download=1">Unduh</a></div>`
    : '<span class="attachment-meta">Pratinjau tidak tersedia</span>';
  const size = Number(attachment.size) > 0 ? `${Math.ceil(attachment.size / 1024)} KB` : "Lampiran";
  return `<div class="attachment-card">${thumbnail}<div><span class="attachment-name">${name}</span><span class="attachment-meta">${size}</span>${actions}</div></div>`;
}
function initials(name) { return String(name || "").split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase(); }
function statusClass(status) {
  if (status === "Selesai") return "status-done";
  if (status === "Ditolak") return "status-rejected";
  if (status === "Menunggu tanda tangan") return "status-sign";
  return "status-review";
}
function badge(status) { return `<span class="status ${statusClass(status)}">${escapeHTML(status)}</span>`; }
function visibleRequests() {
  if (role === "Warga / Pemohon") return requests.filter(item => item.ownerEmail === currentUser?.email);
  return requests;
}
function serviceRequestCount(service) {
  return requests.filter(item => item.type === service.name
    || (service.short === "Administrasi" && item.type === "Surat Pengantar KTP / KK")).length;
}
function activityChartMarkup() {
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 6 + index));
    const key = date.toISOString().slice(0, 10);
    const count = requests.filter(item => String(item.createdAt || "").slice(0, 10) === key).length;
    return { date, count };
  });
  const max = Math.max(1, ...days.map(day => day.count));
  const points = days.map((day, index) => ({
    x: 45 + index * (565 / 6),
    y: 134 - (day.count / max) * 114,
    count: day.count,
    date: day.date
  }));
  const line = points.map(point => `${point.x},${point.y}`).join(" ");
  const area = `${points[0].x},136 ${line} ${points[points.length - 1].x},136`;
  const labels = points.map(point => `<text class="chart-label" x="${point.x - 12}" y="158">${point.date.toLocaleDateString("id-ID", { day: "2-digit", month: "short", timeZone: "UTC" })}</text>`).join("");
  const dots = points.map(point => `<circle class="chart-point" cx="${point.x}" cy="${point.y}" r="3.5"><title>${point.count} permohonan</title></circle>`).join("");
  const tickValues = [max, Math.round(max / 2), 0];
  const ticks = tickValues.map((value, index) => {
    const y = 20 + index * 57;
    return `<line class="chart-grid" x1="45" y1="${y}" x2="610" y2="${y}"/><text class="chart-label" x="9" y="${y + 3}">${value}</text>`;
  }).join("");
  return `<svg viewBox="0 0 620 180" role="img" aria-label="Permohonan per hari, tujuh hari terakhir"><defs><linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#4ca986" stop-opacity=".2"/><stop offset="1" stop-color="#4ca986" stop-opacity="0"/></linearGradient></defs>${ticks}<polygon class="chart-area" points="${area}"/><polyline class="chart-line" points="${line}"/>${dots}${labels}</svg>`;
}
function canCreateRequest() { return role === "Warga / Pemohon"; }
function canViewRequest(item) { return role !== "Warga / Pemohon" || item.ownerEmail === currentUser?.email; }
function canVerify(item) { return role === "Operator Kelurahan" && item.status === "Menunggu verifikasi"; }
function canApprove(item) { return role === "Lurah / Seklur" && item.status === "Menunggu tanda tangan"; }
function canReject(item) {
  return (role === "Operator Kelurahan" && item.status === "Menunggu verifikasi")
    || (role === "Lurah / Seklur" && item.status === "Menunggu tanda tangan");
}
function filteredRequests() {
  const search = (document.getElementById("request-search")?.value || "").trim().toLowerCase();
  return visibleRequests().filter(item => {
    const matchStatus = listFilter === "Semua status" || item.status === listFilter;
    const matchSearch = !search || [item.id, item.name, item.type, item.nik].some(value => String(value || "").toLowerCase().includes(search));
    return matchStatus && matchSearch;
  });
}
function requestRows(rows) {
  if (!rows.length) return '<tr><td colspan="6"><div class="empty-state">Belum ada permohonan yang cocok dengan pencarian.</div></td></tr>';
  return rows.map(item => `<tr>
        <td><span class="ticket">${escapeHTML(item.id)}</span></td>
        <td><div class="person-cell"><div class="person-avatar">${escapeHTML(initials(item.name))}</div><div><strong>${escapeHTML(item.name)}</strong><span>NIK ${escapeHTML(item.nik || "-")}</span></div></div></td>
        <td>${escapeHTML(item.type)}</td><td>${escapeHTML(item.date)}</td><td>${badge(item.status)}</td>
        <td><button class="row-action" data-action="detail" data-id="${escapeHTML(item.id)}">Lihat detail</button></td>
      </tr>`).join("");
}
function tableMarkup(rows) {
  return `<div class="table-scroll"><table><thead><tr><th>No. tiket</th><th>Pemohon</th><th>Jenis layanan</th><th>Tanggal</th><th>Status</th><th>Aksi</th></tr></thead><tbody id="request-rows">${requestRows(rows)}</tbody></table></div>`;
}
function renderTableRows() {
  const target = document.getElementById("request-rows");
  if (target) target.innerHTML = requestRows(filteredRequests());
  const count = document.getElementById("table-count");
  if (count) count.textContent = `Menampilkan ${filteredRequests().length} permohonan`;
}
function statCard(label, value, note, icon, color, trend) {
  return `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon ${color}">${icon}</span></div><div class="stat-number">${value}</div><div class="stat-foot"><span class="trend">${trend}</span><span>${note}</span></div></article>`;
}
function citizenDashboardPage() {
  const mine = visibleRequests();
  const waiting = mine.filter(item => item.status === "Menunggu verifikasi" || item.status === "Menunggu tanda tangan").length;
  const done = mine.filter(item => item.status === "Selesai").length;
  return `<div class="page-content">
        <div class="page-heading"><div><div class="eyebrow">Portal warga</div><h1>Halo, ${escapeHTML(currentUser?.name || "Warga")} 👋</h1><p class="subtitle">Pantau permohonan milik Anda. Verifikasi berkas dilakukan oleh operator kelurahan.</p></div><div class="heading-actions"><button class="button button-primary" data-action="new-request">${ICONS.plus} Ajukan surat</button></div></div>
        <div class="stats-grid">${statCard("Permohonan saya", mine.length, "pengajuan tercatat", ICONS.file, "green", "Total")}${statCard("Sedang diproses", waiting, "oleh petugas kelurahan", ICONS.clock, "orange", "Proses")}${statCard("Surat selesai", done, "siap dilihat", ICONS.check, "green", "Selesai")}</div>
        <section class="panel table-panel"><div class="panel-head"><div><h2 class="panel-title">Permohonan saya</h2><p class="panel-subtitle">Status dapat dipantau; verifikasi dan persetujuan dilakukan petugas berwenang.</p></div></div>${tableMarkup(mine)}<div class="table-footer"><span>${mine.length} permohonan milik akun ini</span><span>Data tersimpan di server</span></div></section>
        <p class="data-note">Akun pemohon hanya dapat melihat pengajuan yang terhubung ke akunnya dan membuat permohonan baru.</p>
      </div>`;
}
function dashboardPage() {
  const waiting = requests.filter(r => r.status === "Menunggu verifikasi").length;
  const signed = requests.filter(r => r.status === "Menunggu tanda tangan").length;
  const done = requests.filter(r => r.status === "Selesai").length;
  return `<div class="page-content">
        <div class="page-heading"><div><div class="eyebrow">Ringkasan pelayanan</div><h1>Selamat datang, ${escapeHTML(currentUser?.name || "Petugas")} 👋</h1><p class="subtitle">Pantau permohonan administrasi Kelurahan Cihideung.</p></div><div class="heading-actions"><button class="button button-secondary" id="export-button">${ICONS.download} Ekspor laporan</button><button class="button button-primary" data-action="new-request">${ICONS.plus} Buat permohonan</button></div></div>
        <div class="stats-grid">
          ${statCard("Total permohonan", requests.length, "tersimpan di sistem", ICONS.file, "green", "Total")}
          ${statCard("Menunggu verifikasi", waiting, "perlu ditindaklanjuti", ICONS.clock, "orange", "Dalam antrean")}
          ${statCard("Menunggu tanda tangan", signed, "siap diperiksa Lurah", ICONS.shield, "blue", "Perlu pengesahan")}
          ${statCard("Surat selesai", done, "selesai diproses", ICONS.check, "green", "Selesai")}
        </div>
        <div class="content-grid">
          <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Aktivitas pelayanan</h2><p class="panel-subtitle">Permohonan per hari · 7 hari terakhir</p></div><div class="chart-legend"><span class="legend-dot"></span> Permohonan</div></div>
            <div class="chart-wrap">${activityChartMarkup()}</div>
          </section>
          <section class="panel"><div class="panel-head"><div><h2 class="panel-title">Layanan terpopuler</h2><p class="panel-subtitle">Berdasarkan semua permohonan</p></div><button class="row-action" data-page="analitik">Lihat analitik</button></div>
            <div class="service-list">${SERVICES.map(item => `<div class="service-row"><div class="service-icon">${item.icon}</div><div class="service-info"><strong>${item.short}</strong><span>${item.name}</span></div><span class="service-number">${serviceRequestCount(item)}</span></div>`).join("")}</div>
          </section>
        </div>
        <section class="panel table-panel"><div class="panel-head"><div><h2 class="panel-title">Permohonan terbaru</h2><p class="panel-subtitle">Pantau dan tindak lanjuti pengajuan warga</p></div><button class="row-action" data-page="permohonan">Lihat semua &nbsp; →</button></div>
          <div class="toolbar-line"><div class="table-tools"><div class="search-box">${ICONS.search}<input id="request-search" type="search" placeholder="Cari nama atau nomor tiket..." aria-label="Cari permohonan"></div><select class="filter-select" id="status-filter" aria-label="Filter status"><option>Semua status</option><option>Menunggu verifikasi</option><option>Menunggu tanda tangan</option><option>Selesai</option><option>Ditolak</option></select></div></div>
          ${tableMarkup(filteredRequests().slice(0, 5))}
          <div class="table-footer"><span id="table-count">Menampilkan ${Math.min(requests.length, 5)} permohonan</span><span>Data tersimpan di server</span></div>
        </section>
        <div class="two-column"><section class="panel quick-card" data-action="new-request"><div class="service-icon">${ICONS.plus}</div><div><strong>Ajukan surat baru</strong><span>Mulai permohonan administrasi kependudukan</span></div><span class="quick-arrow">→</span></section><section class="panel quick-card" data-page="surat"><div class="service-icon">${ICONS.file}</div><div><strong>Arsip surat digital</strong><span>Akses dokumen terbit dan nomor surat</span></div><span class="quick-arrow">→</span></section></div>
        <p class="data-note">Data permohonan tersimpan pada server. Verifikasi NIK Dukcapil, tanda tangan elektronik BSrE, dan notifikasi eksternal memerlukan integrasi resmi.</p>
      </div>`;
}
function requestsPage() {
  const visible = visibleRequests();
  return `<div class="page-content"><div class="page-heading"><div><div class="eyebrow">Pelayanan warga</div><h1>Permohonan surat</h1><p class="subtitle">Verifikasi kelengkapan berkas dan pantau status layanan.</p></div><div class="heading-actions"><button class="button button-primary" data-action="new-request">${ICONS.plus} Buat permohonan</button></div></div>
        <div class="stats-grid">
          ${statCard("Permohonan", visible.length, role === "Warga / Pemohon" ? "milik akun ini" : "data kelurahan", ICONS.file, "green", "Total")}
          ${statCard("Menunggu verifikasi", visible.filter(r => r.status === "Menunggu verifikasi").length, role === "Warga / Pemohon" ? "menunggu operator" : "perlu ditindaklanjuti", ICONS.clock, "orange", "Antrean")}
          ${statCard("Menunggu tanda tangan", visible.filter(r => r.status === "Menunggu tanda tangan").length, "menunggu pejabat", ICONS.shield, "blue", "Pengesahan")}
          ${statCard("Selesai", visible.filter(r => r.status === "Selesai").length, "dapat dilihat pemohon", ICONS.check, "green", "Terbit")}
        </div>
        <section class="panel table-panel"><div class="panel-head"><div><h2 class="panel-title">Daftar permohonan</h2><p class="panel-subtitle">Klik detail untuk memeriksa berkas dan memperbarui status.</p></div></div>
          <div class="toolbar-line"><div class="table-tools"><div class="search-box">${ICONS.search}<input id="request-search" type="search" placeholder="Cari nama, tiket, layanan..." aria-label="Cari permohonan"></div><select class="filter-select" id="status-filter" aria-label="Filter status"><option>Semua status</option><option>Menunggu verifikasi</option><option>Menunggu tanda tangan</option><option>Selesai</option><option>Ditolak</option></select></div><button class="button button-secondary" id="export-button">${ICONS.download} Ekspor CSV</button></div>
          ${tableMarkup(filteredRequests())}<div class="table-footer"><span id="table-count">Menampilkan ${requests.length} permohonan</span><span>Data tersimpan di server</span></div></section>
      </div>`;
}
function citizenPage() {
  const unique = new Map();
  requests.forEach(item => { if (!unique.has(item.nik)) unique.set(item.nik, item); });
  return `<div class="page-content"><div class="page-heading"><div><div class="eyebrow">Data pemohon</div><h1>Data warga</h1><p class="subtitle">Daftar warga yang tercatat melalui permohonan layanan.</p></div></div>
        <div class="citizen-banner"><div><h2>Pelayanan dimulai dari data yang terverifikasi.</h2><p>NIK yang ditampilkan disamarkan. Verifikasi identitas ke SIAK Disdukcapil memerlukan integrasi resmi.</p></div><button class="button" data-action="new-request">${ICONS.plus} Permohonan baru</button></div>
        <section class="panel table-panel"><div class="panel-head"><div><h2 class="panel-title">Warga terdaftar</h2><p class="panel-subtitle">${unique.size} pemohon tercatat dalam permohonan</p></div><div class="search-box">${ICONS.search}<input id="people-search" type="search" placeholder="Cari warga..." aria-label="Cari warga"></div></div>
        <div class="table-scroll"><table><thead><tr><th>Warga</th><th>NIK (tersamarkan)</th><th>Wilayah RT / RW</th><th>Permohonan</th><th>Terakhir mengajukan</th><th></th></tr></thead><tbody>${Array.from(unique.values()).map(item => `<tr><td><div class="person-cell"><div class="person-avatar">${escapeHTML(initials(item.name))}</div><strong>${escapeHTML(item.name)}</strong></div></td><td>${escapeHTML(item.nik)}</td><td>RT ${escapeHTML((item.rt || "— / —").split(" / ")[0])} / RW ${escapeHTML((item.rt || "— / —").split(" / ")[1])}</td><td>${requests.filter(r => r.nik === item.nik).length} permohonan</td><td>${escapeHTML(item.date)}</td><td><button class="row-action" data-action="detail" data-id="${escapeHTML(item.id)}">Lihat</button></td></tr>`).join("")}</tbody></table></div><div class="table-footer"><span>Informasi sensitif disamarkan pada tampilan</span><span>Data warga tersimpan</span></div></section>
      </div>`;
}
function archivesPage() {
  const issued = visibleRequests().filter(item => item.status === "Selesai");
  return `<div class="page-content"><div class="page-heading"><div><div class="eyebrow">Dokumen digital</div><h1>Arsip surat</h1><p class="subtitle">Permohonan yang telah disetujui. Dokumen resmi memerlukan nomor surat dan tanda tangan elektronik.</p></div><div class="heading-actions"><button class="button button-secondary" id="print-archive">${ICONS.download} Cetak daftar</button></div></div>
        <div class="citizen-banner"><div><h2>Arsip surat keluar</h2><p>Nomor surat dan dokumen bertanda tangan elektronik bersertifikat BSrE hanya dapat diterbitkan melalui integrasi layanan resmi.</p></div><div class="status-bar"><span class="status-indicator"></span> TTE belum terhubung</div></div>
        <section class="panel table-panel"><div class="panel-head"><div><h2 class="panel-title">Permohonan disetujui</h2><p class="panel-subtitle">${issued.length} permohonan telah disetujui</p></div><div class="search-box">${ICONS.search}<input id="archive-search" type="search" placeholder="Cari surat..." aria-label="Cari surat"></div></div>
          <div class="table-scroll"><table><thead><tr><th>No. surat</th><th>Pemohon</th><th>Jenis surat</th><th>Tanggal disetujui</th><th>Validasi</th><th>Dokumen</th></tr></thead><tbody id="archive-rows">${archiveRows(issued)}</tbody></table></div><div class="table-footer"><span>Pratinjau bukan surat resmi sampai penerbitan TTE aktif.</span><span>Data tersimpan</span></div>
        </section>
      </div>`;
}
function archiveRows(rows) {
  if (!rows.length) return '<tr><td colspan="6"><div class="empty-state">Belum ada surat yang terbit.</div></td></tr>';
  return rows.map(item => `<tr><td class="ticket">${escapeHTML(item.letterNo || "Belum diterbitkan")}</td><td><div class="person-cell"><div class="person-avatar">${escapeHTML(initials(item.name))}</div><strong>${escapeHTML(item.name)}</strong></div></td><td>${escapeHTML(item.type)}</td><td>${escapeHTML(item.date)}</td><td><span class="status status-sign">TTE belum tersedia</span></td><td><button class="row-action" data-action="download-letter" data-id="${escapeHTML(item.id)}">${ICONS.download} &nbsp;Pratinjau</button></td></tr>`).join("");
}
function analyticsPage() {
  const done = requests.filter(r => r.status === "Selesai").length;
  const waiting = requests.filter(r => r.status === "Menunggu verifikasi" || r.status === "Menunggu tanda tangan").length;
  const rejected = requests.filter(r => r.status === "Ditolak").length;
  const completedDurations = requests
    .filter(item => item.status === "Selesai" && item.signedAt && item.createdAt)
    .map(item => (new Date(item.signedAt) - new Date(`${String(item.createdAt).replace(" ", "T")}Z`)) / 86400000)
    .filter(duration => Number.isFinite(duration) && duration >= 0);
  const averageDays = completedDurations.length
    ? (completedDurations.reduce((total, duration) => total + duration, 0) / completedDurations.length).toFixed(1)
    : null;
  return `<div class="page-content"><div class="page-heading"><div><div class="eyebrow">Ringkasan kinerja</div><h1>Analitik pelayanan</h1><p class="subtitle">Metrik dihitung dari seluruh permohonan yang tersimpan.</p></div><div class="heading-actions"><button class="button button-secondary" id="export-button">${ICONS.download} Ekspor CSV</button></div></div>
        <div class="metric-grid">
          <article class="metric-card"><span>Total permohonan</span><strong>${requests.length}</strong><small>tersimpan di sistem</small></article>
          <article class="metric-card"><span>Permohonan disetujui</span><strong>${done}</strong><small>memerlukan TTE resmi untuk penerbitan surat</small></article>
          <article class="metric-card"><span>Dalam proses</span><strong>${waiting}</strong><small>menunggu verifikasi atau pejabat</small></article>
          <article class="metric-card"><span>Rata-rata penyelesaian</span><strong>${averageDays || "—"}${averageDays ? " <small>hari</small>" : ""}</strong><small>${averageDays ? `dari ${completedDurations.length} permohonan selesai` : "belum ada data penyelesaian"}</small></article>
          <article class="metric-card"><span>Permohonan ditolak</span><strong>${rejected}</strong><small>pemohon dapat mengajukan ulang</small></article>
          <article class="metric-card"><span>Indeks kepuasan (IKM)</span><strong>—</strong><small>belum ada data survei</small></article>
        </div>
        <div class="section-heading"><h2>Komposisi layanan</h2><span>Jumlah permohonan tersimpan</span></div>
        <section class="panel"><div class="service-list">${SERVICES.map(item => {
          const count = serviceRequestCount(item);
          const share = requests.length ? Math.round(count / requests.length * 100) : 0;
          return `<div class="service-row"><div class="service-icon">${item.icon}</div><div class="service-info"><strong>${item.name}</strong><span>${share}% dari seluruh permohonan</span></div><div style="width:28%;height:6px;border-radius:6px;background:#edf2ee;overflow:hidden"><div style="width:${share}%;height:100%;border-radius:6px;background:#459879"></div></div><span class="service-number">${count}</span></div>`;
        }).join("")}</div></section>
        <p class="data-note">Statistik dihitung dari permohonan yang tersimpan. Indikator SLA dan kepuasan akan tersedia setelah datanya dicatat.</p>
      </div>`;
}
function render() {
  const allowedPages = ROLE_PAGES[role] || [];
  if (!allowedPages.includes(currentPage)) currentPage = "dashboard";
  document.querySelectorAll(".nav-item[data-page]").forEach(button => {
    button.hidden = !allowedPages.includes(button.dataset.page);
    button.classList.toggle("active", button.dataset.page === currentPage);
  });
  document.getElementById("breadcrumb").textContent = PAGES[currentPage];
  const badge = document.getElementById("nav-count");
  badge.textContent = String(visibleRequests().filter(r => r.status === "Menunggu verifikasi").length);
  document.getElementById("profile-name").textContent = currentUser?.name || "Ilham Abdul Halim";
  document.getElementById("profile-role").textContent = role;
  document.getElementById("profile-avatar").textContent = currentUser?.initials || "IA";
  const accountButton = document.getElementById("role-switch");
  accountButton.title = "Keluar dan masuk dengan akun lain";
  accountButton.querySelector("span").textContent = "Ganti akun";
  const pages = { dashboard: role === "Warga / Pemohon" ? citizenDashboardPage : dashboardPage, permohonan: requestsPage, warga: citizenPage, surat: archivesPage, analitik: analyticsPage };
  document.getElementById("main-content").innerHTML = pages[currentPage]();
  if (currentPage === "permohonan") {
    const pageSubtitle = document.querySelector(".page-heading .subtitle");
    const tableSubtitle = document.querySelector(".table-panel .panel-subtitle");
    if (role === "Warga / Pemohon") {
      pageSubtitle.textContent = "Pantau status permohonan Anda; verifikasi berkas dilakukan operator kelurahan.";
      tableSubtitle.textContent = "Anda hanya dapat melihat pengajuan milik akun ini. Status diperbarui petugas.";
    } else if (role === "Lurah / Seklur") {
      pageSubtitle.textContent = "Tinjau permohonan yang sudah diverifikasi operator dan lakukan pengesahan.";
      tableSubtitle.textContent = "Pengesahan tersedia untuk permohonan yang lolos verifikasi operator.";
    }
  }
  document.querySelectorAll('#main-content [data-action="new-request"]').forEach(button => { button.hidden = !canCreateRequest(); });
  document.querySelectorAll("#main-content #export-button").forEach(button => { button.hidden = role !== "Operator Kelurahan"; });
  bindPageEvents();
}
function notify(message, type) {
  const root = document.getElementById("toast-root");
  root.innerHTML = `<div class="toast${type === "error" ? " error" : ""}" role="status">${escapeHTML(message)}</div>`;
  window.setTimeout(() => { root.innerHTML = ""; }, 3400);
}
function showModal(title, description, body, onSubmit) {
  const root = document.getElementById("overlay-root");
  root.innerHTML = `<div class="modal-backdrop" id="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-head"><div><h2 id="modal-title">${escapeHTML(title)}</h2><p>${escapeHTML(description)}</p></div><button class="close-button" data-action="close-modal" aria-label="Tutup">Ã—</button></div><div class="modal-body">${body}</div></section></div>`;
  root.querySelector(".close-button").addEventListener("click", closeModal);
  root.querySelector(".modal-backdrop").addEventListener("click", event => { if (event.target.id === "modal-backdrop") closeModal(); });
  if (onSubmit) root.querySelector("form")?.addEventListener("submit", event => {
    event.preventDefault();
    const submitButton = event.submitter || root.querySelector('button[type="submit"]');
    const formData = new FormData(event.currentTarget);
    if (submitButton) submitButton.disabled = true;
    Promise.resolve()
      .then(() => onSubmit(formData))
      .catch(error => {
        console.error("Pemrosesan formulir gagal:", error);
        notify(error instanceof Error ? error.message : "Formulir gagal diproses.", "error");
      })
      .finally(() => { if (submitButton?.isConnected) submitButton.disabled = false; });
  });
  root.querySelector("button, input, select")?.focus();
}
function closeModal() { document.getElementById("overlay-root").innerHTML = ""; }
function openRequestForm() {
  if (!canCreateRequest()) { notify("Akun ini tidak memiliki akses untuk membuat permohonan.", "error"); return; }
  const isCitizen = role === "Warga / Pemohon";
  const identityFields = isCitizen
    ? `<div class="field"><label for="citizen-name">Nama pemohon</label><input id="citizen-name" name="name" value="${escapeHTML(currentUser.name)}" readonly></div><div class="field"><label for="citizen-nik">NIK akun</label><input id="citizen-nik" name="nik" value="${escapeHTML(currentUser.nik)}" readonly><span class="help-text">Terhubung ke akun pemohon ini.</span></div>`
    : `<div class="field"><label for="citizen-name">Nama lengkap *</label><input id="citizen-name" name="name" required maxlength="100" placeholder="Sesuai KTP"></div><div class="field"><label for="citizen-nik">NIK *</label><input id="citizen-nik" name="nik" inputmode="numeric" pattern="[0-9]{16}" maxlength="16" minlength="16" required placeholder="16 digit NIK"><span class="help-text">NIK disamarkan pada tampilan permohonan. Validasi Dukcapil belum terhubung.</span></div>`;
  const body = `<form><div class="form-grid">
        ${identityFields}
        <div class="field"><label for="citizen-phone">Nomor WhatsApp</label><input id="citizen-phone" name="phone" type="tel" placeholder="08xxxxxxxxxx"></div>
        <div class="field"><label for="citizen-rt">RT / RW *</label><input id="citizen-rt" name="rt" required placeholder="Contoh: 03 / 05"></div>
        <div class="field full"><label for="service-type">Jenis layanan *</label><select id="service-type" name="type" required><option value="">Pilih jenis surat</option>${SERVICES.map(item => `<option>${escapeHTML(item.name)}</option>`).join("")}</select></div>
        <div class="field full"><label for="request-note">Keperluan / keterangan</label><textarea id="request-note" name="note" maxlength="500" placeholder="Jelaskan keperluan pengajuan surat"></textarea></div>
        <div class="field full"><label for="request-files">Berkas persyaratan</label><input class="file-input" id="request-files" name="files" type="file" accept=".jpg,.jpeg,.png,.pdf" multiple><span class="help-text">Format PDF, JPG, atau PNG; maksimal ${MAX_ATTACHMENT_COUNT} file dengan total 1,5 MB. Berkas disimpan di server untuk diperiksa petugas.</span></div>
      </div><div class="notice warning">Permohonan disimpan pada server. Verifikasi identitas Dukcapil, WA Gateway, dan tanda tangan elektronik resmi belum terintegrasi.</div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Batal</button><button class="button button-primary" type="submit">${ICONS.check} Kirim permohonan</button></div></form>`;
  showModal("Buat permohonan surat", "Lengkapi informasi pemohon dan persyaratan layanan.", body, async formData => {
    const rawNik = String(formData.get("nik") || "").trim();
    if (!/^\d{16}$/.test(rawNik)) { notify("NIK harus terdiri dari 16 angka.", "error"); return; }
    const selectedFiles = Array.from(document.getElementById("request-files").files || []);
    if (selectedFiles.length > MAX_ATTACHMENT_COUNT) { notify(`Pilih maksimal ${MAX_ATTACHMENT_COUNT} file persyaratan.`, "error"); return; }
    if (selectedFiles.some(file => file.size === 0 || !ATTACHMENT_TYPES[file.name.slice(file.name.lastIndexOf(".")).toLowerCase()])) {
      notify("Berkas harus berupa PDF, JPG, atau PNG dan tidak boleh kosong.", "error");
      return;
    }
    if (selectedFiles.reduce((total, file) => total + file.size, 0) > MAX_ATTACHMENT_BYTES) {
      notify("Total ukuran berkas maksimal 1,5 MB.", "error");
      return;
    }
    let attachments;
    try {
      attachments = await Promise.all(selectedFiles.map(readAttachment));
    } catch (error) {
      console.error("Berkas persyaratan gagal dibaca:", error);
      notify(error instanceof Error ? error.message : "Berkas persyaratan gagal dibaca.", "error");
      return;
    }
    try {
      const payload = await apiFetch("/api/requests", {
        method: "POST",
        body: JSON.stringify({
          name: String(formData.get("name") || "").trim(),
          nik: rawNik,
          phone: String(formData.get("phone") || "").trim(),
          type: String(formData.get("type") || ""),
          rt: String(formData.get("rt") || "").trim(),
          note: String(formData.get("note") || "").trim(),
          attachments
        })
      });
      requests.unshift(payload.request);
      closeModal();
      currentPage = "permohonan";
      render();
      notify(`Permohonan ${payload.request.id} berhasil dicatat.`);
    } catch (error) {
      console.error("Permohonan gagal disimpan:", error);
      notify(error instanceof Error ? error.message : "Permohonan gagal disimpan.", "error");
    }
  });
}
function openDetail(id) {
  const item = requests.find(request => request.id === id);
  if (!item) { notify("Data permohonan tidak ditemukan.", "error"); return; }
  if (!canViewRequest(item)) { notify("Anda hanya dapat melihat permohonan milik akun ini.", "error"); return; }
  const timeline = [
    { label: "Permohonan diajukan", date: item.date, done: true },
    { label: "Verifikasi operator", date: ["Menunggu verifikasi"].includes(item.status) ? "Menunggu tindak lanjut" : "Data dan berkas diperiksa", done: item.status !== "Menunggu verifikasi" },
    { label: "Persetujuan pejabat", date: item.status === "Selesai" ? "Disetujui pejabat" : item.status === "Ditolak" ? "Tidak dilanjutkan" : "Menunggu proses", done: item.status === "Selesai" || item.status === "Ditolak" }
  ];
  const fileList = item.attachments?.length ? `<div class="attachment-list">${item.attachments.map((file, index) => attachmentMarkup(file, item.id, index)).join("")}</div>` : '<span style="font-size:10px;color:#9aa49f">Belum ada lampiran.</span>';
  const workflowActions = canVerify(item)
    ? `<button class="button button-danger" data-action="reject" data-id="${escapeHTML(item.id)}">Tolak berkas</button><button class="button button-primary" data-action="verify" data-id="${escapeHTML(item.id)}">${ICONS.check} Verifikasi berkas</button>`
    : canApprove(item)
      ? `<button class="button button-danger" data-action="reject" data-id="${escapeHTML(item.id)}">Tolak</button><button class="button button-primary" data-action="sign" data-id="${escapeHTML(item.id)}">${ICONS.check} Setujui permohonan</button>`
      : item.status === "Selesai"
        ? `<button class="button button-secondary" data-action="download-letter" data-id="${escapeHTML(item.id)}">${ICONS.download} Cetak pratinjau</button>`
        : "";
  const body = `<div class="detail-grid">
        <div class="detail-item"><span>Nomor tiket</span><strong>${escapeHTML(item.id)}</strong></div><div class="detail-item"><span>Status</span>${badge(item.status)}</div>
        <div class="detail-item"><span>Nama pemohon</span><strong>${escapeHTML(item.name)}</strong></div><div class="detail-item"><span>NIK (tersamarkan)</span><strong>${escapeHTML(item.nik || "-")}</strong></div>
        <div class="detail-item"><span>Jenis layanan</span><strong>${escapeHTML(item.type)}</strong></div><div class="detail-item"><span>Tanggal pengajuan</span><strong>${escapeHTML(item.date)}</strong></div>
        <div class="detail-item"><span>Wilayah RT / RW</span><strong>${escapeHTML(item.rt || "-")}</strong></div><div class="detail-item"><span>Nomor surat</span><strong>${escapeHTML(item.letterNo || "Belum diterbitkan")}</strong></div>
        <div class="detail-item detail-wide"><span>Berkas persyaratan</span><div>${fileList}</div></div>
        ${item.note ? `<div class="detail-item detail-wide"><span>Catatan</span><strong>${escapeHTML(item.note)}</strong></div>` : ""}
      </div>
      <div class="timeline">${timeline.map(step => `<div class="timeline-item ${step.done ? "current" : ""}"><strong>${step.label}</strong><span>${step.date}</span></div>`).join("")}</div>
      <div class="signature-box">${ICONS.shield}<span><strong>Tanda tangan elektronik belum terhubung.</strong> Persetujuan tercatat, tetapi dokumen ini belum memiliki TTE BSrE dan bukan surat resmi.</span></div>
      <div class="modal-actions">${workflowActions}<button class="button button-secondary" data-action="close-modal">Tutup</button></div>`;
  showModal("Detail permohonan", `${item.id} · ${item.type}`, body);
}
async function updateStatus(id, status, note) {
  const item = requests.find(request => request.id === id);
  if (!item) { notify("Data permohonan tidak ditemukan.", "error"); return; }
  const authorized = (status === "Menunggu tanda tangan" && canVerify(item))
    || (status === "Selesai" && canApprove(item))
    || (status === "Ditolak" && canReject(item));
  if (!authorized) { notify("Aksi ini hanya dapat dilakukan petugas yang berwenang.", "error"); return; }
  try {
    const payload = await apiFetch(`/api/requests/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status, note })
    });
    Object.assign(item, payload.request);
    closeModal();
    render();
    notify(`Status permohonan diperbarui: ${status}.`);
  } catch (error) {
    console.error("Pembaruan permohonan gagal:", error);
    notify(error instanceof Error ? error.message : "Perubahan tidak dapat disimpan.", "error");
  }
}
function rejectRequest(id) {
  const item = requests.find(request => request.id === id);
  if (!item) return;
  if (!canReject(item)) { notify("Hanya operator atau pejabat berwenang yang dapat menolak pada tahap ini.", "error"); return; }
  const body = `<form><div class="field"><label for="reject-reason">Catatan untuk pemohon *</label><textarea id="reject-reason" name="reason" required maxlength="300" placeholder="Jelaskan berkas yang perlu diperbaiki"></textarea></div><div class="notice">Catatan ini akan ditampilkan pada detail permohonan.</div><div class="modal-actions"><button type="button" class="button button-secondary" data-action="close-modal">Batal</button><button type="submit" class="button button-danger">Tolak permohonan</button></div></form>`;
  showModal("Tolak permohonan", item.id, body, formData => {
    const reason = String(formData.get("reason") || "").trim();
    if (!reason) { notify("Catatan penolakan wajib diisi.", "error"); return; }
    updateStatus(id, "Ditolak", reason);
  });
}
function exportCSV() {
  if (role !== "Operator Kelurahan") { notify("Ekspor data hanya tersedia untuk operator kelurahan.", "error"); return; }
  const rows = [["No. Tiket", "Nama Pemohon", "NIK (tersamarkan)", "Jenis Layanan", "Tanggal", "Status", "RT/RW"], ...requests.map(item => [item.id, item.name, item.nik, item.type, item.date, item.status, item.rt])];
  const csv = rows.map(row => row.map(value => `"${String(value ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "laporan-permohonan-e-kelurahan.csv"; link.click();
  URL.revokeObjectURL(url); notify("Laporan CSV berhasil diunduh.");
}
function downloadLetter(id) {
  const item = requests.find(request => request.id === id);
  if (!item || item.status !== "Selesai") { notify("Surat belum tersedia.", "error"); return; }
  if (!canViewRequest(item)) { notify("Anda hanya dapat mengakses surat milik akun ini.", "error"); return; }
  const w = window.open("", "_blank");
  if (!w) { notify("Popup diblokir browser. Izinkan popup untuk mencetak pratinjau surat.", "error"); return; }
  const content = `<!doctype html><html lang="id"><meta charset="utf-8"><title>Pratinjau permohonan ${escapeHTML(item.id)}</title><style>body{font:14px Georgia,serif;color:#111;max-width:720px;margin:50px auto;padding:20px}header{text-align:center;border-bottom:3px double #222;padding-bottom:15px}h1{font-size:18px;margin:4px}p{line-height:1.75}.warning{font:12px Arial,sans-serif;background:#fff3dc;padding:12px;margin:20px 0}.signature{text-align:right;margin:50px 35px 0}</style><header><strong>PEMERINTAH KOTA TASIKMALAYA</strong><h1>KELURAHAN CIHIDEUNG</h1><span>PRATINJAU — BUKAN SURAT RESMI</span></header><div class="warning">PRATINJAU. Dokumen ini belum memiliki nomor surat resmi atau tanda tangan elektronik BSrE, tidak memiliki kekuatan hukum, dan bukan surat resmi.</div><p style="text-align:center"><strong>PERMOHONAN LAYANAN</strong><br>Tiket: ${escapeHTML(item.id)}<br>Nomor surat: ${escapeHTML(item.letterNo || "Belum diterbitkan")}</p><p>Nama pemohon: <strong>${escapeHTML(item.name)}</strong><br>NIK (tersamarkan): ${escapeHTML(item.nik)}<br>Wilayah: RT/RW ${escapeHTML(item.rt || "-")}</p><p>Jenis layanan yang disetujui: <strong>${escapeHTML(item.type)}</strong>.</p><div class="signature">Tasikmalaya, ${escapeHTML(item.date)}<br>Persetujuan tercatat di sistem<br><br><br><strong>(Tanda tangan elektronik belum tersedia)</strong></div><script>window.onload=()=>window.print();<\\/script></html>`;
  w.document.open(); w.document.write(content); w.document.close();
}
function showLoginError(message) {
  const error = document.getElementById("login-error");
  error.textContent = message;
  error.hidden = false;
}
function setAuthMode(mode) {
  const isLogin = mode === "login";
  document.getElementById("login-form").hidden = !isLogin;
  document.getElementById("register-form").hidden = isLogin;
  document.getElementById("login-switch").hidden = !isLogin;
  document.getElementById("register-switch").hidden = isLogin;
  document.getElementById("auth-title").textContent = isLogin ? "Selamat datang kembali" : "Daftar akun warga";
  document.getElementById("auth-intro").textContent = isLogin
    ? "Masuk menggunakan akun yang telah terdaftar."
    : "Buat akun untuk mengajukan dan memantau permohonan surat.";
  document.getElementById("login-error").hidden = true;
  document.getElementById("register-error").hidden = true;
  document.getElementById(isLogin ? "login-email" : "register-name").focus();
}
function enterApplication() {
  document.getElementById("login-screen").hidden = true;
  document.getElementById("app-shell").classList.remove("is-hidden");
  render();
}
function setCurrentUser(user) {
  if (!user) return false;
  currentUser = user;
  role = user.role;
  currentPage = "dashboard";
  return true;
}
async function leaveApplication() {
  try {
    await apiFetch("/api/auth/logout", { method: "POST", body: "{}" });
  } catch (error) {
    console.error("Sesi gagal dihapus:", error);
  }
  currentUser = null;
  role = "Operator Kelurahan";
  document.getElementById("profile-name").textContent = "Ilham Abdul Halim";
  document.getElementById("profile-role").textContent = role;
  document.getElementById("profile-avatar").textContent = "IA";
  document.getElementById("app-shell").classList.add("is-hidden");
  document.getElementById("login-password").value = "";
  document.getElementById("register-form").reset();
  setAuthMode("login");
  document.getElementById("login-screen").hidden = false;
  document.getElementById("login-email").focus();
}
function bindPageEvents() {
  document.querySelectorAll("#main-content [data-page]").forEach(button => button.addEventListener("click", () => { currentPage = button.dataset.page; render(); }));
  document.getElementById("request-search")?.addEventListener("input", renderTableRows);
  document.getElementById("status-filter")?.addEventListener("change", event => { listFilter = event.target.value; renderTableRows(); });
  document.getElementById("export-button")?.addEventListener("click", exportCSV);
  document.getElementById("print-archive")?.addEventListener("click", () => window.print());
  document.getElementById("people-search")?.addEventListener("input", event => {
    const query = event.target.value.toLowerCase();
    document.querySelectorAll("#main-content tbody tr").forEach(row => row.hidden = !row.textContent.toLowerCase().includes(query));
  });
  document.getElementById("archive-search")?.addEventListener("input", event => {
    const query = event.target.value.toLowerCase();
    const items = visibleRequests().filter(item => item.status === "Selesai" && [item.name, item.type, item.letterNo].some(value => String(value || "").toLowerCase().includes(query)));
    document.getElementById("archive-rows").innerHTML = archiveRows(items);
    document.querySelectorAll("#archive-rows [data-action]").forEach(button => button.addEventListener("click", () => handleAction(button.dataset.action, button.dataset.id)));
  });
  document.getElementById("tracking-form")?.addEventListener("submit", event => {
    event.preventDefault();
    const value = new FormData(event.currentTarget).get("ticket").toString().trim().toLowerCase();
    const item = requests.find(request => request.id.toLowerCase() === value);
    if (!item) { notify("Nomor tiket tidak ditemukan.", "error"); return; }
    openDetail(item.id);
  });
}
function handleAction(action, id) {
  if (action === "close-modal") return closeModal();
  if (action === "new-request") {
    if (!canCreateRequest()) { notify("Akun ini tidak memiliki akses untuk membuat permohonan.", "error"); return; }
    return openRequestForm();
  }
  const item = requests.find(request => request.id === id);
  if (!item) { notify("Data permohonan tidak ditemukan.", "error"); return; }
  if (action === "detail") return openDetail(id);
  if (action === "verify") {
    if (!canVerify(item)) { notify("Verifikasi berkas hanya dapat dilakukan operator kelurahan.", "error"); return; }
    return updateStatus(id, "Menunggu tanda tangan", "Berkas telah diverifikasi operator.");
  }
  if (action === "sign") {
    if (!canApprove(item)) { notify("Pengesahan hanya dapat dilakukan Lurah atau Seklur.", "error"); return; }
    return updateStatus(id, "Selesai", "Permohonan disetujui pejabat. TTE BSrE belum terhubung.");
  }
  if (action === "reject") return rejectRequest(id);
  if (action === "download-letter") return downloadLetter(id);
}
document.addEventListener("click", event => {
  const control = event.target.closest("[data-action]");
  if (control) handleAction(control.dataset.action, control.dataset.id);
});
document.querySelectorAll(".nav-item[data-page]").forEach(button => button.addEventListener("click", () => { currentPage = button.dataset.page; render(); }));
document.getElementById("role-switch").addEventListener("click", leaveApplication);
document.getElementById("help-button").addEventListener("click", () => notify("Pusat bantuan: hubungi petugas Kelurahan Cihideung pada jam pelayanan."));
document.getElementById("notification-button").addEventListener("click", () => notify(`${visibleRequests().filter(r => r.status === "Menunggu verifikasi").length} permohonan menunggu verifikasi.`));
document.getElementById("show-register").addEventListener("click", () => setAuthMode("register"));
document.getElementById("show-login").addEventListener("click", () => setAuthMode("login"));
document.getElementById("login-form").addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  try {
    const payload = await apiFetch("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
    setCurrentUser(payload.user);
    await loadRequests();
    document.getElementById("login-error").hidden = true;
    enterApplication();
  } catch (error) {
    showLoginError(error instanceof Error ? error.message : "Email atau kata sandi tidak sesuai.");
    document.getElementById("login-password").value = "";
    document.getElementById("login-password").focus();
  }
});
document.getElementById("register-form").addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const password = String(formData.get("password") || "");
  const passwordConfirm = String(formData.get("passwordConfirm") || "");
  const error = document.getElementById("register-error");
  if (password !== passwordConfirm) {
    error.textContent = "Kata sandi dan konfirmasi tidak sama.";
    error.hidden = false;
    return;
  }
  try {
    const payload = await apiFetch("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim().toLowerCase(),
        nik: String(formData.get("nik") || "").trim(),
        password
      })
    });
    setCurrentUser(payload.user);
    await loadRequests();
    error.hidden = true;
    enterApplication();
  } catch (registrationError) {
    error.textContent = registrationError instanceof Error ? registrationError.message : "Pendaftaran gagal.";
    error.hidden = false;
  }
});
document.getElementById("password-toggle").addEventListener("click", event => {
  const password = document.getElementById("login-password");
  const visible = password.type === "password";
  password.type = visible ? "text" : "password";
  event.currentTarget.textContent = visible ? "Sembunyi" : "Lihat";
  event.currentTarget.setAttribute("aria-label", visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi");
});
document.getElementById("logout-button").addEventListener("click", leaveApplication);
apiFetch("/api/me")
  .then(async payload => {
    if (!payload.user) {
      document.getElementById("login-email").focus();
      return;
    }
    setCurrentUser(payload.user);
    await loadRequests();
    enterApplication();
  })
  .catch(() => document.getElementById("login-email").focus());
