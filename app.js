const C = window.COUNTRIES;
const byCode = Object.fromEntries(C.map((c) => [c.code, c]));
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const VERDICT = {
  ok: { chip: "No consent needed", line: "You may send a first email here without prior consent, if the email itself meets the conditions below." },
  cond: { chip: "Only in specific cases", line: "Sending is allowed only in the cases described below. Check that yours is one of them before anything else." },
  consent: { chip: "Consent first", line: "The law here requires consent before the first email. No wording fixes that, so this page will not offer a rewrite as a way around it." },
  unknown: { chip: "Not verified", line: "This combination was not verified against the law. Treat the result as a hygiene check only." }
};

// What the model is asked to find, and how each item is reported.
const ELEMENTS = {
  sender: { field: null, quote: null, label: "Says who is writing", missing: "The email does not say clearly who is writing and for which company.", fix: "state the sender's full name and company" },
  optout: { field: "opt_out_present", quote: "opt_out_quote", label: "Gives a way to say stop", missing: "There is no line telling the reader how to refuse further emails.", fix: "add one plain sentence telling the reader how to stop further emails, for example by replying \"stop\"" },
  postal: { field: "postal_address_present", quote: "postal_quote", label: "Has a physical postal address", missing: "There is no postal address of the sender.", fix: "add the sender's physical postal address in the signature" },
  adlabel: { field: "clearly_commercial", quote: "commercial_quote", label: "Is plainly a commercial offer", missing: "It is not plain that this is a sales message.", fix: "make it plain in the first lines that this is a commercial offer" },
  subject: { field: null, quote: null, label: "Subject line is honest", missing: "The subject line pretends to be a reply or is missing." },
  relevance: { field: "relevant_to_role", quote: null, label: "Offer relates to the reader's job", missing: "The offer does not clearly relate to the reader's professional role.", fix: "tie the offer to the reader's professional role in one sentence" }
};
const HYGIENE = ["sender", "optout"];

// Only models that were tested on the sample drafts are listed.
const MODELS = [
  { id: "gemma-4-E2B-it-q4f16_1-MLC", label: "Gemma 4 E2B · 30 of 30 test drafts right, larger download" },
  { id: "Qwen3.5-2B-q4f16_1-MLC", label: "Qwen 3.5 2B · 26 of 30 test drafts right, about 1 GB" }
];

function track(name) {
  try { if (window.goatcounter && window.goatcounter.count) window.goatcounter.count({ path: "coldproof/" + name, title: name, event: true }); } catch (e) {}
}

