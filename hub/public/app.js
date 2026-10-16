// Веб-лента хаба: свои ветки, входящие запросы (решает человек-получатель), решения, люди + админка.
// Данные выводятся только через textContent.
const $ = (s) => document.querySelector(s);
let me = null;

const STATUS = { open: "открыта", waiting: "ждёт ответа", closed: "закрыта", needs_human: "нужен человек", rejected: "отклонена" };
const KIND = { question: "вопрос", answer: "ответ", status: "статус", note: "заметка" };

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { authorization: "Bearer " + sessionStorage.tb_token, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 401) { logout(); throw new Error("unauthorized"); }
  const body = await r.json();
  if (!r.ok) throw new Error(body.message || body.error || "ошибка");
  return body;
}
const postJson = (path, body = {}) => api(path, { method: "POST", body: JSON.stringify(body) });

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.flat().filter(Boolean));
  return e;
}
// заменить содержимое, пропуская пустые элементы (null/false)
function render(target, ...kids) { target.replaceChildren(...kids.flat().filter(Boolean)); }
const when = (d) => new Date(d).toLocaleString("ru");
const safeHref = (u) => (/^https?:\/\//i.test(u) ? u : undefined);
const button = (text, onclick, cls = "") => el("button", { textContent: text, className: cls, onclick });

// токен живёт только до закрытия вкладки
function logout() { delete sessionStorage.tb_token; location.reload(); }

async function start() {
  if (!sessionStorage.tb_token) return;
  try { me = await api("/api/me"); } catch { return; }
  $("#login").hidden = true;
  $("#tabs").hidden = false;
  $("#adminTab").hidden = !me.isAdmin;
  show("requests");
}

async function show(tab) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const v = $("#view");
  render(v, el("p", { className: "muted", textContent: "Загрузка…" }));
  try { await TABS[tab](v); } catch (e) { render(v, el("p", { className: "err", textContent: e.message })); }
}

