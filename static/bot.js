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
  let alreadyHandledForms = new WeakSet();

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

  function lower(value) {
    return cleanText(value).toLowerCase();
  }

  function textHasMoney(text) {
    return /(PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)\s?\d/i.test(text || "");
  }

  function extractMoney(text) {
    const cleaned = cleanText(text);
    const match =
      cleaned.match(
        /(PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)\s?[\d,]+(?:\.\d{1,2})?/i
      ) || cleaned.match(/[\d,]+(?:\.\d{1,2})?/);
    return match ? match[0] : "";
  }

  function guessCurrency(text) {
    const t = cleanText(text);
    const m =
      t.match(/\b(PKR|USD|INR|AED|SAR|EUR|GBP)\b/i) ||
      t.match(/Rs\.?|₹|\$|€|£/i);

    if (!m) return "";

    const val = m[0].toUpperCase();
    if (val === "RS." || val === "RS") return "PKR";
    if (val === "₹") return "INR";
    if (val === "$") return "USD";
    if (val === "€") return "EUR";
    if (val === "£") return "GBP";
    return val;
  }

  function uniqueList(arr) {
    return [...new Set(arr.filter(Boolean).map((x) => cleanText(x)).filter(Boolean))];
  }

  function isVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function safeInnerText(el) {
    return cleanText(el?.innerText || el?.textContent || "");
  }

  function getLabelText(el) {
    if (!el) return "";
    const id = el.id;

    if (id) {
      const label = document.querySelector(`label[for="${id}"]`);
      if (label) return safeInnerText(label);
    }

    const parentLabel = el.closest("label");
    if (parentLabel) return safeInnerText(parentLabel);

    const prev = el.previousElementSibling;
    if (prev) return safeInnerText(prev);

    return "";
  }

  function getFieldMeta(field) {
    return lower(
      `${field.name || ""} ${field.id || ""} ${field.placeholder || ""} ${
        field.getAttribute("aria-label") || ""
      } ${getLabelText(field)}`
    );
  }

  function getFieldValue(form, patterns) {
    const fields = form.querySelectorAll("input, textarea, select");

    for (const field of fields) {
      const text = getFieldMeta(field);

      if (patterns.some((p) => text.includes(p))) {
        if (field.tagName === "SELECT") {
          return cleanText(field.options[field.selectedIndex]?.text || field.value);
        }
        if ((field.type || "").toLowerCase() === "checkbox") {
          return field.checked ? "checked" : "";
        }
        if ((field.type || "").toLowerCase() === "radio") {
          return field.checked ? cleanText(field.value) : "";
        }
        return cleanText(field.value);
      }
    }

    return "";
  }

  function detectPhone(form) {
    const inputs = form.querySelectorAll("input, textarea");

    for (const input of inputs) {
      const key = getFieldMeta(input);

      if (/phone|mobile|whatsapp|contact|number|cell/.test(key)) {
        let val = cleanText(input.value).replace(/\s+/g, "");

        if (/^03\d{9}$/.test(val)) return val;
        if (/^\+923\d{9}$/.test(val)) return val.replace("+92", "0");
        if (/^923\d{9}$/.test(val)) return "0" + val.slice(2);

        if (val) return val;
      }
    }

    return "";
  }

  function getMetaContent(selector) {
    return cleanText(document.querySelector(selector)?.content || "");
  }

  function getCanonicalUrl() {
    const canonical = document.querySelector("link[rel='canonical']")?.href;
    return canonical ? absoluteUrl(canonical) : "";
  }

  function looksLikeCheckoutUrl(url) {
    const u = lower(url);
    return /checkout|cart|basket|order|pay|payment/.test(u);
  }

  function sliceText(value, max) {
    return cleanText(value).slice(0, max);
  }

  function stringifySafe(value, max = 12000) {
    try {
      return JSON.stringify(value).slice(0, max);
    } catch {
      return "";
    }
  }

  function getPageLanguage() {
    return (
      document.documentElement.getAttribute("lang") ||
      navigator.language ||
      ""
    );
  }

  function getViewportInfo() {
    return `${window.innerWidth}x${window.innerHeight}`;
  }

  function getSelectedPaymentMethod(form) {
    const checkedRadio = form.querySelector(
      'input[type="radio"]:checked[name], input[type="radio"]:checked'
    );
    if (checkedRadio) {
      return (
        cleanText(checkedRadio.value) ||
        getLabelText(checkedRadio) ||
        getFieldMeta(checkedRadio)
      );
    }

    const payment = getFieldValue(form, [
      "payment method",
      "payment",
      "cash on delivery",
      "cod",
      "bank transfer",
      "card",
      "easypaisa",
      "jazzcash",
      "nayapay",
      "sadapay",
    ]);

    return payment;
  }

  function detectCoupon(form, pageText) {
    return (
      getFieldValue(form, ["coupon", "promo", "discount code", "voucher"]) ||
      (
        pageText.match(
          /(?:coupon|promo|discount code|voucher)[^A-Za-z0-9]{0,8}([A-Za-z0-9\-_]{3,30})/i
        ) || []
      )[1] ||
      ""
    );
  }

  function detectShippingMethod(form, pageText) {
    return (
      getFieldValue(form, ["shipping method", "delivery method", "courier"]) ||
      (
        pageText.match(
          /(?:shipping method|delivery method|courier)[^A-Za-z0-9]{0,10}([A-Za-z0-9 \-_]{3,50})/i
        ) || []
      )[1] ||
      ""
    );
  }

  function detectPaymentStatusHint(pageText) {
    const t = lower(pageText);
    if (t.includes("cash on delivery")) return "cash_on_delivery";
    if (t.includes("paid")) return "paid";
    if (t.includes("unpaid")) return "unpaid";
    if (t.includes("pending payment")) return "pending_payment";
    return "";
  }

  function findOrderSummaryBlock() {
    const selectors = [
      "[data-order-summary]",
      "[data-checkout-summary]",
      ".order-summary",
      ".checkout-summary",
      ".cart-summary",
      ".summary-card",
      ".summary",
      "aside",
      "[class*='order-summary']",
      "[class*='checkout-summary']",
      "[class*='cart-summary']",
      "[class*='mini-cart']",
      "[class*='cart-totals']",
      "[class*='order-review']",
      "[id*='order-summary']",
      "[id*='checkout-summary']",
      "[id*='cart-summary']",
    ];

    for (const sel of selectors) {
      const candidates = [...document.querySelectorAll(sel)];
      for (const el of candidates) {
        const txt = safeInnerText(el);
        if (
          txt.length > 20 &&
          /summary|subtotal|total|delivery|shipping|order|checkout/i.test(txt)
        ) {
          return el;
        }
      }
    }

    const allBlocks = [...document.querySelectorAll("section, div, aside, main")];
    let best = null;
    let bestScore = -1;

    for (const el of allBlocks) {
      const txt = safeInnerText(el);
      if (txt.length < 20 || txt.length > 6000) continue;

      let score = 0;
      if (/order summary/i.test(txt)) score += 6;
      if (/checkout/i.test(txt)) score += 3;
      if (/subtotal/i.test(txt)) score += 3;
      if (/delivery|shipping/i.test(txt)) score += 3;
      if (/(^|\s)total(\s|:)/i.test(txt)) score += 4;
      if (textHasMoney(txt)) score += 2;
      if (el.querySelector("img")) score += 1;

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best || document.body;
  }

  function detectProductLinks(summary, imgs) {
    const urls = [];

    const linkSelectors = [
      "a[href*='/product/']",
      "a[href*='/products/']",
      "a[href*='/shop/']",
      "a[href*='/item/']",
      "a[href*='product_id']",
      "a[href*='slug']",
      "a[href*='sku']",
      "a[href*='variant']",
      "a[data-product-url]",
      "[data-product-url]",
      "a[href]",
    ];

    for (const sel of linkSelectors) {
      const nodes = [...summary.querySelectorAll(sel), ...document.querySelectorAll(sel)];
      for (const node of nodes) {
        const href =
          node.getAttribute?.("data-product-url") ||
          node.href ||
          node.getAttribute?.("href") ||
          "";
        const abs = absoluteUrl(href);
        if (!abs) continue;
        if (looksLikeCheckoutUrl(abs)) continue;
        if (/javascript:|mailto:|tel:/i.test(abs)) continue;
        urls.push(abs);
      }
    }

    if (imgs.length) {
      const imgLink = imgs[0]?.closest("a[href]");
      if (imgLink?.href && !looksLikeCheckoutUrl(imgLink.href)) {
        urls.push(absoluteUrl(imgLink.href));
      }
    }

    const canonical = getCanonicalUrl();
    if (canonical && !looksLikeCheckoutUrl(canonical)) {
      urls.push(canonical);
    }

    const ogUrl = getMetaContent('meta[property="og:url"]');
    if (ogUrl && !looksLikeCheckoutUrl(ogUrl)) {
      urls.push(absoluteUrl(ogUrl));
    }

    const current = window.location.href;
    urls.push(current);

    const cleaned = uniqueList(urls);

    cleaned.sort((a, b) => {
      const score = (url) => {
        let s = 0;
        const u = lower(url);
        if (/\/product\/|\/products\/|\/item\/|\/shop\//.test(u)) s += 7;
        if (/slug|sku|variant|product_id/.test(u)) s += 4;
        if (!looksLikeCheckoutUrl(u)) s += 3;
        if (u === lower(getCanonicalUrl())) s += 2;
        if (u === lower(window.location.href)) s -= 2;
        return s;
      };
      return score(b) - score(a);
    });

    return cleaned;
  }

  function detectProductName(summary) {
    const selectors = [
      "[data-product-name]",
      "[data-testid*='product']",
      "[class*='product-name']",
      "[class*='product-title']",
      ".product-title",
      ".cart-item-title",
      ".order-item-title",
      "h1",
      "h2",
      "h3",
      "h4",
      "strong",
      "a",
    ];

    for (const sel of selectors) {
      const candidates = [...summary.querySelectorAll(sel), ...document.querySelectorAll(sel)];
      for (const el of candidates) {
        const txt = safeInnerText(el);
        if (!txt || txt.length < 3 || txt.length > 200) continue;
        if (/order summary|delivery fee|shipping fee|subtotal|total|coupon|secure checkout|billing|shipping/i.test(txt)) continue;
        if (textHasMoney(txt)) continue;
        return txt;
      }
    }

    return (
      getMetaContent('meta[property="og:title"]') ||
      getMetaContent('meta[name="twitter:title"]') ||
      cleanText(document.title)
    );
  }

  function detectImages(summary) {
    const imgs = [...summary.querySelectorAll("img"), ...document.querySelectorAll("img")].filter(
      (img) => {
        const src = lower(img.currentSrc || img.src || "");
        return (
          src &&
          !src.includes("logo") &&
          !src.includes("icon") &&
          !src.includes("avatar") &&
          !src.includes("banner") &&
          !src.includes("sprite") &&
          (img.naturalWidth || 0) >= 40 &&
          (img.naturalHeight || 0) >= 40
        );
      }
    );

    imgs.sort(
      (a, b) =>
        (b.naturalWidth || 0) * (b.naturalHeight || 0) -
        (a.naturalWidth || 0) * (a.naturalHeight || 0)
    );

    return imgs;
  }

  function extractLineMoney(pageText, patterns) {
    for (const pattern of patterns) {
      const m = pageText.match(pattern);
      if (m) return extractMoney(m[0]);
    }
    return "";
  }

  function detectProduct() {
    const product = {
      name: "",
      price: "",
      delivery_fee: "",
      subtotal: "",
      discount: "",
      total_price: "",
      currency: "",
      image: "",
      image_candidates: [],
      url: "",
      url_candidates: [],
      canonical_url: "",
      quantity: "",
      summary_text: "",
      page_text_snapshot: "",
      page_html_snapshot: "",
      payment_method: "",
      shipping_method: "",
      coupon_code: "",
      payment_status_hint: "",
    };

    const summary = findOrderSummaryBlock();
    const summaryText = safeInnerText(summary);
    const pageText = safeInnerText(document.body);

    product.summary_text = sliceText(summaryText, 2500);
    product.page_text_snapshot = sliceText(pageText, 6000);
    product.page_html_snapshot = (document.body?.innerHTML || "").slice(0, 30000);

    product.name = detectProductName(summary);

    product.currency =
      guessCurrency(summaryText) ||
      guessCurrency(pageText) ||
      "";

    product.delivery_fee = extractLineMoney(summaryText, [
      /(?:delivery fee|shipping fee|delivery|shipping)[^A-Za-z0-9]{0,12}(?:PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)?\s?[\d,]+(?:\.\d{1,2})?/i,
    ]);

    product.subtotal = extractLineMoney(summaryText, [
      /(?:subtotal|sub total)[^A-Za-z0-9]{0,12}(?:PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)?\s?[\d,]+(?:\.\d{1,2})?/i,
    ]);

    product.discount = extractLineMoney(summaryText, [
      /(?:discount|coupon|promo|voucher)[^A-Za-z0-9]{0,12}(?:PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)?\s?[\d,]+(?:\.\d{1,2})?/i,
    ]);

    product.total_price = extractLineMoney(summaryText, [
      /(?:grand total|total amount|total)[^A-Za-z0-9]{0,12}(?:PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)?\s?[\d,]+(?:\.\d{1,2})?/i,
    ]);

    const moneyBits =
      summaryText.match(
        /(PKR|Rs\.?|INR|₹|USD|\$|EUR|€|GBP|£|AED|SAR)\s?[\d,]+(?:\.\d{1,2})?/gi
      ) || [];

    if (!product.price && moneyBits.length) {
      product.price = moneyBits[0];
    }

    if (!product.total_price && moneyBits.length > 1) {
      product.total_price = moneyBits[moneyBits.length - 1];
    }

    if (!product.subtotal && moneyBits.length) {
      product.subtotal = moneyBits[0];
    }

    const qtyMatch =
      summaryText.match(/(?:qty|quantity)[^\d]{0,8}(\d+)/i) ||
      summaryText.match(/(?:×|x)\s?(\d+)/i);

    if (qtyMatch) product.quantity = qtyMatch[1];

    const imgs = detectImages(summary);
    product.image_candidates = imgs
      .slice(0, 5)
      .map((img) => absoluteUrl(img.currentSrc || img.src || ""));

    if (product.image_candidates.length) {
      product.image = product.image_candidates[0];
    }

    product.canonical_url = getCanonicalUrl();
    product.url_candidates = detectProductLinks(summary, imgs);
    product.url = product.url_candidates[0] || window.location.href;

    product.payment_method = "";
    product.shipping_method = "";
    product.coupon_code = "";
    product.payment_status_hint = detectPaymentStatusHint(pageText);

    return product;
  }

  function extractFormData(form) {
    const formData = new FormData(form);
    const data = {};

    formData.forEach((value, key) => {
      if (typeof value === "string") {
        data[key] = cleanText(value);
      } else {
        data[key] = value;
      }
    });

    const product = detectProduct();
    const pageText = safeInnerText(document.body);

    data["_page"] = window.location.href;
    data["_canonical_url"] = product.canonical_url || getCanonicalUrl();
    data["_title"] = document.title;
    data["_time"] = new Date().toISOString();
    data["_referrer"] = document.referrer;
    data["_device"] = navigator.userAgent;
    data["_language"] = getPageLanguage();
    data["_viewport"] = getViewportInfo();

    data["_product_name"] = product.name;
    data["_product_price"] = product.price;
    data["_product_subtotal"] = product.subtotal;
    data["_discount_amount"] = product.discount;
    data["_delivery_fee"] = product.delivery_fee;
    data["_total_price"] = product.total_price;
    data["_currency"] = product.currency;
    data["_product_image"] = product.image;
    data["_product_image_candidates"] = product.image_candidates.join(" | ");
    data["_product_url"] = product.url;
    data["_product_url_candidates"] = product.url_candidates.join(" | ");
    data["_product_quantity"] = product.quantity;
    data["_summary_text"] = product.summary_text;
    data["_page_text_snapshot"] = product.page_text_snapshot;
    data["_page_html_snapshot"] = product.page_html_snapshot;

    data["_customer_name"] =
      getFieldValue(form, ["full name", "name", "customer", "billing name"]) ||
      data.name ||
      "";
    data["_customer_email"] =
      getFieldValue(form, ["email", "billing email"]) || data.email || "";
    data["_customer_city"] =
      getFieldValue(form, ["city", "town"]) || data.city || "";
    data["_customer_address"] =
      getFieldValue(form, ["address", "shipping", "street", "billing address"]) ||
      data.address ||
      "";
    data["_customer_postal_code"] =
      getFieldValue(form, ["postal", "zip", "postcode"]) ||
      data.postcode ||
      data.zip ||
      "";
    data["_customer_phone"] = detectPhone(form);

    data["_payment_method"] = getSelectedPaymentMethod(form) || product.payment_method;
    data["_shipping_method"] = detectShippingMethod(form, pageText);
    data["_coupon_code"] = detectCoupon(form, pageText);
    data["_payment_status_hint"] = product.payment_status_hint;

    data["_checkout_detected"] = "true";
    data["_bot_version"] = "v2_ultra";

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
          form_data: orderData,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok || !data.success) {
        console.log("❌ Failed:", data.message || "Unknown error");
        isSubmitting = false;
        return;
      }

      console.log("✅ V2 Ultra order captured");
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
        width:340px;
        max-width:calc(100vw - 24px);
        background:#fff;
        color:#111;
        padding:20px;
        border-radius:18px;
        box-shadow:0 10px 40px rgba(0,0,0,0.22);
        z-index:999999;
        font-family:Arial,sans-serif;
      ">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <h4 style="margin:0;font-size:18px;">Confirm Order</h4>
          <button id="bot-close" style="border:none;background:transparent;font-size:18px;cursor:pointer;">✕</button>
        </div>

        <p style="margin:10px 0 12px;font-size:13px;color:#666;">
          Enter your phone number to continue checkout.
        </p>

        <input id="bot-phone" placeholder="03XXXXXXXXX"
          style="width:100%;padding:12px;border:1px solid #ccc;border-radius:10px;outline:none;box-sizing:border-box;">

        <button id="bot-btn"
          style="margin-top:10px;width:100%;padding:12px;background:#111;color:#fff;border:none;border-radius:10px;cursor:pointer;font-weight:700;">
          Confirm
        </button>
      </div>
    `;

    document.body.appendChild(wrapper);

    const close = () => {
      wrapper.remove();
      botOpened = false;
    };

    document.getElementById("bot-close").onclick = close;

    document.getElementById("bot-btn").onclick = () => {
      const phone = cleanText(
        document.getElementById("bot-phone").value
      ).replace(/\s+/g, "");

      if (!/^03\d{9}$/.test(phone) && !/^\+?\d{10,15}$/.test(phone)) {
        alert("Enter valid number");
        return;
      }

      sendOrder(phone, pendingForm);
      close();

      setTimeout(() => {
        try {
          pendingForm.submit();
        } catch (e) {
          console.log("Submit retry failed:", e);
        }
      }, 300);
    };
  }

  /* ===============================
     🧠 CHECKOUT DETECTOR
  =============================== */
  function isCheckoutForm(form) {
    if (!form || alreadyHandledForms.has(form)) return false;

    const inputs = form.querySelectorAll("input, textarea, select");
    if (!inputs.length) return false;

    let score = 0;

    inputs.forEach((input) => {
      const key = getFieldMeta(input);

      if (/phone|mobile|contact|whatsapp/.test(key)) score += 2;
      if (/name|full name|customer/.test(key)) score += 2;
      if (/address|city|shipping|billing|postal|zip|postcode/.test(key)) score += 2;
      if (/email/.test(key)) score += 1;
      if (/payment|card|cash on delivery|cod/.test(key)) score += 1;
    });

    const formText = safeInnerText(form);
    if (/checkout|place order|confirm order|billing|shipping|delivery/i.test(formText)) {
      score += 3;
    }

    return score >= 5;
  }

  /* ===============================
     🎯 INTERCEPT SUBMIT
  =============================== */
  document.addEventListener(
    "submit",
    function (e) {
      const form = e.target;
      if (!isCheckoutForm(form)) return;

      if (alreadyHandledForms.has(form)) return;
      alreadyHandledForms.add(form);

      const phone = detectPhone(form);

      if (phone) {
        sendOrder(phone, form);
      } else {
        e.preventDefault();
        pendingForm = form;
        alreadyHandledForms.delete(form);
        createBot();
      }
    },
    true
  );

  console.log("✅ V2 Ultra bot loaded");
})();