// ---------- step 1: the legal verdict, from the checked rules ----------
$("country").innerHTML = C.map((c) => `<option value="${c.code}">${esc(c.name)}</option>`).join("");
$("country").value = "US";
$("model").innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(m.label)}</option>`).join("");

function current() {
  const c = byCode[$("country").value], type = $("atype").value;
  return { c, type, verdict: c[type] };
}
function needsFor(c) { return c.needs.length ? c.needs : HYGIENE; }

function renderLegal() {
  const { c, verdict } = current();
  const v = VERDICT[verdict];
  const needs = needsFor(c);
  $("legal").innerHTML = `
    <div class="legal ${verdict}">
      <div class="head"><span class="chip ${verdict}">${v.chip}</span><span>${esc(c.name)}</span></div>
      <p>${v.line}</p>
      <p>${esc(c.rule)}</p>
      <p class="note">${c.needs.length ? "The email itself must" : "No content rules were verified for this country, so the draft is checked for the basics. The email should"}: ${needs.map((k) => ELEMENTS[k].label.toLowerCase()).join(", ")}.</p>
      <p class="src"><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.source)}</a> · checked ${esc(c.checked || window.RULES_CHECKED)}</p>
    </div>`;
}
$("country").addEventListener("change", renderLegal);
$("atype").addEventListener("change", renderLegal);
renderLegal();

// ---------- the model, loaded on first use ----------
let webllm = null, engine = null, engineId = null;
function status(text, progress) {
  $("engine").textContent = text || "";
  $("bar").style.display = progress == null ? "none" : "block";
  if (progress != null) $("bar").firstElementChild.style.width = Math.round(progress * 100) + "%";
}
async function getEngine(id) {
  if (engine && engineId === id) return engine;
  if (!navigator.gpu) throw new Error("This browser has no WebGPU, so the model cannot run here. Try a recent Chrome, Edge or Safari on a computer.");
  if (!webllm) { status("Loading the runtime…", 0); webllm = await import("https://esm.run/@mlc-ai/web-llm"); }
  if (engine) { try { await engine.unload(); } catch (e) {} engine = null; }
  engine = await webllm.CreateMLCEngine(id, {
    initProgressCallback: (p) => status(p.progress < 1 ? `Getting the model onto your machine, one time only: ${Math.round(p.progress * 100)}%` : "Starting the model…", p.progress)
  });
  engineId = id;
  return engine;
}
async function ask(eng, messages, opts) {
  const res = await eng.chat.completions.create(Object.assign({ messages, temperature: 0, extra_body: { enable_thinking: false } }, opts));
  return (res.choices[0].message.content || "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}

const SCHEMA = {
  type: "object",
  properties: {
    sender_name: { type: "string" }, sender_company: { type: "string" },
    opt_out_present: { type: "boolean" }, opt_out_quote: { type: "string" },
    postal_address_present: { type: "boolean" }, postal_quote: { type: "string" },
    clearly_commercial: { type: "boolean" }, commercial_quote: { type: "string" },
    language: { type: "string", enum: ["en", "fr", "de", "es", "it", "nl", "sv", "da", "no", "fi", "pl", "cs", "pt", "other"] },
    relevant_to_role: { type: "string", enum: ["yes", "no", "unknown"] },
    offer: { type: "string" }
  },
  required: ["sender_name", "sender_company", "opt_out_present", "opt_out_quote", "postal_address_present", "postal_quote", "clearly_commercial", "commercial_quote", "language", "relevant_to_role", "offer"]
};

function extractPrompt(subject, body, role) {
  return `You inspect a sales email and report only what is literally written in it. Do not guess and do not be generous.

SUBJECT: ${subject || "(none)"}
RECIPIENT JOB: ${role || "(not given)"}
EMAIL:
"""
${body}
"""

