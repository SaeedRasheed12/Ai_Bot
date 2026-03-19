(function () {

  /* ===============================
     🔍 SAFE SCRIPT DETECTION
  =============================== */
  const scriptTag =
    document.currentScript ||
    [...document.querySelectorAll("script")].find(s =>
      s.src && s.src.includes("/static/bot.js")
    );

  if (!scriptTag) return;

  const scriptUrl = new URL(scriptTag.src);
  const params = new URLSearchParams(scriptUrl.search);
  const store = params.get("store");
  const API_BASE = scriptUrl.origin;

  let botOpened = false;
  let pendingForm = null;
  let isSubmitting = false;

  /* ===============================
     🔍 DETECT PHONE
  =============================== */
  function detectPhone(form) {
    const inputs = form.querySelectorAll("input, textarea");

    for (let input of inputs) {
      const key = ((input.name || "") + " " + (input.placeholder || "")).toLowerCase();

      if (key.match(/phone|mobile|whatsapp|contact|number/)) {
        let val = (input.value || "").trim().replace(/\s+/g, "");

        if (/^03\d{9}$/.test(val)) return val;
        if (/^\+923\d{9}$/.test(val)) return val.replace("+92", "0");
        if (/^923\d{9}$/.test(val)) return "0" + val.slice(2);
      }
    }
    return "";
  }

  /* ===============================
     🧠 UNIVERSAL PRODUCT DETECTOR
  =============================== */
  function detectProduct() {

    let product = {
      name: "",
      price: "",
      image: "",
      url: window.location.href
    };

    // 🏷️ NAME
    const nameCandidates = [
      "[data-product-name]",
      ".product-title",
      ".title",
      "h1",
      "h2"
    ];

    for (let sel of nameCandidates) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 2) {
        product.name = el.innerText.trim();
        break;
      }
    }

    // 💰 PRICE (SMART SCAN)
    const priceSelectors = [
      "[data-product-price]",
      ".price",
      ".product-price",
      ".amount",
      "[class*='price']"
    ];

    for (let sel of priceSelectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.match(/\d/)) {
        product.price = el.innerText.trim();
        break;
      }
    }

    // fallback: scan whole page
    if (!product.price) {
      const text = document.body.innerText;
      const match = text.match(/Rs\.?\s?\d+|PKR\s?\d+|\d{3,6}/);
      if (match) product.price = match[0];
    }

    // 🖼️ IMAGE (SMART FILTER)
    const images = [...document.images];

    const valid = images.filter(img => {
      const src = img.src.toLowerCase();

      return (
        img.width > 200 &&
        img.height > 200 &&
        !src.includes("logo") &&
        !src.includes("icon") &&
        !src.includes("banner")
      );
    });

    if (valid.length) {
      product.image = valid.sort((a, b) => b.width - a.width)[0].src;
    }

    return product;
  }

  /* ===============================
     📦 EXTRACT FULL CHECKOUT DATA
  =============================== */
  function extractFormData(form) {
    const formData = new FormData(form);
    let data = {};

    formData.forEach((value, key) => {
      if (typeof value === "string") value = value.trim();
      data[key] = value;
    });

    // 🌐 META
    data["_page"] = window.location.href;
    data["_title"] = document.title;
    data["_time"] = new Date().toISOString();
    data["_referrer"] = document.referrer;
    data["_device"] = navigator.userAgent;

    // 🛒 PRODUCT
    const product = detectProduct();

    data["_product_name"] = product.name;
    data["_product_price"] = product.price;
    data["_product_image"] = product.image;
    data["_product_url"] = product.url;

    // 🧠 EXTRA (capture ALL visible text - powerful)
    data["_page_text_snapshot"] = document.body.innerText.slice(0, 2000);

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

      console.log("✅ Order captured FULLY");
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

    wrapper.innerHTML = `
      <div style="
        position:fixed;
        bottom:20px;
        right:20px;
        width:320px;
        background:white;
        padding:20px;
        border-radius:16px;
        box-shadow:0 10px 40px rgba(0,0,0,0.2);
        z-index:999999;
      ">
        <h4>Confirm Order</h4>

        <input id="bot-phone" placeholder="03XXXXXXXXX"
          style="width:100%;padding:10px;border:1px solid #ccc;border-radius:10px;">

        <button id="bot-btn"
          style="margin-top:10px;width:100%;padding:10px;background:black;color:white;border:none;border-radius:10px;">
          Confirm
        </button>
      </div>
    `;

    document.body.appendChild(wrapper);

    document.getElementById("bot-btn").onclick = () => {
      const phone = document.getElementById("bot-phone").value.trim();

      if (!/^03\d{9}$/.test(phone)) {
        alert("Enter valid number");
        return;
      }

      sendOrder(phone, pendingForm);

      wrapper.remove();
      setTimeout(() => pendingForm.submit(), 300);
    };
  }

  /* ===============================
     🧠 CHECKOUT DETECTOR
  =============================== */
  function isCheckoutForm(form) {
    const inputs = form.querySelectorAll("input,textarea");

    let hasPhone = false, hasName = false, hasAddress = false;

    inputs.forEach(input => {
      const key = ((input.name || "") + " " + (input.placeholder || "")).toLowerCase();

      if (key.match(/phone|mobile/)) hasPhone = true;
      if (key.includes("name")) hasName = true;
      if (key.match(/address|city/)) hasAddress = true;
    });

    return hasPhone && hasName && hasAddress;
  }

  /* ===============================
     🎯 INTERCEPT SUBMIT
  =============================== */
  document.addEventListener("submit", function (e) {

    const form = e.target;

    if (!isCheckoutForm(form)) return;

    const phone = detectPhone(form);

    if (phone) {
      sendOrder(phone, form); // background
    } else {
      e.preventDefault();
      pendingForm = form;
      createBot();
    }

  }, true);

})();