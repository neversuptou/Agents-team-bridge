// Веб-страница хаба: только чтение (ветки, решения, люди) + админка. Данные выводятся через textContent.
const $ = (s) => document.querySelector(s);
let me = null;

const STATUS = { open: "открыта", waiting: "ждёт ответа", closed: "закрыта", needs_human: "нужен человек" };

async function api(path, opts = {}) {
  const r = await fetch(path, {
    ...opts,
    headers: { authorization: "Bearer " + localStorage.tb_token, "content-type": "application/json", ...(opts.headers || {}) },
  });
  if (r.status === 401) { logout(); throw new Error("unauthorized"); }
  const body = await r.json();
  if (!r.ok) throw new Error(body.message || body.error || "ошибка");
  return body;
}

function el(tag, props = {}, ...kids) {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids.flat().filter(Boolean));
  return e;
}

// заменить содержимое, пропуская пустые элементы (null/false)
function render(target, ...kids) { target.replaceChildren(...kids.flat().filter(Boolean)); }

function logout() { delete localStorage.tb_token; location.reload(); }

async function start() {
  if (!localStorage.tb_token) return;
  try { me = await api("/api/me"); } catch { return; }
  $("#login").hidden = true;
  $("#tabs").hidden = false;
  $("#adminTab").hidden = !me.isAdmin;
  show("threads");
}

async function show(tab) {
  document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  const v = $("#view");
  render(v, el("p", { className: "muted", textContent: "Загрузка…" }));
  if (tab === "threads") {
    const rows = await api("/api/threads");
    render(v, el("h2", { textContent: "Мои ветки" }),
      rows.length ? null : el("p", { className: "muted", textContent: "Веток пока нет" }),
      ...rows.map((t) => el("div", { className: "row clickable", onclick: () => openThread(t.id) },
        el("div", { className: "row__head" }, el("b", { textContent: `#${t.id} ${t.subject}` }), el("span", { className: "st " + t.status, textContent: STATUS[t.status] })),
        el("small", { textContent: `${t.project ?? "без проекта"} · реплик: ${t.turns} · ${new Date(t.updated_at).toLocaleString("ru")}` }))));
  } else if (tab === "decisions") {
    const rows = await api("/api/decisions");
    render(v, el("h2", { textContent: "Журнал решений" }),
      rows.length ? null : el("p", { className: "muted", textContent: "Решений пока нет" }),
      ...rows.map((d) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: d.project ?? "общее" }), el("small", { textContent: new Date(d.createdAt).toLocaleString("ru") })),
        el("pre", { textContent: d.summary }),
        ...(d.links || []).map((l) => el("a", { href: l, target: "_blank", rel: "noopener", textContent: l })))));
  } else if (tab === "people") {
    const rows = await api("/api/members");
    render(v, el("h2", { textContent: "Люди" }),
      ...rows.map((p) => el("div", { className: "row" },
        el("div", { className: "row__head" }, el("b", { textContent: `${p.fullName} (${p.shortName})` }),
          el("span", { className: "st " + (p.online ? "closed" : "off"), textContent: p.online ? "в сети" : "не в сети" })),
        el("small", { textContent: p.projects.join(", ") || "без проектов" }))));
  } else if (tab === "admin") {
    const code = el("input", { placeholder: "новый код приглашения (от 4 символов)" });
    const msg = el("p", { className: "muted" });
    render(v, el("h2", { textContent: "Админ" }),
      el("p", { textContent: "Смена кода приглашения команды. Уже выданные токены продолжат работать." }),
      code,
      el("button", { textContent: "Сменить код", onclick: async () => {
        try { await api("/api/admin/invite", { method: "POST", body: JSON.stringify({ code: code.value }) }); code.value = ""; msg.textContent = "Код сменён"; }
        catch (e) { msg.textContent = e.message; }
      } }),
      msg);
  }
}

async function openThread(id) {
  const t = await api("/api/threads/" + id);
  render($("#view"), 
    el("button", { className: "ghost", textContent: "‹ Ветки", onclick: () => show("threads") }),
    el("h2", { textContent: `#${t.id} ${t.subject}` }),
    el("p", { className: "muted", textContent: `${t.project ?? "без проекта"} · ${STATUS[t.status]} · ${t.participants.join(" ↔ ")}` }),
    ...t.messages.map((m) => el("div", { className: "msg" },
      el("div", { className: "row__head" }, el("b", { textContent: m.author }), el("small", { textContent: new Date(m.createdAt).toLocaleString("ru") })),
      el("pre", { textContent: m.text }),
      ...(m.actions || []).map((a) => el("a", { href: a.url, target: "_blank", rel: "noopener", textContent: `${a.kind}: ${a.title ?? a.url}` })))),
    t.decision ? el("div", { className: "decision" }, el("b", { textContent: "Итог" }), el("pre", { textContent: t.decision })) : null);
}

$("#login").onsubmit = (e) => {
  e.preventDefault();
  localStorage.tb_token = $("#token").value.trim();
  start().then(() => { if (!me) $("#loginError").textContent = "Токен не подошёл"; });
};
$("#logout").onclick = logout;
document.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => show(b.dataset.tab)));
start();
