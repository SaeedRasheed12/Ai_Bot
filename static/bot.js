(function () {

  const scriptTag = document.currentScript;
  const params = new URLSearchParams(scriptTag.src.split("?")[1] || "");
  const store = params.get("store");

  const API_BASE = new URL(scriptTag.src).origin;

  let botOpened = false;
  let pendingForm = null;
  let isSubmitting = false;

  /* ===============================
     🎉 SUCCESS UI
  =============================== */
  function showSuccessMessage() {
    const overlay = document.createElement("div");

    overlay.innerHTML = `
      <div style="
        position:fixed;
        top:0;left:0;
        width:100%;height:100%;
        background:rgba(0,0,0,0.6);
        display:flex;
        align-items:center;
        justify-content:center;
        z-index:9999999;
      ">
        <div style="
          background:white;
          padding:30px;
          border-radius:18px;
          text-align:center;
          width:320px;
          box-shadow:0 20px 60px rgba(0,0,0,0.3);
        ">
          <div style="font-size:50px;">✅</div>
          <h2 style="margin:10px 0;">Order Placed!</h2>
          <p style="font-size:14px;color:#555;">
            Your order has been received successfully.
          </p>

          <button id="success-ok" style="
            margin-top:15px;
            padding:10px 20px;
            background:#111;
            color:white;
            border:none;
            border-radius:10px;
            cursor:pointer;
          ">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById("success-ok").onclick = () => {
      overlay.remove();
    };

    setTimeout(() => overlay.remove(), 3000);
  }

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
     🚀 SEND ORDER
  =============================== */
  async function sendOrder(phone, form) {

    if (isSubmitting) return false;
    isSubmitting = true;

    try {

      const orderData = extractFormData(form);

      const res = await fetch(`${API_BASE}/api/new-order`, {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({
          store: store,
          phone: phone,
          form_data: orderData
        })
      });

      const data = await res.json();

      if (!data.success) {
        console.log("Order failed");
        isSubmitting = false;
        return false;
      }

      showSuccessMessage();
      return true;

    } catch (err) {
      console.log("Server error");
      isSubmitting = false;
      return false;
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
        width:340px;
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

    document.getElementById("bot-btn").onclick = async () => {
      const phone = document.getElementById("bot-phone").value.trim();

      if (!/^03\d{9}$/.test(phone)) {
        alert("Enter valid number");
        return;
      }

      const ok = await sendOrder(phone, pendingForm);

      if (ok) {
        wrapper.remove();
        setTimeout(() => pendingForm.submit(), 800);
      }
    };
  }

  /* ===============================
     🧠 DETECT CHECKOUT
  =============================== */
  function isCheckoutForm(form){
    const inputs = form.querySelectorAll("input,textarea");

    let hasPhone=false, hasName=false, hasAddress=false;

    inputs.forEach(input=>{
      const key = ((input.name||"") + " " + (input.placeholder||"")).toLowerCase();

      if(key.includes("phone") || key.includes("mobile")) hasPhone=true;
      if(key.includes("name")) hasName=true;
      if(key.includes("address") || key.includes("city")) hasAddress=true;
    });

    return hasPhone && hasName && hasAddress;
  }

  /* ===============================
     🎯 INTERCEPT SUBMIT
  =============================== */
  document.addEventListener("submit", async function(e){

    const form = e.target;

    if(!isCheckoutForm(form)) return;

    e.preventDefault();

    pendingForm = form;

    const phone = detectPhone(form);

    if (phone) {
      const ok = await sendOrder(phone, form);

      if (ok) {
        setTimeout(() => form.submit(), 800);
      }
    } else {
      createBot();
    }

  }, true);

})();