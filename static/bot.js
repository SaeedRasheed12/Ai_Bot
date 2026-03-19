(function () {
  /* ===============================
     🔍 SAFE SCRIPT DETECTION
  =============================== */
  const scriptTag =
    document.currentScript ||
    [...document.querySelectorAll("script")].find(
      (s) => s.src && s.src.includes("/static/bot.js")
    );

  if (!scriptTag) {
    console.log("❌ Bot script not found");
    return;
  }

  const scriptUrl = new URL(scriptTag.src);
  const params = new URLSearchParams(scriptUrl.search);
  const store = params.get("store");
  const API_BASE = scriptUrl.origin;

  let botOpened = false;
  let pendingForm = null;
  let isSubmitting = false;

  /* ===============================
     🧹 HELPERS
  =============================== */
  function cleanText(value) {
    return (value || "").replace(/\s+/g, " ").trim();
  }

  function absoluteUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch {
      return url || "";
    }
  }

  function textHasMoney(text) {
    return /(PKR|Rs\.?|₹|\$)\s?\d/i.test(text || "");
  }

  function extractMoney(text) {
    const cleaned = cleanText(text);
    const match =
      cleaned.match(/(PKR|Rs\.?|₹|\$)\s?[\d,]+(?:\.\d{1,2})?/i) ||
      cleaned.match(/[\d,]+(?:\.\d{1,2})?/);
    return match ? match[0] : "";
  }

  function getFieldValue(form, patterns) {
    const fields = form.querySelectorAll("input, textarea, select");

    for (const field of fields) {
      const text = cleanText(
        `${field.name || ""} ${field.id || ""} ${field.placeholder || ""} ${field.getAttribute("aria-label") || ""}`
      ).toLowerCase();

      if (patterns.some((p) => text.includes(p))) {
        if (field.tagName === "SELECT") {
          return cleanText(field.options[field.selectedIndex]?.text || field.value);
        }
        return cleanText(field.value);
      }
    }

    return "";
  }

  function getLabelText(el) {
    if (!el) return "";
    const id = el.id;
    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return cleanText(label.innerText);
    }

    const parentLabel = el.closest("label");
    if (parentLabel) return cleanText(parentLabel.innerText);

    const prev = el.previousElementSibling;
    if (prev) return cleanText(prev.innerText);

    return "";
  }

  /* ===============================
     🔍 DETECT PHONE
  =============================== */
  function detectPhone(form) {
    const inputs = form.querySelectorAll("input, textarea");

    for (const input of inputs) {
      const key = cleanText(
        `${input.name || ""} ${input.placeholder || ""} ${input.id || ""} ${getLabelText(input)}`
      ).toLowerCase();

      if (/phone|mobile|whatsapp|contact|number/.test(key)) {
        let val = cleanText(input.value).replace(/\s+/g, "");

        if (/^03\d{9}$/.test(val)) return val;
        if (/^\+923\d{9}$/.test(val)) return val.replace("+92", "0");
        if (/^923\d{9}$/.test(val)) return "0" + val.slice(2);
      }
    }

    return "";
  }

  /* ===============================
     🧠 FIND ORDER SUMMARY BLOCK
  =============================== */
  function findOrderSummaryBlock() {
    const selectors = [
      "[data-order-summary]",
      "[data-checkout-summary]",
      ".order-summary",
      ".checkout-summary",
      ".cart-summary",
      ".summary-card",
      ".summary",
      "[class*='order-summary']",
      "[class*='checkout-summary']",
      "[class*='cart-summary']"
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && cleanText(el.innerText).length > 20) return el;
    }

    const allDivs = [...document.querySelectorAll("section, div, aside")];
    for (const el of allDivs) {
      const txt = cleanText(el.innerText);
      if (
        txt.includes("Order Summary") ||
        txt.includes("Total:") ||
        txt.includes("Delivery Fee") ||
        txt.includes("Secure Checkout")
      ) {
        return el;
      }
    }

    return document.body;
  }

  /* ===============================
     🛒 DETECT PRODUCT + PRICING
  =============================== */
  function detectProduct() {
    const product = {
      name: "",
      price: "",
      delivery_fee: "",
      total_price: "",
      image: "",
      url: "",
      quantity: "",
      summary_text: ""
    };

    const summary = findOrderSummaryBlock();
    product.summary_text = cleanText(summary.innerText).slice(0, 1500);

    /* ---------- product name ---------- */
    const nameSelectors = [
      "[data-product-name]",
      "[class*='product-name']",
      ".product-title",
      ".cart-item-title",
      ".order-item-title",
      "h3",
      "h4",
      "strong"
    ];

    for (const sel of nameSelectors) {
      const candidates = [...summary.querySelectorAll(sel)];
      for (const el of candidates) {
        const txt = cleanText(el.innerText);
        if (
          txt &&
          txt.length > 3 &&
          !/order summary|delivery fee|total|coupon|secure checkout/i.test(txt) &&
          !textHasMoney(txt)
        ) {
          product.name = txt;
          break;
        }
      }
      if (product.name) break;
    }

    /* ---------- prices ---------- */
    const summaryText = cleanText(summary.innerText);

    const deliveryRow =
      [...summary.querySelectorAll("*")].find((el) =>
        /delivery fee|shipping fee|delivery/i.test(cleanText(el.innerText))
      ) || null;

    if (deliveryRow) {
      product.delivery_fee = extractMoney(deliveryRow.innerText);
    } else {
      const dm = summaryText.match(/(?:Delivery Fee|Shipping Fee|Delivery)[^0-9A-Z]*(PKR|Rs\.?|₹|\$)?\s?[\d,]+(?:\.\d{1,2})?/i);
      if (dm) product.delivery_fee = extractMoney(dm[0]);
    }

    const totalRow =
      [...summary.querySelectorAll("*")].find((el) =>
        /(^|\s)total(\s|:)/i.test(cleanText(el.innerText))
      ) || null;

    if (totalRow) {
      product.total_price = extractMoney(totalRow.innerText);
    } else {
      const tm = summaryText.match(/Total[^0-9A-Z]*(PKR|Rs\.?|₹|\$)?\s?[\d,]+(?:\.\d{1,2})?/i);
      if (tm) product.total_price = extractMoney(tm[0]);
    }

    const moneyBits = summaryText.match(/(PKR|Rs\.?|₹|\$)\s?[\d,]+(?:\.\d{1,2})?/gi) || [];
    if (!product.price && moneyBits.length) {
      product.price = moneyBits[0];
    }

    if (!product.total_price && moneyBits.length > 1) {
      product.total_price = moneyBits[moneyBits.length - 1];
    }

    /* ---------- quantity ---------- */
    const qtyMatch = summaryText.match(/(?:×|x)\s?(\d+)/i);
    if (qtyMatch) product.quantity = qtyMatch[1];

    /* ---------- image ---------- */
    const imgs = [...summary.querySelectorAll("img")].filter((img) => {
      const src = (img.currentSrc || img.src || "").toLowerCase();
      return (
        src &&
        !src.includes("logo") &&
        !src.includes("icon") &&
        !src.includes("avatar") &&
        !src.includes("banner") &&
        img.naturalWidth >= 40 &&
        img.naturalHeight >= 40
      );
    });

    if (imgs.length) {
      imgs.sort(
        (a, b) =>
          b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight
      );
      product.image = absoluteUrl(imgs[0].currentSrc || imgs[0].src);
    }

    /* ---------- product link ---------- */
    const linkSelectors = [
      "a[href*='/product/']",
      "a[href*='product_id']",
      "a[href*='slug']",
      "a[href*='item']",
      "a[href*='shop']"
    ];

    for (const sel of linkSelectors) {
      const link = summary.querySelector(sel) || document.querySelector(sel);
      if (link && link.href && !link.href.includes("/checkout")) {
        product.url = absoluteUrl(link.href);
        break;
      }
    }

    /* fallback: try image wrapped in link */
    if (!product.url) {
      const imgLink = imgs[0]?.closest("a[href]");
      if (imgLink && imgLink.href && !imgLink.href.includes("/checkout")) {
        product.url = absoluteUrl(imgLink.href);
      }
    }

    /* fallback: check og:url */
    if (!product.url) {
      const ogUrl = document.querySelector('meta[property="og:url"]')?.content;
      if (ogUrl && !ogUrl.includes("/checkout")) {
        product.url = absoluteUrl(ogUrl);
      }
    }

    /* fallback: keep page */
    if (!product.url) {
      product.url = window.location.href;
    }

    /* ---------- fallback name from metadata ---------- */
    if (!product.name) {
      const ogTitle =
        document.querySelector('meta[property="og:title"]')?.content ||
        document.querySelector('meta[name="twitter:title"]')?.content ||
        "";
      if (ogTitle) product.name = cleanText(ogTitle);
    }

    return product;
  }

  /* ===============================
     📦 EXTRACT FULL CHECKOUT DATA
  =============================== */
  function extractFormData(form) {
    const formData = new FormData(form);
    const data = {};

    formData.forEach((value, key) => {
      data[key] = typeof value === "string" ? cleanText(value) : value;
    });

    data["_page"] = window.location.href;
    data["_title"] = document.title;
    data["_time"] = new Date().toISOString();
    data["_referrer"] = document.referrer;
    data["_device"] = navigator.userAgent;

    const product = detectProduct();

    data["_product_name"] = product.name;
    data["_product_price"] = product.price;
    data["_delivery_fee"] = product.delivery_fee;
    data["_total_price"] = product.total_price;
    data["_product_image"] = product.image;
    data["_product_url"] = product.url;
    data["_product_quantity"] = product.quantity;
    data["_summary_text"] = product.summary_text;

    /* extra common checkout fields */
    data["_customer_name"] =
      getFieldValue(form, ["full name", "name", "customer"]) || data.name || "";
    data["_customer_email"] =
      getFieldValue(form, ["email"]) || data.email || "";
    data["_customer_city"] =
      getFieldValue(form, ["city", "town"]) || data.city || "";
    data["_customer_address"] =
      getFieldValue(form, ["address", "shipping", "street"]) || data.address || "";
    data["_customer_phone"] = detectPhone(form);

    data["_page_text_snapshot"] = cleanText(document.body.innerText).slice(0, 4000);

    return data;
  }

  /* ===============================
     🚀 SEND ORDER
  =============================== */
  async function sendOrder(phone, form) {
    if (isSubmitting) return;
    isSubmitting = true;

    try {
      const orderData = extractFormData(form);

      const res = await fetch(`${API_BASE}/api/new-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store: store,
          phone: phone,
          form_data: orderData
        })
      });

      const data = await res.json();

      if (!data.success) {
        console.log("❌ Failed:", data.message);
        isSubmitting = false;
        return;
      }

      console.log("✅ Order captured fully");
      isSubmitting = false;
    } catch (err) {
      console.log("❌ Server error:", err);
      isSubmitting = false;
    }
  }

  /* ===============================
     🤖 FALLBACK BOT
  =============================== */
  function createBot() {
    if (botOpened) return;
    botOpened = true;

    const wrapper = document.createElement("div");
    wrapper.id = "order-bot-wrapper";

    wrapper.innerHTML = `
      <div style="
        position:fixed;
        bottom:20px;
        right:20px;
        width:320px;
        max-width:calc(100vw - 24px);
        background:#fff;
        padding:20px;
        border-radius:16px;
        box-shadow:0 10px 40px rgba(0,0,0,0.2);
        z-index:999999;
        font-family:Arial,sans-serif;
      ">
        <h4 style="margin:0 0 10px;font-size:18px;">Confirm Order</h4>
        <p style="margin:0 0 10px;font-size:13px;color:#666;">Enter your phone number to continue checkout.</p>

        <input id="bot-phone" placeholder="03XXXXXXXXX"
          style="width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;outline:none;box-sizing:border-box;">

        <button id="bot-btn"
          style="margin-top:10px;width:100%;padding:12px;background:#111;color:#fff;border:none;border-radius:10px;cursor:pointer;">
          Confirm
        </button>
      </div>
    `;

    document.body.appendChild(wrapper);

    document.getElementById("bot-btn").onclick = () => {
      const phone = cleanText(document.getElementById("bot-phone").value).replace(/\s+/g, "");

      if (!/^03\d{9}$/.test(phone)) {
        alert("Enter valid number");
        return;
      }

      sendOrder(phone, pendingForm);
      wrapper.remove();
      botOpened = false;

      setTimeout(() => {
        pendingForm.submit();
      }, 300);
    };
  }

  /* ===============================
     🧠 CHECKOUT DETECTOR
  =============================== */
  function isCheckoutForm(form) {
    const inputs = form.querySelectorAll("input, textarea, select");

    let hasPhone = false;
    let hasName = false;
    let hasAddress = false;

    inputs.forEach((input) => {
      const key = cleanText(
        `${input.name || ""} ${input.placeholder || ""} ${input.id || ""} ${getLabelText(input)}`
      ).toLowerCase();

      if (/phone|mobile/.test(key)) hasPhone = true;
      if (/name/.test(key)) hasName = true;
      if (/address|city|shipping/.test(key)) hasAddress = true;
    });

    return hasPhone && hasName && hasAddress;
  }

  /* ===============================
     🎯 INTERCEPT SUBMIT
  =============================== */
  document.addEventListener(
    "submit",
    function (e) {
      const form = e.target;
      if (!isCheckoutForm(form)) return;

      const phone = detectPhone(form);

      if (phone) {
        sendOrder(phone, form);
      } else {
        e.preventDefault();
        pendingForm = form;
        createBot();
      }
    },
    true
  );
})();