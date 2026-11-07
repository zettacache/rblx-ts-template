// Browser-only design prototype. All purchases and ownership are local simulations.
const catalog = {
	starter: {
		name: "Starter Bundle",
		type: "One-time bundle",
		benefit: "20,000 coins + 250 gems + one 15-minute 2× coin boost.",
		price: 299,
		icon: "bag",
		tone: "gold",
		category: "featured",
		once: true,
	},
	double: {
		name: "Double Coins",
		type: "Permanent game pass",
		benefit: "Earn 2× coins from gameplay rewards.",
		price: 199,
		icon: "coin",
		tone: "gold",
		category: "passes",
		once: true,
		badge: "2×",
	},
	vip: {
		name: "VIP Club",
		type: "Permanent game pass",
		benefit: "Gold name tag, VIP trail & lounge access.",
		price: 399,
		icon: "crown",
		tone: "violet",
		category: "passes",
		once: true,
		badge: "VIP",
	},
	luck: {
		name: "Lucky Boost",
		type: "Consumable · 15 minutes",
		benefit: "2× luck for your next discoveries.",
		price: 79,
		icon: "potion",
		tone: "mint",
		category: "boosts",
		once: false,
		badge: "2×",
	},
	coins: {
		name: "Coin Satchel",
		type: "Consumable · instant",
		benefit: "Add 25,000 coins to your adventure.",
		price: 99,
		icon: "coin",
		tone: "gold",
		category: "coins",
		once: false,
		badge: "25K",
	},
	gems: {
		name: "Gem Pouch",
		type: "Consumable · instant",
		benefit: "Add 500 gems to your collection.",
		price: 149,
		icon: "gem",
		tone: "mint",
		category: "coins",
		once: false,
		badge: "500",
	},
	coinboost: {
		name: "Coin Boost",
		type: "Consumable · 15 minutes",
		benefit: "One 15-minute boost that doubles earned coins.",
		price: 49,
		icon: "coin",
		tone: "gold",
		category: "boosts",
		once: false,
		badge: "2×",
	},
};
const $ = (selector) => document.querySelector(selector);
const owned = new Set();
let category = "featured";
let selected;
let pending = false;
let purchaseTimer;
let toastTimer;
const icon = (name) => `<svg aria-hidden="true"><use href="#${name}"/></svg>`;
const categoryCopy = {
	featured: ["Make it your adventure", "Permanent perks & handy extras"],
	passes: ["Perks that stay with you", "Buy once · enjoy every session"],
	coins: ["Fill your pockets", "Instant currency packs"],
	boosts: ["A little extra momentum", "Timed boosts · use when you're ready"],
};
function render() {
	$("#bundle-hero").hidden = category !== "featured";
	[$("#section-title").textContent, $("#section-note").textContent] = categoryCopy[category];
	const visible =
		category === "featured"
			? ["double", "vip", "luck"]
			: Object.keys(catalog).filter((id) => catalog[id].category === category);
	$("#products").innerHTML = visible
		.map((id) => {
			const item = catalog[id];
			return `<article class="product ${item.tone}"><div class="product-top"><div class="product-art">${icon(item.icon)}<span>${item.badge}</span></div><div class="product-heading"><span class="product-type">${item.type}</span><h3>${item.name}</h3></div></div><p>${item.benefit}</p><button class="price" data-product="${id}" aria-label="${owned.has(id) ? `${item.name} owned in demo` : `Review ${item.name}, ${item.price} Robux`}" ${owned.has(id) ? "disabled" : ""}>${owned.has(id) ? "✓ Owned" : `${icon("robux")} ${item.price}`}</button></article>`;
		})
		.join("");
	const starter = $("[data-product='starter']");
	starter.disabled = owned.has("starter");
	starter.setAttribute(
		"aria-label",
		owned.has("starter") ? "Starter Bundle owned in demo" : "Review Starter Bundle, 299 Robux",
	);
	starter.innerHTML = owned.has("starter")
		? "✓ Bundle owned in demo"
		: `<span>Get Starter Bundle</span><strong>${icon("robux")}299</strong>`;
}
function notify(message) {
	clearTimeout(toastTimer);
	$("#toast").textContent = message;
	$("#toast").hidden = false;
	toastTimer = setTimeout(() => {
		$("#toast").hidden = true;
	}, 4500);
}
function review(id) {
	if (owned.has(id)) return;
	selected = id;
	const item = catalog[id];
	$("#dialog-title").textContent = item.name;
	$("#dialog-type").textContent = item.type;
	$("#dialog-benefit").textContent = item.benefit;
	$("#dialog-price").textContent = item.price;
	$("#dialog-status").textContent = "";
	$("#confirm-purchase").textContent = "Simulate purchase";
	$("#confirm-purchase").disabled = false;
	$("#purchase-dialog").showModal();
}
document.addEventListener("click", (event) => {
	const product = event.target.closest("[data-product]");
	if (product && !product.disabled) review(product.dataset.product);
});
document.querySelectorAll(".category").forEach((button) =>
	button.addEventListener("click", () => {
		category = button.dataset.category;
		document.querySelectorAll(".category").forEach((tab) => {
			tab.classList.toggle("active", tab === button);
			tab.setAttribute("aria-pressed", String(tab === button));
		});
		render();
	}),
);
$("#confirm-purchase").addEventListener("click", () => {
	if (pending) return;
	pending = true;
	const purchasedId = selected;
	$("#confirm-purchase").disabled = true;
	$("#confirm-purchase").textContent = "Confirming…";
	$("#dialog-status").textContent = "Simulating confirmation…";
	purchaseTimer = setTimeout(() => {
		pending = false;
		if (catalog[purchasedId].once) owned.add(purchasedId);
		$("#purchase-dialog").close();
		render();
		notify(`${catalog[purchasedId].name} confirmed in demo. No Robux spent.`);
		// Re-render replaces product controls; restore focus to the matching card.
		const target = $(`[data-product='${purchasedId}']`);
		if (target?.disabled) {
			$(".category.active").focus();
		} else {
			target?.focus();
		}
	}, 650);
});
function cancelPending() {
	clearTimeout(purchaseTimer);
	pending = false;
}
$("#cancel-purchase").addEventListener("click", () => {
	cancelPending();
	$("#purchase-dialog").close();
});
$("#purchase-dialog").addEventListener("close", cancelPending);
$("#purchase-dialog").addEventListener("cancel", cancelPending);
$("#close-shop").addEventListener("click", () => {
	$("#shop").hidden = true;
	$("#reopen").hidden = false;
	$("#reopen").focus();
});
$("#reopen").addEventListener("click", () => {
	$("#shop").hidden = false;
	$("#reopen").hidden = true;
	$("#close-shop").focus();
});
window.addEventListener("pagehide", () => {
	clearTimeout(purchaseTimer);
	clearTimeout(toastTimer);
});
render();
