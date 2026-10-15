// Страница подключения: приглашение берётся из фрагмента ссылки (#invite=…) и на сервер не отправляется
const hub = location.origin;
const invite = new URLSearchParams(location.hash.slice(1)).get("invite") || "";
const $ = (id) => document.getElementById(id);
$("noinvite").hidden = !!invite;

function fill(pkg, sum) {
  document.querySelectorAll(".pkg").forEach((e) => (e.textContent = pkg));
  $("sum").textContent = sum || "не опубликован — спросите админа";
  $("c2").textContent = `curl --cacert teambridge-ca.crt -O ${hub}/${pkg}`;
  $("c2w").textContent = `curl.exe --ssl-no-revoke --cacert teambridge-ca.crt -O ${hub}/${pkg}`;
  $("c3").textContent = `npm i -g ./${pkg}`;
}

$("c1").textContent = `curl -k -o teambridge-ca.crt ${hub}/ca.crt`;
$("c1w").textContent = `(New-Object Security.Cryptography.X509Certificates.X509Certificate2 "$PWD\\teambridge-ca.crt").GetCertHashString("SHA256")`;
$("c1u").textContent = "openssl x509 -noout -fingerprint -sha256 -in teambridge-ca.crt";
$("c4").textContent = `teambridge setup --hub ${hub} --ca teambridge-ca.crt`;
$("c5").textContent = `teambridge register --invite ${invite || "<приглашение>"} --name "Имя"`;
fill("teambridge.tgz", "");

// опубликованный пакет и его SHA-256: строка «<hash>  <файл>»
fetch("/SHA256SUMS").then((r) => (r.ok ? r.text() : "")).then((t) => {
  const [sum, pkg] = t.trim().split(/\s+/);
  if (sum && pkg) fill(pkg, sum);
}).catch(() => {});

document.querySelectorAll("[data-copy]").forEach((b) => (b.onclick = async () => {
  await navigator.clipboard.writeText($(b.dataset.copy).textContent);
  b.textContent = "Скопировано"; setTimeout(() => (b.textContent = "Копировать"), 1500);
}));