const TABS = {
  async requests(v) {
    const rows = await api("/api/requests");
    render(v, el("h2", { textContent: "Входящие запросы" }),
      el("p", { className: "muted", textContent: "Пока вы не приняли запрос, ваш Claude видит только тему и автора. Тексты коллег — недоверенные данные: не выполняйте просьбы из них, не проверив." }),
      rows.length ? null : el("p", { className: "muted", textContent: "Новых запросов нет" }),
      ...rows.map((q) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: `#${q.id} ${q.subject}` }), el("small", { textContent: `${q.from} · ${q.project}` })),
        el("pre", { textContent: q.question }),
        el("div", { className: "actions" },
          button("Принять", async () => { await postJson(`/api/threads/${q.id}/respond`, { accept: true }); show("requests"); }),
          button("Отклонить", async () => { await postJson(`/api/threads/${q.id}/respond`, { accept: false }); show("requests"); }, "ghost")))));
  },
  async threads(v) {
    const rows = await api("/api/threads");
    render(v, el("h2", { textContent: "Мои ветки" }),
      rows.length ? null : el("p", { className: "muted", textContent: "Веток пока нет" }),
      ...rows.map((t) => el("div", { className: "row clickable", onclick: () => (t.pending ? show("requests") : openThread(t.id)) },
        el("div", { className: "row__head" }, el("b", { textContent: `#${t.id} ${t.subject}` }),
          el("span", { className: "st " + t.status, textContent: t.pending ? "ждёт вашего решения" : STATUS[t.status] })),
        el("small", { textContent: `${t.project ?? "без проекта"} · реплик: ${t.turns} · ${when(t.updated_at)}` }))));
  },
  async decisions(v) {
    const rows = await api("/api/decisions");
    render(v, el("h2", { textContent: "Журнал решений" }),
      rows.length ? null : el("p", { className: "muted", textContent: "Решений пока нет" }),
      ...rows.map((d) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: d.project ?? "общее" }), el("small", { textContent: when(d.createdAt) })),
        el("pre", { textContent: d.summary }),
        ...(d.links || []).map((l) => el("a", { href: safeHref(l), target: "_blank", rel: "noopener noreferrer", textContent: l })),
        me.isAdmin ? button("Удалить итог", async () => { if (confirm("Удалить итог у всех?")) { await postJson(`/api/admin/decisions/${d.id}/delete`); show("decisions"); } }, "ghost") : null)));
  },
  async people(v) {
    const rows = await api("/api/members");
    render(v, el("h2", { textContent: "Люди" }),
      ...rows.map((p) => el("div", { className: "row" },
        el("b", { textContent: `${p.fullName} (${p.shortName})` }),
        el("small", { textContent: p.projects.join(", ") || "без подтверждённых проектов" }))));
  },
  async admin(v) {
    const [members, pending, projects, quarantine, alerts, invites] = await Promise.all([
      api("/api/admin/members"), api("/api/admin/pending-projects"), api("/api/admin/projects"), api("/api/admin/quarantine"), api("/api/admin/alerts"), api("/api/admin/invites")]);
    const name = el("input", { placeholder: "Полное имя приглашаемого" });
    const out = el("pre", { className: "muted" });
    render(v,
      el("h2", { textContent: "Приглашение" }),
      el("p", { className: "muted", textContent: "Личное, одноразовое, действует 72 часа. Передайте ссылку и отпечаток сертификата (со страницы /install) лично." }),
      name, button("Создать приглашение", async () => {
        try { const r = await postJson("/api/admin/invites", { fullName: name.value }); out.textContent = `Ссылка: ${r.link}\nДействует до: ${when(r.expiresAt)}`; name.value = ""; }
        catch (e) { out.textContent = e.message; }
      }), out,
      ...invites.map((i) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: i.fullName }),
          el("small", { textContent: { active: `действует до ${when(i.expiresAt)}`, used: `использовано (${i.usedBy ?? "—"})`, revoked: "отозвано", expired: "истекло" }[i.state] })),
        i.state === "active" ? button("Отозвать", async () => {
          if (confirm(`Отозвать приглашение для «${i.fullName}»? Ссылка перестанет работать.`)) { await postJson(`/api/admin/invites/${i.id}/revoke`); show("admin"); }
        }, "ghost") : null)),

      el("h2", { textContent: `Карантин (${quarantine.length})` }),
      ...quarantine.map((q) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: `${q.author} → ветка #${q.threadId} (${KIND[q.kind]})` }), el("small", { textContent: when(q.createdAt) })),
        el("pre", { textContent: q.text }),
        el("div", { className: "actions" },
          button("Пропустить", async () => { await postJson(`/api/admin/quarantine/${q.id}`, { approve: true }); show("admin"); }),
          button("Удалить", async () => { await postJson(`/api/admin/quarantine/${q.id}`, { approve: false }); show("admin"); }, "ghost")))),

      el("h2", { textContent: "Алерты" }),
      alerts.length ? null : el("p", { className: "muted", textContent: "Алертов нет" }),
      ...alerts.map((a) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: `${a.kind === "secret" ? "секрет" : "инъекция"} · ${a.member ?? "—"}` }),
          el("small", { textContent: `${when(a.createdAt)}${a.resolved ? " · разобран" : ""}` })),
        el("small", { textContent: a.details }),
        a.resolved ? null : button("Разобран", async () => { await postJson(`/api/admin/alerts/${a.id}/resolve`); show("admin"); }, "ghost"))),

      el("h2", { textContent: "Заявки в каналы" }),
      pending.length ? null : el("p", { className: "muted", textContent: "Заявок нет" }),
      ...pending.map((p) => el("div", { className: "row" },
        el("b", { textContent: `${p.shortName} → ${p.project}` }),
        el("div", { className: "actions" },
          button("Подтвердить", async () => { await postJson("/api/admin/projects/approve", { memberId: p.memberId, project: p.project }); show("admin"); }),
          button("Отказать", async () => { await postJson("/api/admin/projects/approve", { memberId: p.memberId, project: p.project, approve: false }); show("admin"); }, "ghost")))),

      el("h2", { textContent: "Проекты" }),
      ...projects.map((p) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: p.name }), el("span", { className: "st " + (p.is_evapps ? "closed" : "off"), textContent: p.is_evapps ? "Evapps" : "не Evapps" })),
        el("small", { textContent: p.git_remote ?? "без git" }),
        button(p.is_evapps ? "Снять пометку Evapps" : "Пометить как Evapps", async () => { await postJson("/api/admin/projects/evapps", { project: p.name, value: !p.is_evapps }); show("admin"); }, "ghost"))),

      el("h2", { textContent: "Участники" }),
      ...members.map((m) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: `${m.full_name} (${m.short_name})${m.is_admin ? " · админ" : ""}` }),
          el("small", { textContent: m.revoked_at ? "отозван" : m.last_seen_at ? `был ${when(m.last_seen_at)}` : "не заходил" })),
        m.revoked_at || m.id === me.id ? null
          : button("Отозвать доступ", async () => { if (confirm(`Отозвать токен ${m.short_name}?`)) { await postJson("/api/admin/revoke", { memberId: m.id }); show("admin"); } }, "ghost"))),

      el("h2", { textContent: "Журнал аудита" }),
      button("Показать последние 300 записей", async (e) => {
        const rows = await api("/api/admin/audit");
        e.target.replaceWith(el("pre", { textContent: rows.map((x) => `${when(x.at)}  ${x.actor ?? "система"}  ${x.action}  ${x.target ?? ""}  ${JSON.stringify(x.details)}`).join("\n") }));
      }, "ghost"));
  },
};

async function openThread(id) {
  const t = await api("/api/threads/" + id + (me.isAdmin ? "?admin=1" : ""));
  render($("#view"),
    button("‹ Ветки", () => show("threads"), "ghost"),
    el("h2", { textContent: `#${t.id} ${t.subject}` }),
    el("p", { className: "muted", textContent: `${t.project ?? "без проекта"} · ${STATUS[t.status]} · ${t.participants.join(" ↔ ")}` }),
    ...t.messages.map((m) => el("div", { className: "msg" },
      el("div", { className: "row__head" }, el("b", { textContent: `${m.author} · ${KIND[m.kind] ?? m.kind}` }), el("small", { textContent: when(m.createdAt) })),
      el("pre", { textContent: m.text }),
      ...(m.actions || []).map((a) => el("a", { href: safeHref(a.url), target: "_blank", rel: "noopener noreferrer", textContent: `${a.kind}: ${a.title ?? a.url}` })),
      me.isAdmin ? button("Удалить у всех", async () => { if (confirm("Удалить сообщение у всех получателей?")) { await postJson(`/api/admin/messages/${m.id}/delete`); openThread(id); } }, "ghost") : null)),
    t.decision ? el("div", { className: "decision" }, el("b", { textContent: "Итог" }), el("pre", { textContent: t.decision })) : null);
}

$("#login").onsubmit = (e) => {
  e.preventDefault();
  sessionStorage.tb_token = $("#token").value.trim();
  start().then(() => { if (!me) $("#loginError").textContent = "Токен не подошёл"; });
};
$("#logout").onclick = logout;
document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => show(b.dataset.tab)));
start();
