import os
import json
import uuid
from datetime import datetime

from flask import (
    Flask, render_template, request, redirect,
    jsonify, url_for, session, flash, abort
)
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename


app = Flask(__name__)
app.config["SECRET_KEY"] = "super-secret-change-this"
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///database.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["UPLOAD_FOLDER"] = os.path.join("static", "uploads")
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

os.makedirs(app.config["UPLOAD_FOLDER"], exist_ok=True)

db = SQLAlchemy(app)
CORS(app, supports_credentials=True)


# =========================================================
# MODELS
# =========================================================

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    full_name = db.Column(db.String(200), nullable=False)
    email = db.Column(db.String(200), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(255), nullable=False)

    is_admin = db.Column(db.Boolean, default=False)
    is_blocked = db.Column(db.Boolean, default=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    stores = db.relationship("Store", backref="owner", lazy=True, cascade="all, delete-orphan")

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)


class Store(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    business_name = db.Column(db.String(200), nullable=False)
    business_url = db.Column(db.String(500), nullable=False)
    owner_name = db.Column(db.String(200), nullable=False)
    business_email = db.Column(db.String(200), nullable=False)
    contact_number = db.Column(db.String(100), nullable=False)

    payment_amount = db.Column(db.String(50), default="2000 PKR")
    payment_screenshot = db.Column(db.String(500))

    status = db.Column(db.String(50), default="pending_payment_review", index=True)
    script_enabled = db.Column(db.Boolean, default=False)
    admin_note = db.Column(db.Text)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    approved_at = db.Column(db.DateTime)
    rejected_at = db.Column(db.DateTime)

    orders = db.relationship("BotOrder", backref="store_ref", lazy=True, cascade="all, delete-orphan")


class BotOrder(db.Model):
    id = db.Column(db.Integer, primary_key=True)

    token = db.Column(db.String(120), unique=True, index=True)

    store_id = db.Column(db.Integer, db.ForeignKey("store.id"), nullable=False)

    # ===============================
    # 📞 CORE INFO
    # ===============================
    phone = db.Column(db.String(50), nullable=False)
    page = db.Column(db.String(1000))
    canonical_url = db.Column(db.String(1000))
    customer_ip = db.Column(db.String(120))

    # ===============================
    # 📦 RAW DATA (FULL SNAPSHOT)
    # ===============================
    form_data = db.Column(db.Text)

    # ===============================
    # 👤 CUSTOMER DETAILS
    # ===============================
    customer_name = db.Column(db.String(255))
    customer_email = db.Column(db.String(255))
    customer_address = db.Column(db.Text)
    customer_city = db.Column(db.String(255))
    customer_postal_code = db.Column(db.String(100))

    # ===============================
    # 🛒 PRODUCT DETAILS
    # ===============================
    product_name = db.Column(db.String(255))
    product_price = db.Column(db.String(100))
    product_image = db.Column(db.String(1000))

    product_url = db.Column(db.String(1000))
    product_quantity = db.Column(db.String(50))

    # ===============================
    # 💰 PRICING BREAKDOWN
    # ===============================
    subtotal_price = db.Column(db.String(100))
    delivery_fee = db.Column(db.String(100))
    discount_amount = db.Column(db.String(100))
    total_price = db.Column(db.String(100))
    currency = db.Column(db.String(50))

    # ===============================
    # 💳 CHECKOUT META
    # ===============================
    payment_method = db.Column(db.String(100))
    shipping_method = db.Column(db.String(100))
    coupon_code = db.Column(db.String(100))
    payment_status_hint = db.Column(db.String(50))

    # ===============================
    # 📄 PAGE META
    # ===============================
    page_title = db.Column(db.String(500))
    submitted_at_text = db.Column(db.String(100))

    # ===============================
    # 🧠 SNAPSHOTS (POWERFUL)
    # ===============================
    summary_text = db.Column(db.Text)
    page_text_snapshot = db.Column(db.Text)
    page_html_snapshot = db.Column(db.Text)

    # ===============================
    # ⚙️ SYSTEM META
    # ===============================
    bot_version = db.Column(db.String(50))
    is_duplicate = db.Column(db.Boolean, default=False)

    status = db.Column(db.String(50), default="pending_verification", index=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    approved_at = db.Column(db.DateTime)
    rejected_at = db.Column(db.DateTime)

    # ===============================
    # 📦 RAW JSON PARSER
    # ===============================
    def get_form_data(self):
        try:
            return json.loads(self.form_data) if self.form_data else {}
        except Exception:
            return {}

    # ===============================
    # 🧾 CLEAN DISPLAY FIELDS
    # ===============================
    def summary_fields(self):
        data = self.get_form_data()
        cleaned = []

        for key, value in data.items():
            if value is None:
                continue

            key = str(key).strip()
            value = str(value).strip()

            if not value:
                continue

            cleaned.append({
                "key": key,
                "label": prettify_key(key),
                "value": value
            })

        return cleaned

    # ===============================
    # ⚡ QUICK SUMMARY (UI READY)
    # ===============================
    def short_summary(self):
        return {
            "product": self.product_name or "Unknown",
            "price": self.total_price or self.product_price,
            "customer": self.customer_name or self.phone,
            "status": self.status,
            "city": self.customer_city,
        }


# =========================================================
# HELPERS
# =========================================================

def allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def save_file(file):
    if not file or file.filename == "":
        return None

    if not allowed_file(file.filename):
        return None

    ext = file.filename.rsplit(".", 1)[1].lower()
    filename = f"{uuid.uuid4().hex}.{ext}"
    path = os.path.join(app.config["UPLOAD_FOLDER"], secure_filename(filename))
    file.save(path)
    return f"/static/uploads/{filename}"


def prettify_key(key):
    if not key:
        return ""

    key = str(key).replace("_", " ").replace("-", " ").strip()
    return " ".join(word.capitalize() for word in key.split())


def find_first_value(data, possible_keys):
    if not data:
        return ""

    normalized = {}
    for k, v in data.items():
        normalized[str(k).strip().lower()] = v

    for key in possible_keys:
        if key in normalized and str(normalized[key]).strip():
            return str(normalized[key]).strip()

    for actual_key, value in normalized.items():
        for key in possible_keys:
            if key in actual_key and str(value).strip():
                return str(value).strip()

    return ""


def extract_order_fields(form_data):

    # ===============================
    # 👤 CUSTOMER DETAILS
    # ===============================
    customer_name = find_first_value(form_data, [
        "_customer_name", "name", "full name", "customer name", "billing name"
    ])

    customer_email = find_first_value(form_data, [
        "_customer_email", "email", "customer email", "billing email"
    ])

    customer_phone = (
        form_data.get("_customer_phone")
        or find_first_value(form_data, ["phone", "mobile", "contact"])
    )

    customer_address = find_first_value(form_data, [
        "_customer_address", "address", "shipping address", "billing address", "street address"
    ])

    customer_city = find_first_value(form_data, [
        "_customer_city", "city", "town"
    ])

    customer_postal_code = find_first_value(form_data, [
        "postal code", "postcode", "zip", "zip code"
    ])

    # ===============================
    # 🛒 PRODUCT DETAILS
    # ===============================
    product_name = (
        form_data.get("_product_name")
        or find_first_value(form_data, ["product", "product name", "item"])
    )

    product_price = (
        form_data.get("_product_price")
        or find_first_value(form_data, ["price", "product price", "amount"])
    )

    delivery_fee = (
        form_data.get("_delivery_fee")
        or find_first_value(form_data, ["delivery", "shipping fee"])
    )

    total_price = (
        form_data.get("_total_price")
        or find_first_value(form_data, ["total", "grand total"])
    )

    product_image = (
        form_data.get("_product_image")
        or find_first_value(form_data, ["image", "product image", "image url"])
    )

    product_url = form_data.get("_product_url", "")

    product_quantity = form_data.get("_product_quantity", "")

    # ===============================
    # 📄 META
    # ===============================
    page_title = form_data.get("_title", "")
    page_url = form_data.get("_page", "")
    submitted_at_text = form_data.get("_time", "")

    # ===============================
    # 🧠 EXTRA DEBUG (OPTIONAL)
    # ===============================
    summary_text = form_data.get("_summary_text", "")

    return {
        # 👤 customer
        "customer_name": customer_name,
        "customer_email": customer_email,
        "customer_phone": customer_phone,
        "customer_address": customer_address,
        "customer_city": customer_city,
        "customer_postal_code": customer_postal_code,

        # 🛒 product
        "product_name": product_name,
        "product_price": product_price,
        "delivery_fee": delivery_fee,
        "total_price": total_price,
        "product_image": product_image,
        "product_url": product_url,
        "product_quantity": product_quantity,

        # 📄 meta
        "page_title": page_title,
        "page_url": page_url,
        "submitted_at_text": submitted_at_text,

        # 🧠 debug
        "summary_text": summary_text,
    }

def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return db.session.get(User, user_id)


def login_required():
    user = current_user()
    if not user:
        return False
    if user.is_blocked:
        session.clear()
        return False
    return True


def admin_required():
    user = current_user()
    return bool(user and user.is_admin)


def build_bot_script(store_id):
    base_url = request.host_url.rstrip("/")
    return f'<script src="{base_url}/static/bot.js?store={store_id}"></script>'


@app.context_processor
def inject_helpers():
    return {
        "current_user": current_user(),
        "prettify_key": prettify_key
    }


# =========================================================
# ROUTES
# =========================================================

@app.route("/")
def index():
    return render_template("index.html")


# ---------------- AUTH ----------------

@app.route("/signup", methods=["GET", "POST"])
def signup():
    if request.method == "POST":
        full_name = request.form.get("full_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "").strip()

        if not full_name or not email or not password:
            flash("Please fill all fields.", "error")
            return redirect(url_for("signup"))

        existing = User.query.filter_by(email=email).first()
        if existing:
            flash("Email already exists.", "error")
            return redirect(url_for("signup"))

        user = User(full_name=full_name, email=email)
        user.set_password(password)

        db.session.add(user)
        db.session.commit()

        flash("Signup successful. Please login.", "success")
        return redirect(url_for("login"))

    return render_template("signup.html")


@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "").strip()

        user = User.query.filter_by(email=email).first()

        if not user or not user.check_password(password):
            flash("Invalid email or password.", "error")
            return redirect(url_for("login"))

        if user.is_blocked:
            flash("Your account is blocked.", "error")
            return redirect(url_for("login"))

        session["user_id"] = user.id

        if user.is_admin:
            return redirect(url_for("admin_dashboard"))
        return redirect(url_for("user_dashboard"))

    return render_template("login.html")


@app.route("/logout")
def logout():
    session.clear()
    flash("Logged out successfully.", "success")
    return redirect(url_for("index"))


# ---------------- BUSINESS SETUP ----------------

@app.route("/business/setup", methods=["GET", "POST"])
def business_setup():
    if not login_required():
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    user = current_user()
    existing_store = Store.query.filter_by(user_id=user.id).first()

    if existing_store:
        flash("You already submitted your business.", "info")
        return redirect(url_for("user_dashboard"))

    if request.method == "POST":
        business_name = request.form.get("business_name", "").strip()
        business_url = request.form.get("business_url", "").strip()
        owner_name = request.form.get("owner_name", "").strip()
        business_email = request.form.get("business_email", "").strip()
        contact_number = request.form.get("contact_number", "").strip()
        payment_amount = request.form.get("payment_amount", "2000 PKR").strip()

        payment_file = request.files.get("payment_screenshot")
        screenshot_path = save_file(payment_file)

        if not all([business_name, business_url, owner_name, business_email, contact_number]):
            flash("Please fill all required fields.", "error")
            return redirect(url_for("business_setup"))

        if not screenshot_path:
            flash("Please upload valid payment screenshot.", "error")
            return redirect(url_for("business_setup"))

        store = Store(
            user_id=user.id,
            business_name=business_name,
            business_url=business_url,
            owner_name=owner_name,
            business_email=business_email,
            contact_number=contact_number,
            payment_amount=payment_amount,
            payment_screenshot=screenshot_path,
            status="pending_payment_review",
            script_enabled=False
        )

        db.session.add(store)
        db.session.commit()

        flash("Business submitted. Wait for admin approval.", "success")
        return redirect(url_for("user_dashboard"))

    return render_template("business_setup.html")


# ---------------- USER DASHBOARD ----------------

@app.route("/dashboard")
def user_dashboard():
    if not login_required():
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    user = current_user()
    store = Store.query.filter_by(user_id=user.id).first()

    approved_orders = []
    pending_orders = []
    rejected_orders = []
    script = None

    if store:
        script = build_bot_script(store.id)

        approved_orders = BotOrder.query.filter_by(
            store_id=store.id,
            status="approved"
        ).order_by(BotOrder.created_at.desc()).all()

        pending_orders = BotOrder.query.filter_by(
            store_id=store.id,
            status="pending_verification"
        ).order_by(BotOrder.created_at.desc()).all()

        rejected_orders = BotOrder.query.filter_by(
            store_id=store.id,
            status="rejected"
        ).order_by(BotOrder.created_at.desc()).all()

    return render_template(
        "user_dashboard.html",
        user=user,
        store=store,
        script=script,
        approved_orders=approved_orders,
        pending_orders=pending_orders,
        rejected_orders=rejected_orders
    )


@app.route("/order/<int:order_id>")
def view_order(order_id):
    if not login_required():
        flash("Please login first.", "error")
        return redirect(url_for("login"))

    order = BotOrder.query.get_or_404(order_id)
    user = current_user()

    if not user.is_admin and order.store_ref.user_id != user.id:
        abort(403)

    return render_template("view_order.html", order=order)


# ---------------- ADMIN DASHBOARD ----------------

@app.route("/admin")
def admin_dashboard():
    if not admin_required():
        flash("Admin login required.", "error")
        return redirect(url_for("login"))

    users = User.query.filter_by(is_admin=False).order_by(User.created_at.desc()).all()
    stores = Store.query.order_by(Store.created_at.desc()).all()

    pending_businesses = Store.query.filter_by(status="pending_payment_review").order_by(Store.created_at.desc()).all()
    active_businesses = Store.query.filter_by(status="active").order_by(Store.created_at.desc()).all()
    rejected_businesses = Store.query.filter_by(status="rejected").order_by(Store.created_at.desc()).all()

    pending_orders = BotOrder.query.filter_by(status="pending_verification").order_by(BotOrder.created_at.desc()).all()
    approved_orders = BotOrder.query.filter_by(status="approved").order_by(BotOrder.created_at.desc()).all()
    rejected_orders = BotOrder.query.filter_by(status="rejected").order_by(BotOrder.created_at.desc()).all()

    return render_template(
        "admin_dashboard.html",
        users=users,
        stores=stores,
        pending_businesses=pending_businesses,
        active_businesses=active_businesses,
        rejected_businesses=rejected_businesses,
        pending_orders=pending_orders,
        approved_orders=approved_orders,
        rejected_orders=rejected_orders
    )


# ---------------- ADMIN BUSINESS ACTIONS ----------------

@app.route("/admin/approve-store/<int:store_id>")
def approve_store(store_id):
    if not admin_required():
        abort(403)

    store = Store.query.get_or_404(store_id)
    store.status = "active"
    store.script_enabled = True
    store.approved_at = datetime.utcnow()
    store.rejected_at = None
    db.session.commit()

    flash("Business approved successfully.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/reject-store/<int:store_id>")
def reject_store(store_id):
    if not admin_required():
        abort(403)

    store = Store.query.get_or_404(store_id)
    store.status = "rejected"
    store.script_enabled = False
    store.rejected_at = datetime.utcnow()
    db.session.commit()

    flash("Business rejected.", "error")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/toggle-script/<int:store_id>")
def toggle_script(store_id):
    if not admin_required():
        abort(403)

    store = Store.query.get_or_404(store_id)
    store.script_enabled = not store.script_enabled
    db.session.commit()

    flash("Script status updated.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/block-user/<int:user_id>")
def block_user(user_id):
    if not admin_required():
        abort(403)

    user = User.query.get_or_404(user_id)
    if user.is_admin:
        flash("Cannot block admin.", "error")
        return redirect(url_for("admin_dashboard"))

    user.is_blocked = True
    for store in user.stores:
        store.script_enabled = False

    db.session.commit()
    flash("User blocked.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/unblock-user/<int:user_id>")
def unblock_user(user_id):
    if not admin_required():
        abort(403)

    user = User.query.get_or_404(user_id)
    user.is_blocked = False
    db.session.commit()

    flash("User unblocked.", "success")
    return redirect(url_for("admin_dashboard"))


# ---------------- ADMIN ORDER ACTIONS ----------------

@app.route("/admin/approve-order/<int:order_id>")
def approve_order(order_id):
    if not admin_required():
        abort(403)

    order = BotOrder.query.get_or_404(order_id)
    order.status = "approved"
    order.approved_at = datetime.utcnow()
    order.rejected_at = None
    db.session.commit()

    flash("Order approved.", "success")
    return redirect(url_for("admin_dashboard"))


@app.route("/admin/reject-order/<int:order_id>")
def reject_order(order_id):
    if not admin_required():
        abort(403)

    order = BotOrder.query.get_or_404(order_id)
    order.status = "rejected"
    order.rejected_at = datetime.utcnow()
    db.session.commit()

    flash("Order rejected.", "error")
    return redirect(url_for("admin_dashboard"))


# ---------------- API ----------------

from urllib.parse import urlparse


def get_domain(url):
    try:
        parsed = urlparse(url)
        return parsed.netloc.replace("www.", "").lower()
    except:
        return ""


@app.route("/api/new-order", methods=["POST"])
def new_order():
    try:
        data = request.get_json(silent=True) or {}

        store_id = data.get("store")
        phone = str(data.get("phone", "")).strip()
        form_data = data.get("form_data") or {}
        page = form_data.get("_page") or ""

        # ===============================
        # BASIC VALIDATIONS
        # ===============================
        if not store_id:
            return jsonify(success=False, message="Missing store id"), 400

        store = Store.query.get(store_id)
        if not store:
            return jsonify(success=False, message="Store not found"), 404

        if store.status != "active":
            return jsonify(success=False, message="Store not active"), 403

        if not store.script_enabled:
            return jsonify(success=False, message="Script disabled"), 403

        if not phone:
            return jsonify(success=False, message="Phone required"), 400

        if not isinstance(form_data, dict):
            return jsonify(success=False, message="Invalid form data"), 400

        # ===============================
        # 🔒 DOMAIN VALIDATION
        # ===============================
        request_domain = get_domain(page)
        store_domain = get_domain(store.business_url)

        if not request_domain or not store_domain:
            return jsonify(success=False, message="Invalid domain"), 400

        if not request_domain.endswith(store_domain):
            return jsonify(success=False, message="Unauthorized domain"), 403

        # ===============================
        # 🔁 DUPLICATE PROTECTION
        # ===============================
        recent = BotOrder.query.filter_by(
            store_id=store.id,
            phone=phone
        ).order_by(BotOrder.created_at.desc()).first()

        is_duplicate = False
        if recent and (datetime.utcnow() - recent.created_at).seconds < 30:
            is_duplicate = True

        # ===============================
        # EXTRACT DATA
        # ===============================
        extracted = extract_order_fields(form_data)

        # ===============================
        # SAFE IP DETECTION
        # ===============================
        customer_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
        if customer_ip:
            customer_ip = customer_ip.split(",")[0].strip()

        # ===============================
        # 🧠 EXTRA FIELDS (FROM BOT V2)
        # ===============================
        product_url = form_data.get("_product_url", "")
        product_quantity = form_data.get("_product_quantity", "")
        delivery_fee = form_data.get("_delivery_fee", "")
        total_price = form_data.get("_total_price", "")
        subtotal_price = form_data.get("_product_subtotal", "")
        discount_amount = form_data.get("_discount_amount", "")
        currency = form_data.get("_currency", "")

        payment_method = form_data.get("_payment_method", "")
        shipping_method = form_data.get("_shipping_method", "")
        coupon_code = form_data.get("_coupon_code", "")
        payment_status_hint = form_data.get("_payment_status_hint", "")

        summary_text = form_data.get("_summary_text", "")
        page_text_snapshot = form_data.get("_page_text_snapshot", "")
        page_html_snapshot = form_data.get("_page_html_snapshot", "")

        canonical_url = form_data.get("_canonical_url", "")
        bot_version = form_data.get("_bot_version", "v1")

        # ===============================
        # 🪵 DEBUG LOG (IMPORTANT)
        # ===============================
        print("📦 NEW ORDER CAPTURED:")
        print(json.dumps(form_data, indent=2, ensure_ascii=False)[:2000])

        # ===============================
        # CREATE ORDER
        # ===============================
        order = BotOrder(
            token=str(uuid.uuid4()),
            store_id=store.id,
            phone=phone,
            page=page,
            canonical_url=canonical_url,
            customer_ip=customer_ip,
            form_data=json.dumps(form_data, ensure_ascii=False),

            # 👤 customer
            customer_name=extracted["customer_name"],
            customer_email=extracted["customer_email"],
            customer_address=extracted["customer_address"],
            customer_city=extracted["customer_city"],
            customer_postal_code=extracted["customer_postal_code"],

            # 🛒 product
            product_name=extracted["product_name"],
            product_price=extracted["product_price"],
            product_image=extracted["product_image"],
            product_url=product_url,
            product_quantity=product_quantity,

            # 💰 pricing
            subtotal_price=subtotal_price,
            delivery_fee=delivery_fee,
            discount_amount=discount_amount,
            total_price=total_price,
            currency=currency,

            # 💳 checkout
            payment_method=payment_method,
            shipping_method=shipping_method,
            coupon_code=coupon_code,
            payment_status_hint=payment_status_hint,

            # 📄 meta
            page_title=extracted["page_title"],
            submitted_at_text=extracted["submitted_at_text"],

            # 🧠 snapshots
            summary_text=summary_text,
            page_text_snapshot=page_text_snapshot,
            page_html_snapshot=page_html_snapshot,

            # ⚙️ system
            bot_version=bot_version,
            is_duplicate=is_duplicate,
            status="pending_verification"
        )

        db.session.add(order)
        db.session.commit()

        return jsonify(
            success=True,
            order_id=order.id,
            status=order.status,
            duplicate=is_duplicate
        )

    except Exception as e:
        print("❌ ERROR:", str(e))
        return jsonify(
            success=False,
            message="Server error"
        ), 500


@app.route("/api/order-status/<int:order_id>")
def order_status(order_id):
    order = BotOrder.query.get(order_id)
    if not order:
        return jsonify(success=False), 404

    return jsonify(
        success=True,
        order_id=order.id,
        status=order.status
    )



# ================= API Flutter AUTH =================

@app.route("/api/login", methods=["POST"])
def api_login():
    data = request.get_json()

    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()

    user = User.query.filter_by(email=email).first()

    if not user or not user.check_password(password):
        return jsonify({"error": "Invalid credentials"}), 401

    if user.is_blocked:
        return jsonify({"error": "Account blocked"}), 403

    session["user_id"] = user.id

    return jsonify({
        "message": "Login success",
        "user": {
            "id": user.id,
            "name": user.full_name,
            "email": user.email
        }
    })

@app.route("/api/signup", methods=["POST"])
def api_signup():
    data = request.get_json()

    full_name = data.get("full_name", "").strip()
    email = data.get("email", "").strip().lower()
    password = data.get("password", "").strip()

    if not full_name or not email or not password:
        return jsonify({"error": "Missing fields"}), 400

    if User.query.filter_by(email=email).first():
        return jsonify({"error": "Email exists"}), 400

    user = User(full_name=full_name, email=email)
    user.set_password(password)

    db.session.add(user)
    db.session.commit()

    return jsonify({"message": "Signup success"})
    
@app.route("/api/logout")
def api_logout():
    session.clear()
    return jsonify({"message": "Logged out"})

@app.route("/api/dashboard")
def api_dashboard():
    if not login_required():
        return jsonify({"error": "Unauthorized"}), 401

    user = current_user()
    store = Store.query.filter_by(user_id=user.id).first()

    if not store:
        return jsonify({
            "user": user.full_name,
            "store": None
        })

    pending = BotOrder.query.filter_by(store_id=store.id, status="pending_verification").count()
    approved = BotOrder.query.filter_by(store_id=store.id, status="approved").count()
    rejected = BotOrder.query.filter_by(store_id=store.id, status="rejected").count()

    return jsonify({
        "user": user.full_name,
        "store": {
            "name": store.business_name,
            "status": store.status,
            "script_enabled": store.script_enabled
        },
        "stats": {
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "total": pending + approved + rejected
        }
    })
    
@app.route("/api/orders")
def api_orders():
    if not login_required():
        return jsonify({"error": "Unauthorized"}), 401

    user = current_user()
    store = Store.query.filter_by(user_id=user.id).first()

    if not store:
        return jsonify([])

    orders = BotOrder.query.filter_by(store_id=store.id)\
        .order_by(BotOrder.created_at.desc()).all()

    return jsonify([{
        "id": o.id,
        "product_name": o.product_name,
        "customer_name": o.customer_name,
        "phone": o.phone,
        "total_price": o.total_price or o.product_price,
        "status": o.status,
        "created_at": o.created_at.strftime("%Y-%m-%d %H:%M")
    } for o in orders])
    
@app.route("/api/order/<int:order_id>")
def api_order_detail(order_id):
    if not login_required():
        return jsonify({"error": "Unauthorized"}), 401

    order = db.session.get(BotOrder, order_id)

    if not order:
        return jsonify({"error": "Order not found"}), 404

    return jsonify({
        "id": order.id,
        "status": order.status,

        # PRODUCT
        "product_name": order.product_name,
        "product_price": order.product_price,
        "product_image": order.product_image,
        "product_url": order.product_url,
        "product_quantity": order.product_quantity,

        # PRICING
        "delivery_fee": order.delivery_fee,
        "discount_amount": order.discount_amount,
        "total_price": order.total_price,
        "currency": order.currency,

        # CUSTOMER
        "customer_name": order.customer_name,
        "customer_email": order.customer_email,
        "phone": order.phone,
        "customer_city": order.customer_city,
        "customer_address": order.customer_address,

        # META
        "payment_method": order.payment_method,
        "shipping_method": order.shipping_method,
        "coupon_code": order.coupon_code,
        "payment_status_hint": order.payment_status_hint,

        # EXTRA
        "page": order.page,
        "summary_text": order.summary_text,
        "page_text_snapshot": order.page_text_snapshot,
        "bot_version": order.bot_version
    })

@app.route("/api/order/<int:order_id>/approve")
def api_approve_order(order_id):
    if not login_required():
        return jsonify({"error": "Unauthorized"}), 401

    order = db.session.get(BotOrder, order_id)
    if not order:
        return jsonify({"error": "Not found"}), 404

    order.status = "approved"
    order.approved_at = datetime.utcnow()

    db.session.commit()

    return jsonify({"message": "Order approved"})

@app.route("/api/order/<int:order_id>/reject")
def api_reject_order(order_id):
    if not login_required():
        return jsonify({"error": "Unauthorized"}), 401

    order = db.session.get(BotOrder, order_id)
    if not order:
        return jsonify({"error": "Not found"}), 404

    order.status = "rejected"
    order.rejected_at = datetime.utcnow()

    db.session.commit()

    return jsonify({"message": "Order rejected"})               
# =========================================================
# DB INIT
# =========================================================

def create_admin_if_missing():
    admin = User.query.filter_by(email="saeedrasheedshaikh8@gmail.com").first()

    if not admin:
        admin = User(
            full_name="Main Admin",
            email="saeedrasheedshaikh8@gmail.com",
            is_admin=True
        )
        admin.set_password("saeed1122")
        db.session.add(admin)
    else:
        # 🔥 FORCE RESET PASSWORD (IMPORTANT FIX)
        admin.set_password("saeed1122")

    db.session.commit()


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
        create_admin_if_missing()

        port = int(os.environ.get("PORT", 8080))
        app.run(debug=True, host="0.0.0.0", port=port)