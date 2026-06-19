(function () {
  const script =
    document.currentScript ||
    [...document.querySelectorAll("script")].find(s => s.src.includes("/static/bot.js"));

  if (!script) return console.log("Bot script not found");

  const url = new URL(script.src);
  const STORE_ID = url.searchParams.get("store");
  const API_BASE = url.origin;

  let pendingForm = null;
  let botOpen = false;
  let sending = false;
  const handled = new WeakSet();

  const clean = v => (v || "").toString().replace(/\s+/g, " ").trim();
  const lower = v => clean(v).toLowerCase();

  function labelOf(el) {
    if (!el) return "";
    if (el.id) {
      const label = document.querySelector(`label[for="${el.id}"]`);
      if (label) return clean(label.innerText);
    }
    return clean(el.closest("label")?.innerText || el.previousElementSibling?.innerText || "");
  }

  function meta(el) {
    return lower(`${el.name || ""} ${el.id || ""} ${el.placeholder || ""} ${el.getAttribute("aria-label") || ""} ${labelOf(el)}`);
  }

  function fieldValue(form, keys) {
    for (const el of form.querySelectorAll("input, textarea, select")) {
      if (keys.some(k => meta(el).includes(k))) {
        if (el.type === "radio" || el.type === "checkbox") return el.checked ? clean(el.value) : "";
        if (el.tagName === "SELECT") return clean(el.options[el.selectedIndex]?.text || el.value);
        return clean(el.value);
      }
    }
    return "";
  }

  function phoneFrom(form) {
    for (const el of form.querySelectorAll("input, textarea")) {
      if (/phone|mobile|whatsapp|contact|number|cell/.test(meta(el))) {
        let v = clean(el.value).replace(/\s+/g, "");
        if (/^03\d{9}$/.test(v)) return v;
        if (/^\+923\d{9}$/.test(v)) return v.replace("+92", "0");
        if (/^923\d{9}$/.test(v)) return "0" + v.slice(2);
        return v;
      }
    }
    return "";
  }

  function money(text) {
    const m = clean(text).match(/(PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)?\s?[\d,]+(\.\d{1,2})?/i);
    return m ? clean(m[0]) : "";
  }

  function pageProduct() {
    const text = clean(document.body.innerText);
    const title =
      clean(document.querySelector("[data-product-name]")?.innerText) ||
      clean(document.querySelector(".product-title")?.innerText) ||
      clean(document.querySelector("h1")?.innerText) ||
      clean(document.title);

    const img = [...document.images].find(i => {
      const src = lower(i.currentSrc || i.src);
      return src && !/logo|icon|avatar|banner/.test(src) && i.naturalWidth >= 40;
    });

    return {
      name: title,
      price: money(text),
      image: img ? new URL(img.currentSrc || img.src, location.href).href : "",
      url: location.href,
      text: text.slice(0, 5000)
    };
  }

  function formData(form) {
    const data = {};
    new FormData(form).forEach((v, k) => data[k] = typeof v === "string" ? clean(v) : v);

    const product = pageProduct();

    return {
      ...data,
      _page: location.href,
      _canonical_url: document.querySelector("link[rel='canonical']")?.href || "",
      _title: document.title,
      _time: new Date().toISOString(),

      _customer_name: fieldValue(form, ["name", "full name", "customer"]) || data.name || "",
      _customer_email: fieldValue(form, ["email"]) || data.email || "",
      _customer_phone: phoneFrom(form),
      _customer_city: fieldValue(form, ["city", "town"]) || data.city || "",
      _customer_address: fieldValue(form, ["address", "shipping", "billing"]) || data.address || "",

      _product_name: product.name,
      _product_price: product.price,
      _total_price: product.price,
      _product_image: product.image,
      _product_url: product.url,

      _payment_method: fieldValue(form, ["payment", "cod", "cash on delivery", "card"]),
      _summary_text: product.text,
      _bot_version: "v3_clean"
    };
  }

  async function sendOrder(phone, form) {
    if (sending) return;
    sending = true;

    try {
      const res = await fetch(`${API_BASE}/api/new-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: STORE_ID,
          phone,
          form_data: formData(form)
        })
      });

      const data = await res.json().catch(() => ({}));
      console.log(res.ok && data.success ? "Order captured" : "Order failed", data);
    } catch (e) {
      console.log("Server error", e);
    }

    sending = false;
  }

  function continueSubmit(form) {
    handled.delete(form);
    setTimeout(() => {
      try {
        HTMLFormElement.prototype.submit.call(form);
      } catch (e) {
        console.log("Submit failed", e);
      }
    }, 500);
  }

  function openBot() {
    if (botOpen) return;
    botOpen = true;

    const box = document.createElement("div");
    box.innerHTML = `
      <div style="position:fixed;right:20px;bottom:20px;width:330px;max-width:calc(100vw - 24px);background:white;color:#111;padding:18px;border-radius:16px;box-shadow:0 10px 40px #0004;z-index:999999;font-family:Arial">
        <button id="vo-close" style="float:right;border:0;background:transparent;font-size:18px;cursor:pointer">✕</button>
        <h3 style="margin:0 0 8px">Confirm Order</h3>
        <p style="font-size:13px;color:#666">Enter phone number to continue checkout.</p>
        <input id="vo-phone" placeholder="03XXXXXXXXX" style="width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;box-sizing:border-box">
        <button id="vo-btn" style="margin-top:10px;width:100%;padding:12px;background:#111;color:#fff;border:0;border-radius:10px;font-weight:700;cursor:pointer">Confirm</button>
      </div>
    `;

    document.body.appendChild(box);

    const close = () => {
      box.remove();
      botOpen = false;
    };

    box.querySelector("#vo-close").onclick = close;

    box.querySelector("#vo-btn").onclick = async () => {
      const phone = clean(box.querySelector("#vo-phone").value).replace(/\s+/g, "");

      if (!/^03\d{9}$/.test(phone) && !/^\+?\d{10,15}$/.test(phone)) {
        alert("Enter valid phone number");
        return;
      }

      await sendOrder(phone, pendingForm);
      close();
      continueSubmit(pendingForm);
    };
  }

  function isCheckout(form) {
    if (!form || handled.has(form)) return false;

    let score = 0;

    form.querySelectorAll("input, textarea, select").forEach(el => {
      const m = meta(el);
      if (/phone|mobile|contact|whatsapp/.test(m)) score += 2;
      if (/name|customer/.test(m)) score += 2;
      if (/address|city|shipping|billing/.test(m)) score += 2;
      if (/email/.test(m)) score += 1;
      if (/payment|cod|card/.test(m)) score += 1;
    });

    if (/checkout|place order|confirm order|billing|shipping|delivery/i.test(clean(form.innerText))) score += 3;

    return score >= 5;
  }

  document.addEventListener("submit", async e => {
    const form = e.target;
    if (!isCheckout(form)) return;

    e.preventDefault();
    handled.add(form);
    pendingForm = form;

    const phone = phoneFrom(form);

    if (phone) {
      await sendOrder(phone, form);
      continueSubmit(form);
    } else {
      handled.delete(form);
      openBot();
    }
  }, true);

  console.log("VerifyOrders bot loaded");
})();