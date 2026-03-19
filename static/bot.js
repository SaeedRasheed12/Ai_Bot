(function () {

  /* ===============================
     🔍 SAFE SCRIPT DETECTION
  =============================== */
  const scriptTag =
    document.currentScript ||
    [...document.querySelectorAll("script")].find(s =>
      s.src && s.src.includes("/static/bot.js")
    );

  if (!scriptTag) {
    console.log("❌ Bot script not found");
    return;
  }

  const scriptUrl = new URL(scriptTag.src);
  const params = new URLSearchParams(scriptUrl.search);
  const store = params.get("store");
  const API_BASE = scriptUrl.origin;

  console.log("🔥 BOT LOADED");
  console.log("Store:", store);
  console.log("API:", API_BASE);

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

      if (
        key.includes("phone") ||
        key.includes("mobile") ||
        key.includes("whatsapp") ||
        key.includes("contact") ||
        key.includes("number")
      ) {
        let val = (input.value || "").trim().replace(/\s+/g, "");

        if (/^03\d{9}$/.test(val)) return val;
        if (/^\+923\d{9}$/.test(val)) return val.replace("+92", "0");
        if (/^923\d{9}$/.test(val)) return "0" + val.slice(2);
      }
    }

    return "";
  }

  /* ===============================
     📦 EXTRACT DATA
  =============================== */
  function extractFormData(form) {
    const formData = new FormData(form);
    let data = {};

    formData.forEach((value, key) => {
      if (typeof value === "string") value = value.trim();
      data[key] = value;
    });

    data["_page"] = window.location.href;
    data["_title"] = document.title;
    data["_time"] = new Date().toISOString();

    const nameEl = document.querySelector("h1,.product-title,[data-product-name]");
    const priceEl = document.querySelector(".price,.product-price");
    const imgEl = document.querySelector("img.product,.product img,img");

    data["_product_name"] = nameEl ? nameEl.innerText.trim() : "";
    data["_product_price"] = priceEl ? priceEl.innerText.trim() : "";
    data["_product_image"] = imgEl ? imgEl.src : "";

    return data;
  }

  /* ===============================
     🚀 SEND ORDER (BACKGROUND)
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
        console.log("❌ Order failed:", data.message);
        isSubmitting = false;
        return;
      }

      console.log("✅ Order sent to bot system");

      isSubmitting = false;

    } catch (err) {
      console.log("❌ Server error:", err);
      isSubmitting = false;
    }
  }

  /* ===============================
     🤖 FALLBACK BOT (IF NO PHONE)
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
        <h4 style="margin-bottom:10px;">Confirm Order</h4>

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

      // resume normal submit
      setTimeout(() => pendingForm.submit(), 300);
    };
  }

  /* ===============================
     🧠 DETECT CHECKOUT
  =============================== */
  function isCheckoutForm(form) {
    const inputs = form.querySelectorAll("input,textarea");

    let hasPhone = false, hasName = false, hasAddress = false;

    inputs.forEach(input => {
      const key = ((input.name || "") + " " + (input.placeholder || "")).toLowerCase();

      if (key.includes("phone") || key.includes("mobile")) hasPhone = true;
      if (key.includes("name")) hasName = true;
      if (key.includes("address") || key.includes("city")) hasAddress = true;
    });

    return hasPhone && hasName && hasAddress;
  }

  /* ===============================
     🎯 INTERCEPT SUBMIT (NON BLOCKING)
  =============================== */
  document.addEventListener("submit", function (e) {

    const form = e.target;

    if (!isCheckoutForm(form)) return;

    const phone = detectPhone(form);

    if (phone) {
      // 🚀 background API call
      sendOrder(phone, form);
      // ✅ DO NOT block → website success page continues
    } else {
      // ❌ only block if no phone
      e.preventDefault();
      pendingForm = form;
      createBot();
    }

  }, true);

})();