Answer with one JSON object:
- sender_name: the sender's own name exactly as written in the email, or "".
- sender_company: the name of the company the sender writes for, exactly as written in the email, or "" if no company name appears. A person's name is not a company.
- opt_out_present: true only if the email tells the reader how to stop getting further emails (unsubscribe, reply stop, opt out).
- opt_out_quote: the exact words that do this, or "".
- postal_address_present: true only if a physical postal address (street or P.O. box and city) appears.
- postal_quote: the exact address text, or "".
- clearly_commercial: true if a reader can tell this is a business offering a product or service.
- commercial_quote: the exact words that make this plain, or "".
- language: the language the email is written in, as a two-letter code.
- relevant_to_role: "yes" if the offer clearly relates to the recipient's job, "no" if it does not, "unknown" if the job is not given.
- offer: one short sentence, in English, naming the product or service being sold.`;
}

// A quote only counts if those words really are in the draft.
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
function quoteFound(quote, text) {
  const q = norm(quote).replace(/^["'“”]+|["'“”.]+$/g, "");
  return q.length >= 3 && norm(text).includes(q);
}

// Second line of defence for the two items that matter most. A quote that is in the draft
// still has to look like the thing it claims to be.
const STOP_CUES = /(unsubscrib|opt[\s-]?out|\bstop\b|stopp|remove (you|me)|no longer|not (hear|receive|want|wish)|rather not|won'?t (follow up|email|write|contact|reach out|bother)|will not (follow up|email|write|contact|reach out)|reply[^.]{0,25}no thanks|vill (du|ni) inte|inte få fler|d[ée]sabonn|d[ée]sinscri|ne (plus|souhaitez)|abmelden|abbestell|keine weiteren|austragen|\bbaja\b|cancelar|dejar de recibir|disiscri|cancella|non ricevere|uitschrijven|afmelden|geen berichten|avregistrer|avsluta|inte vill|afmeld|ikke ønsker|meld deg av|peruuta|en[äa]{2} viestej|wypis|rezygn|nie chc|odhl[áa]s|nep[řr]ejete|n[ãa]o receber|remover)/i;
function looksRight(key, quote) {
  if (key === "optout") return STOP_CUES.test(quote);
  if (key === "postal") return /\d/.test(quote);
  return true;
}

function evaluate(found, c, subject, body) {
  const text = subject + "\n" + body;
  return needsFor(c).map((key) => {
    const el = ELEMENTS[key];
    let pass, quote = "", note = "";
    if (key === "relevance") {
      if (found.relevant_to_role === "unknown") return { key, el, state: "info", note: "The recipient's job was not given, so this could not be judged. Send only if the offer relates to their work." };
      pass = found.relevant_to_role === "yes";
    } else if (key === "subject") {
      // decided by the page itself: a first email must not pose as a reply, and it needs a subject
      pass = subject.trim().length > 0 && !/^\s*(re|fwd?)\s*:/i.test(subject);
      if (!pass) note = subject.trim() ? "The subject starts with Re: or Fwd:, but this is a first email." : "There is no subject line.";
    } else if (key === "sender") {
      // name and company are asked for separately, and both must really be in the draft
      const name = found.sender_name || "", company = found.sender_company || "";
      const hasCompany = quoteFound(company, text) && norm(company) !== norm(name);
      pass = quoteFound(name, text) && hasCompany;
      quote = pass ? name + ", " + company : "";
      if (!pass && quoteFound(name, text)) note = "There is a name but no company. The reader cannot tell who is behind the email.";
    } else {
      pass = !!found[el.field];
      quote = found[el.quote] || "";
      if (pass && !quoteFound(quote, text)) { pass = false; note = "The model said yes but could not point to the words, so this is counted as missing."; }
      else if (pass && !looksRight(key, quote)) { pass = false; note = "The model pointed to a sentence that does not do this, so it is counted as missing."; }
    }
    return { key, el, state: pass ? "pass" : "fail", quote: pass ? quote : "", note };
  });
}

// The added lines are fixed wording, written and checked by hand for each language.
// The model is only trusted to read the draft, never to write the legal lines.
const PHRASES = {
  en: { stop: "If you would rather not hear from me again, reply \"stop\" and I will not write again.", ad: "This is a commercial message from [your company].", sig: "[Your full name], [Your company]", addr: "[Your company's postal address]" },
  fr: { stop: "Si vous ne souhaitez plus recevoir de messages de ma part, répondez « stop » et je ne vous écrirai plus.", ad: "Ceci est un message commercial de [votre société].", sig: "[Votre nom complet], [Votre société]", addr: "[Adresse postale de votre société]" },
  de: { stop: "Wenn Sie keine weiteren Nachrichten von mir erhalten möchten, antworten Sie einfach mit „Stopp“, und ich schreibe Ihnen nicht mehr.", ad: "Dies ist eine Werbenachricht von [Ihr Unternehmen].", sig: "[Ihr vollständiger Name], [Ihr Unternehmen]", addr: "[Postanschrift Ihres Unternehmens]" },
  es: { stop: "Si prefiere no recibir más mensajes míos, responda «baja» y no volveré a escribirle.", ad: "Este es un mensaje comercial de [su empresa].", sig: "[Su nombre completo], [Su empresa]", addr: "[Dirección postal de su empresa]" },
  it: { stop: "Se preferisce non ricevere altri messaggi da parte mia, risponda «stop» e non Le scriverò più.", ad: "Questo è un messaggio commerciale di [la Sua azienda].", sig: "[Nome e cognome], [La Sua azienda]", addr: "[Indirizzo postale dell'azienda]" },
  nl: { stop: "Wilt u geen berichten meer van mij ontvangen? Antwoord dan met ‘stop’ en ik schrijf u niet meer.", ad: "Dit is een commercieel bericht van [uw bedrijf].", sig: "[Uw volledige naam], [Uw bedrijf]", addr: "[Postadres van uw bedrijf]" },
  sv: { stop: "Om du inte vill få fler meddelanden från mig, svara ”stopp” så skriver jag inte igen.", ad: "Detta är ett kommersiellt meddelande från [ditt företag].", sig: "[Ditt fullständiga namn], [Ditt företag]", addr: "[Företagets postadress]" },
  da: { stop: "Hvis du ikke ønsker flere beskeder fra mig, så svar ”stop”, og jeg skriver ikke igen.", ad: "Dette er en kommerciel henvendelse fra [din virksomhed].", sig: "[Dit fulde navn], [Din virksomhed]", addr: "[Virksomhedens postadresse]" },
  no: { stop: "Hvis du ikke ønsker flere meldinger fra meg, svar «stopp», så skriver jeg ikke igjen.", ad: "Dette er en kommersiell henvendelse fra [din bedrift].", sig: "[Ditt fulle navn], [Din bedrift]", addr: "[Bedriftens postadresse]" },
  fi: { stop: "Jos et halua saada minulta enää viestejä, vastaa ”stop”, niin en kirjoita uudelleen.", ad: "Tämä on kaupallinen viesti yritykseltä [yrityksesi nimi].", sig: "[Koko nimesi], [Yrityksesi]", addr: "[Yrityksen postiosoite]" },
  pl: { stop: "Jeśli nie chcą Państwo otrzymywać ode mnie kolejnych wiadomości, proszę odpisać „stop”, a nie napiszę ponownie.", ad: "To jest wiadomość handlowa od firmy [nazwa firmy].", sig: "[Imię i nazwisko], [Nazwa firmy]", addr: "[Adres pocztowy firmy]" },
  cs: { stop: "Pokud si nepřejete dostávat ode mě další zprávy, odpovězte prosím „stop“ a už Vám nenapíšu.", ad: "Toto je obchodní sdělení společnosti [název společnosti].", sig: "[Vaše celé jméno], [Vaše společnost]", addr: "[Poštovní adresa společnosti]" },
  pt: { stop: "Se preferir não receber mais mensagens minhas, responda «stop» e não voltarei a escrever.", ad: "Esta é uma mensagem comercial de [a sua empresa].", sig: "[O seu nome completo], [A sua empresa]", addr: "[Morada postal da empresa]" }
};
function assemble(subject, body, fails, lang) {
  const failed = new Set(fails.map((f) => f.key));
  const ph = PHRASES[lang] || PHRASES.en;
  let newSubject = subject;
  if (failed.has("subject")) newSubject = subject.replace(/^(\s*(re|fwd?)\s*:\s*)+/i, "").trim() || "[A subject that says what this email is about]";
  if (newSubject) newSubject = newSubject.charAt(0).toUpperCase() + newSubject.slice(1);
  const paras = body.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  // a short last paragraph is treated as the sign-off, a short first one as the greeting
  const signoff = paras.length > 1 && paras[paras.length - 1].length <= 60 ? paras.pop() : null;
  const greeting = paras.length > 1 && paras[0].length <= 40 ? paras.shift() : null;
  const out = [];
  if (greeting) out.push(greeting);
  if (failed.has("adlabel")) out.push(ph.ad);
  out.push(...paras);
  if (failed.has("optout")) out.push(ph.stop);
  if (signoff) out.push(signoff);
  const sig = [];
  if (failed.has("sender")) sig.push(ph.sig);
  if (failed.has("postal")) sig.push(ph.addr);
  if (sig.length) out.push(sig.join("\n"));
  return (newSubject ? "Subject: " + newSubject + "\n\n" : "") + out.join("\n\n");
}

async function run() {
  const subject = $("subject").value.trim(), body = $("body").value.trim(), role = $("role").value.trim();
  if (body.length < 20) { status("Paste the email text first."); return; }
  const { c, verdict } = current();
  const btn = $("run");
  btn.disabled = true; track("run");
  try {
    const eng = await getEngine($("model").value);
    status("Reading your draft…", null);
    const raw = await ask(eng, [{ role: "user", content: extractPrompt(subject, body, role) }], { response_format: { type: "json_object", schema: JSON.stringify(SCHEMA) }, max_tokens: 500 });
    let found;
    try { found = JSON.parse(raw); } catch (e) { throw new Error("The model returned something that is not valid JSON. Try again or pick the other model."); }
    window.coldproof.last = { model: $("model").value, found };
    const checks = evaluate(found, c, subject, body);
    const fails = checks.filter((x) => x.state === "fail");
    const fixable = fails.filter((f) => f.key !== "relevance");
    const fixed = fixable.length && verdict !== "consent" ? assemble(subject, body, fixable, found.language) : "";
    render(c, verdict, checks, fails, fixed, found);
    status("");
    track("done");
  } catch (e) {
    status(String((e && e.message) || e));
  } finally { btn.disabled = false; }
}

function render(c, verdict, checks, fails, fixed, found, banner) {
  const judged = checks.filter((x) => x.state !== "info");
  const passed = judged.filter((x) => x.state === "pass").length;
  const mark = { pass: "✓", fail: "✕", info: "?" };
  let html = banner ? `<div class="legal"><p>${esc(banner)}</p></div>` : "";
  if (verdict === "consent") {
    html += `<div class="legal consent"><div class="head"><span class="chip consent">Do not send without consent</span><span>${esc(c.name)}</span></div>
      <p>The checklist below still applies once you have consent or an existing customer relationship, but fixing the wording does not make a first email lawful here.</p></div>`;
  }
  html += `<p class="score" style="margin-top:16px">${passed} of ${judged.length} required elements found</p>
    <ul class="checks">${checks.map((x) => `
      <li class="${x.state}"><span class="mark">${mark[x.state]}</span><span class="what">${esc(x.el.label)}</span>
        <span class="why">${x.state === "pass" ? (x.quote ? `Found: <q>${esc(x.quote)}</q>` : "Found.") : x.state === "fail" ? esc(x.note || x.el.missing) : esc(x.note)}</span></li>`).join("")}
    </ul>`;
  if (fixed) {
    html += `<h3>Fixed version</h3>
      <div class="fixed" id="fixed">${esc(fixed)}</div>
      <div class="row"><button id="copy" class="ghost">Copy</button></div>
      <p class="privacy">Your own text is kept as it was. The added lines are fixed wording in the language of your email, not written by the model. Fill in anything in [square brackets] and read it before you send it.</p>`;
  } else if (!fails.length) {
    html += `<p class="rule" style="margin-top:14px">Nothing required is missing from the text.</p>`;
  }
  $("result").innerHTML = html;
  $("result-step").hidden = false;
  $("result-step").scrollIntoView({ behavior: "smooth", block: "start" });
  const copy = $("copy");
  if (copy) copy.addEventListener("click", async () => {
    track("copy");
    try { await navigator.clipboard.writeText(fixed); copy.textContent = "Copied"; } catch (e) { copy.textContent = "Select and copy the text"; }
  });
}

// A real answer from Gemma 4 E2B on the sample draft, saved on 14 October 2026, so the result can be
// seen on a phone or without downloading a model. It goes through the same checks as a live run.
const RECORDED = {
  model: "Gemma 4 E2B", date: "14 October 2026",
  found: { sender_name: "Tom", sender_company: "", opt_out_present: false, opt_out_quote: "", postal_address_present: false, postal_quote: "", clearly_commercial: true, commercial_quote: "We clean lead lists before every campaign so that reps stop wasting calls on dead contacts.", language: "en", relevant_to_role: "yes", offer: "cleaning lead lists before campaigns" }
};
function fillSample() {
  $("subject").value = "Re: your Q4 pipeline";
  $("body").value = "Hi Jane,\n\nI saw that your team is hiring three more sales reps this quarter. We clean lead lists before every campaign so that reps stop wasting calls on dead contacts.\n\nWorth a 15 minute call next week?\n\nBest,\nTom";
  $("role").value = "Head of Sales";
}
function showRecorded() {
  track("recorded");
  $("country").value = "US"; $("atype").value = "named"; renderLegal();
  fillSample();
  const subject = $("subject").value, body = $("body").value;
  const { c, verdict } = current();
  const checks = evaluate(RECORDED.found, c, subject, body);
  const fails = checks.filter((x) => x.state === "fail");
  const fixable = fails.filter((f) => f.key !== "relevance");
  render(c, verdict, checks, fails, fixable.length ? assemble(subject, body, fixable, RECORDED.found.language) : "", RECORDED.found,
    `This is a recorded answer from ${RECORDED.model} on the sample draft, saved on ${RECORDED.date}. Nothing was downloaded. To check your own draft, paste it above and press "Check my draft" on a computer.`);
}

$("run").addEventListener("click", run);
$("recorded").addEventListener("click", showRecorded);
$("sample").addEventListener("click", () => { fillSample(); track("sample"); });
$("want").addEventListener("click", () => {
  track("want-teams");
  $("want").disabled = true;
  $("want").textContent = "Noted, thank you";
  $("want-note").innerHTML = 'Counted. To hear when it is ready, or to tell me what your team needs, write to <a href="https://x.com/phaz_dev" rel="noopener" target="_blank">@phaz_dev</a>.';
});
if (!navigator.gpu) status("This browser has no WebGPU, so the model cannot run here. You can still see the legal verdict above, or press \"See a recorded example\".");

// Test set: open the page with #tests to run all 30 drafts in this browser.
if (location.hash === "#tests") {
  const sec = document.createElement("section");
  sec.id = "tests";
  sec.innerHTML = `<h2>Run the test set</h2><p class="sub">30 drafts in 13 languages with known answers. See <a href="https://github.com/phazww/coldproof/blob/main/TESTS.md">TESTS.md</a>.</p>
    <div class="row"><button id="tests-run">Run with the selected model</button></div><div class="engine" id="tests-status"></div><div id="tests-out"></div>`;
  document.querySelector("main").prepend(sec);
  const s = document.createElement("script");
  s.src = "tests.js";
  document.body.appendChild(s);
  $("tests-run").addEventListener("click", async () => {
    $("tests-run").disabled = true;
    const label = { s: "Sender", o: "Stop", p: "Address", c: "Commercial" };
    try {
      const rows = await window.runColdproofTests($("model").value, (i, n) => { $("tests-status").textContent = `Draft ${i} of ${n}`; });
      const keys = Object.keys(label);
      const ok = (r) => keys.every((k) => r.got[k] === r.exp[k]) && r.got.lang === r.exp.lang;
      $("tests-status").textContent = `${rows.filter(ok).length} of ${rows.length} drafts fully right`;
      $("tests-out").innerHTML = `<div class="tablewrap"><table><thead><tr><th>Draft</th>${keys.map((k) => `<th>${label[k]}</th>`).join("")}<th>Language</th></tr></thead><tbody>${rows.map((r) => `<tr><td class="email">${esc(r.id)}</td>${keys.map((k) => `<td>${r.got[k] === r.exp[k] ? "✓" : "✕ expected " + (r.exp[k] ? "yes" : "no")}</td>`).join("")}<td>${r.got.lang === r.exp.lang ? "✓" : "✕ " + esc(r.got.lang)}</td></tr>`).join("")}</tbody></table></div>`;
    } catch (e) { $("tests-status").textContent = String((e && e.message) || e); }
    $("tests-run").disabled = false;
  });
}

// exposed for testing in the console
window.coldproof = { extractPrompt, evaluate, assemble, SCHEMA, PHRASES, getEngine, ask };
